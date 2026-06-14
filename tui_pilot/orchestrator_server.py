"""Orchestrator server wiring — collect/drain helpers, missions/brakes state,
and the orchestration HTTP router.

This module is the bridge between the in-memory session registry in
:mod:`tui_pilot.server` and the lock-free :class:`OrchestrationExecutor` in
:mod:`tui_pilot.orchestration`. It is kept separate so server.py's session
plumbing stays focused.

CONCURRENCY INVARIANT (mirrors server.py): hold at most ONE session lock at a
time. The poll loop is two-phase per tick:

  1. COLLECT (each session under ITS OWN lock): for an orchestrator, scan + parse
     + mark_processed its outbox and gather ``(orch_id, signal)`` descriptors;
     for a worker with a parent, detect "needs forwarding" and gather a forward
     note. NOTHING here sends into another session or runs the executor.
  2. DRAIN (no session lock held): run each gathered signal through the executor
     (its callbacks each take ONE target lock), send results / forwards back into
     the orchestrator (``with _lock_for(orch): send_text``). Each item touches at
     most one session lock.

server.py imports this module, includes :data:`router`, and calls
:func:`collect_orchestrator`, :func:`collect_worker_forward`, and :func:`drain`
from its poll loop.
"""
from __future__ import annotations

import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .orchestration import (
    OrchestrationExecutor,
    Policy,
    Result,
    parse_orchestration_signal,
)

# ---- mission / brake state ------------------------------------------------
#
# Both maps are plain dicts guarded by a dedicated lock that is NEVER nested with
# a session lock — it is only taken for these short in-memory reads/writes, never
# while sending into a session.
_missions: dict[str, dict] = {}
_brakes: dict[str, dict] = {}
_state_lock = threading.Lock()
_brake_seq = 0


def _mission(mission: str | None) -> dict | None:
    """Lazily create + return a mission record, or None for a missing key."""
    if mission is None:
        return None
    with _state_lock:
        return _missions.setdefault(mission, {"autopilot": False, "activity": []})


def _policy_for(mission: str | None) -> Policy:
    """Executor policy for a mission. Default supervised+sonnet ceiling when the
    mission is unknown (so an out-of-band signal is still policed)."""
    with _state_lock:
        rec = _missions.get(mission) if mission else None
        autopilot = bool(rec and rec.get("autopilot"))
    return Policy(ceiling="sonnet", autopilot=autopilot)


def _narrate(mission: str | None, text: str) -> None:
    rec = _mission(mission)
    if rec is not None:
        with _state_lock:
            rec["activity"].append(text)


def _record_brake(*, mission, brake, detail, signal=None, worker=None) -> str:
    global _brake_seq
    with _state_lock:
        _brake_seq += 1
        bid = f"brake-{_brake_seq}"
        _brakes[bid] = {
            "id": bid,
            "mission": mission,
            "brake": brake,
            "detail": detail,
            "signal": signal,
            "worker": worker,
        }
    return bid


# ---- executor callbacks ---------------------------------------------------


class _Callbacks:
    """The 7 executor callbacks bound to a specific orchestrator id. Each method
    takes at most ONE session lock; callbacks are only invoked from the poll
    loop's DRAIN phase or a request handler (no session lock held by the caller).
    """

    def __init__(self, server, orch_aid: str, mission: str | None = None):
        self._server = server
        self._orch = orch_aid
        self._mission = mission

    def spawn(self, **kw) -> str:
        # Takes _registry_lock internally; caller holds no session lock.
        info = self._server._spawn_agent(
            name=kw.get("role") or "worker",
            role=kw.get("role"),
            cmd=kw.get("cmd"),
            model=kw.get("model"),
            task=kw.get("task"),
            cwd=kw.get("cwd"),
            mode=kw.get("mode"),
            mission=kw.get("mission"),
            parent=self._orch,
            reason=kw.get("reason"),
        )
        return info["id"]

    def answer_worker(self, worker: str, text: str) -> bool:
        s = self._server
        with s._lock_for(worker):
            poller = s._pollers.get(worker)
            if poller is None:
                return False
            sid = poller.open_signal.id if poller.open_signal else None
            return poller.answer(sid, text) if sid else False

    def approve_worker(self, worker: str) -> None:
        s = self._server
        with s._lock_for(worker):
            ctrl = s._sessions.get(worker)
            if ctrl is not None:
                ctrl.approve()

    def deny_worker(self, worker: str) -> None:
        s = self._server
        with s._lock_for(worker):
            ctrl = s._sessions.get(worker)
            if ctrl is not None:
                ctrl.deny()

    def kill(self, worker: str) -> bool:
        try:
            self._server.delete_session(worker)
            return True
        except HTTPException:
            return False

    def narrate(self, text: str) -> None:
        _narrate(self._mission, text)

    def worker_state(self, worker: str) -> str:
        # _safe_state is lock-free (read-only capture).
        s = self._server
        ctrl = s._sessions.get(worker)
        if ctrl is None:
            return ""
        return s._safe_state(ctrl)


def _callbacks_for(server, orch_aid: str, mission: str | None = None) -> _Callbacks:
    return _Callbacks(server, orch_aid, mission)


# ---- collect helpers (called UNDER a session lock) ------------------------


def collect_orchestrator(server, aid: str) -> list[tuple]:
    """COLLECT phase for an orchestrator session (called under ITS lock).

    Scans the orchestrator's outbox, parses each orchestration signal, marks it
    processed (quarantining unparseable ones), and returns ``(aid, signal)``
    descriptors. Does NOT run the executor or send into any session.
    """
    out: list[tuple] = []
    cwd = server._meta.get(aid, {}).get("cwd")
    if not cwd:
        return out
    hub = server._hub_for(cwd)
    for data in hub.scan(aid):
        sid = data.get("id", "")
        try:
            sig = parse_orchestration_signal(data)
        except ValueError:
            hub.mark_processed(aid, sid)  # quarantine the bad signal
            continue
        hub.mark_processed(aid, sig.id or sid)
        out.append((aid, sig))
    return out


def collect_worker_forward(server, aid: str, harness_state) -> list[tuple]:
    """COLLECT phase for a worker with a parent (called under the WORKER's lock,
    AFTER its normal ``poller.poll()`` produced ``harness_state``).

    Returns ``(parent_orch, note)`` forward items for new questions, and may
    record a brake for a supervised permission dialog. Reads ``_safe_state``
    (lock-free) but never sends into another session here.
    """
    out: list[tuple] = []
    m = server._meta.get(aid)
    if not m:
        return out
    parent = m.get("parent")
    if not parent:
        return out
    mission = m.get("mission")
    poller = server._pollers.get(aid)

    # 1. A new blocking question → forward once (per signal id).
    if (
        harness_state is not None
        and harness_state.kind == "blocked"
        and poller is not None
        and poller.open_signal is not None
    ):
        sig = poller.open_signal
        if sig.id != m.get("forwarded_signal_id"):
            # Per-worker scratch key: intentionally written under the worker's
            # session lock (this fn's caller holds it), not _registry_lock — it
            # is only ever read/written here, never cross-thread.
            m["forwarded_signal_id"] = sig.id
            note = (
                f'worker {aid} asks: "{sig.text}" options={sig.options}; '
                f"reply answer{{worker:{aid},text:...}} or escalate"
            )
            out.append((parent, note))

    # 2. A permission dialog: supervised → brake; autopilot → forward once.
    ctrl = server._sessions.get(aid)
    screen_state = server._safe_state(ctrl) if ctrl is not None else ""
    if screen_state == server.State.AWAITING_PERMISSION.value:
        with _state_lock:
            rec = _missions.get(mission) if mission else None
            autopilot = bool(rec and rec.get("autopilot"))
        if not autopilot:
            # SUPERVISED: human brake (once per dialog). perm_braked/
            # perm_forwarded are per-worker scratch keys, intentionally guarded
            # by the worker's session lock (held by this fn's caller), not
            # _registry_lock — written and read only here.
            if not m.get("perm_braked"):
                m["perm_braked"] = True
                _record_brake(
                    mission=mission,
                    brake="permission",
                    detail=f"worker {aid} hit a permission prompt",
                    worker=aid,
                )
        else:
            # AUTOPILOT: forward once per dialog.
            if not m.get("perm_forwarded"):
                m["perm_forwarded"] = True
                out.append(
                    (parent, f"worker {aid} hit a permission prompt; reply answer approve|deny")
                )
    else:
        # Dialog cleared → reset the once-per-dialog flags.
        m["perm_braked"] = False
        m["perm_forwarded"] = False

    return out


# ---- drain helper (NO session lock held) ----------------------------------


def drain(server, signals: list[tuple], forwards: list[tuple]) -> None:
    """DRAIN phase (no session lock held on entry).

    Runs each collected ``(orch, signal)`` through the executor, sends results
    back into the orchestrator, then delivers each ``(orch, note)`` forward.
    Every item touches at most ONE session lock.
    """
    for orch_aid, sig in signals:
        mission = sig.mission if getattr(sig, "mission", None) else None
        _mission(mission)  # lazily register the mission on first reference
        policy = _policy_for(mission)
        cb = _callbacks_for(server, orch_aid, mission)
        try:
            result = OrchestrationExecutor(cb, policy).run(sig)
        except Exception as exc:  # noqa: BLE001 - never let one signal kill the loop
            _narrate(mission, f"executor error on signal {sig.id}: {exc}")
            continue
        _apply_result(server, orch_aid, mission, sig, result)

    for orch_aid, note in forwards:
        _send_to_orch(server, orch_aid, note)


def _apply_result(server, orch_aid: str, mission, sig, result: Result) -> None:
    if result.kind == "spawned":
        _narrate(mission, f"spawned worker {result.worker}")
        _send_to_orch(server, orch_aid, f"spawned worker {result.worker}")
    elif result.kind == "brake":
        _record_brake(
            mission=mission,
            brake=result.brake or "brake",
            detail=result.detail,
            signal=sig,
        )
        _narrate(mission, f"BRAKE {result.brake}: {result.detail}")


def _send_to_orch(server, orch_aid: str, text: str) -> None:
    """Send a note into the orchestrator under ITS lock (one lock only)."""
    with server._lock_for(orch_aid):
        ctrl = server._sessions.get(orch_aid)
        if ctrl is not None:
            try:
                ctrl.session.send_text(text)
            except Exception:  # noqa: BLE001
                pass


# ---- HTTP router ----------------------------------------------------------

router = APIRouter()


class AutopilotRequest(BaseModel):
    autopilot: bool


def _mission_agents(server, mission: str) -> list[dict]:
    out = []
    for aid in list(server._sessions.keys()):
        m = server._meta.get(aid, {})
        if m.get("mission") == mission:
            try:
                out.append(server._info(aid))
            except HTTPException:
                continue
    return out


@router.post("/orchestrator")
def ensure_orchestrator() -> dict:
    """Ensure a single orchestrator session exists; return its id."""
    from . import server

    for aid, m in list(server._meta.items()):
        if m.get("is_orchestrator"):
            return {"id": aid}
    info = server._spawn_agent(name="orchestrator", role="orchestrator")
    server._meta[info["id"]]["is_orchestrator"] = True
    return {"id": info["id"]}


@router.get("/missions")
def list_missions() -> dict:
    from . import server

    missions = []
    with _state_lock:
        names = list(_missions.keys())
        recs = {k: dict(v) for k, v in _missions.items()}
    for name in names:
        rec = recs[name]
        missions.append(
            {
                "mission": name,
                "autopilot": rec.get("autopilot", False),
                "agents": len(_mission_agents(server, name)),
                "activity_tail": rec.get("activity", [])[-5:],
            }
        )
    return {"missions": missions}


@router.post("/missions/{mission}/autopilot")
def set_autopilot(mission: str, req: AutopilotRequest) -> dict:
    rec = _mission(mission)
    with _state_lock:
        rec["autopilot"] = req.autopilot
    return {"autopilot": req.autopilot}


@router.get("/missions/{mission}")
def get_mission(mission: str) -> dict:
    from . import server

    rec = _missions.get(mission)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"no mission {mission!r}")
    return {
        "mission": mission,
        "autopilot": rec.get("autopilot", False),
        "fleet": _mission_agents(server, mission),
        "activity": list(rec.get("activity", [])),
    }


@router.get("/brakes")
def list_brakes() -> dict:
    with _state_lock:
        brakes = [
            {
                "id": b["id"],
                "mission": b["mission"],
                "brake": b["brake"],
                "detail": b["detail"],
                "worker": b["worker"],
            }
            for b in _brakes.values()
        ]
    return {"brakes": brakes}


def _orch_for_mission(server, mission) -> str | None:
    """Find the orchestrator that owns a mission (any worker's parent), else the
    first orchestrator session."""
    for aid in list(server._sessions.keys()):
        m = server._meta.get(aid, {})
        if m.get("mission") == mission and m.get("parent"):
            return m["parent"]
    for aid, m in list(server._meta.items()):
        if m.get("is_orchestrator"):
            return aid
    return None


@router.post("/brakes/{brake_id}/allow")
def allow_brake(brake_id: str) -> dict:
    from . import server

    with _state_lock:
        brake = _brakes.pop(brake_id, None)
    if brake is None:
        raise HTTPException(status_code=404, detail=f"no brake {brake_id!r}")
    mission = brake.get("mission")
    orch = _orch_for_mission(server, mission)
    if brake["brake"] == "permission":
        worker = brake.get("worker")
        if worker is not None:
            # approve_worker only uses the worker id; the orch id is unused on
            # this path, so pass "" rather than misleadingly defaulting to it.
            _callbacks_for(server, orch or "", mission).approve_worker(worker)
        _narrate(mission, f"allowed permission for worker {brake.get('worker')}")
    else:
        # opus-spawn (or other signal-bearing) brake → re-run with autopilot on.
        sig = brake.get("signal")
        if sig is not None and orch is not None:
            cb = _callbacks_for(server, orch, mission)
            result = OrchestrationExecutor(cb, Policy(autopilot=True)).run(sig)
            _apply_result(server, orch, mission, sig, result)
    return {"id": brake_id, "status": "allowed"}


@router.post("/brakes/{brake_id}/skip")
def skip_brake(brake_id: str) -> dict:
    from . import server

    with _state_lock:
        brake = _brakes.pop(brake_id, None)
    if brake is None:
        raise HTTPException(status_code=404, detail=f"no brake {brake_id!r}")
    mission = brake.get("mission")
    orch = _orch_for_mission(server, mission)
    if orch is not None:
        _send_to_orch(server, orch, f"skipped brake {brake['brake']}: {brake['detail']}")
    return {"id": brake_id, "status": "skipped"}
