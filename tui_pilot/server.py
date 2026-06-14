"""FastAPI HTTP layer — multi-agent control plane.

An in-memory registry of named sessions, each a
:class:`~tui_pilot.controller.Controller` over a
:class:`~tui_pilot.session.TmuxSession`. On top of the raw drive-a-TUI API this
adds **agent roles**: presets (Planner, Developer, …) that customise an
interactive ``claude`` session WITHOUT any headless flag or SDK —

  * autonomy via ``Controller.set_mode`` (Shift-Tab keystrokes), and
  * a "system prompt" via *priming*: the role's instructions are typed in as the
    first interactive message.

Both happen in a background thread after spawn, so the HTTP call returns
immediately and the UI can watch the agent boot → prime → become ready.

Run with::

    .venv/bin/python -m uvicorn tui_pilot.server:app --port 8765
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import asdict
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .comms import Hub
from .controller import Controller
from .harness import HarnessPoller
from .identity import new_agent_id
from .screen import State
from .session import SessionError, TmuxSession, install_comms_skill

app = FastAPI(
    title="tui-pilot",
    description="Drive & orchestrate interactive TUI agents over HTTP, via tmux only.",
    version="0.2.0",
)

_ROLES_PATH = Path(__file__).resolve().parent.parent / "roles.yaml"


def load_roles() -> dict[str, dict]:
    """Load agent-role presets from roles.yaml, keyed by id."""
    if not _ROLES_PATH.exists():
        return {}
    data = yaml.safe_load(_ROLES_PATH.read_text()) or {}
    return {r["id"]: r for r in data.get("roles", [])}


ROLES = load_roles()

# In-memory registry. Guarded by a registry lock for structural changes; each
# session has its own lock serialising *mutating* tmux operations. Read-only
# captures (state/screen) intentionally skip the lock so the UI stays live even
# while a session is mid-prime or mid-turn.
_sessions: dict[str, Controller] = {}
_meta: dict[str, dict] = {}
_locks: dict[str, threading.Lock] = {}
_registry_lock = threading.Lock()
_order = 0

# Mailbox hub (agent <-> control center) and per-session harness pollers. The
# hub is a module global so tests can swap it for an isolated tmp root.
HUB = Hub()
_pollers: dict[str, HarnessPoller] = {}


def _poll_loop() -> None:
    """Daemon: tick every poller ~1s so progress/finish/handoff are processed
    without the UI having to poll. One poller raising must not stop the loop."""
    while True:
        for aid, poller in list(_pollers.items()):
            try:
                # HarnessPoller is not internally synchronized; every poll()
                # must run under the session lock (same lock answer()/
                # confirm_handoff() take) so unlocked loop polls don't race.
                with _lock_for(aid):
                    poller.poll()
            except Exception:  # noqa: BLE001 - never let one agent kill the loop
                pass
        time.sleep(1.0)


threading.Thread(target=_poll_loop, daemon=True).start()


# ---- request / response models -------------------------------------------


class SpawnRequest(BaseModel):
    name: str = Field(..., description="unique session name")
    role: str | None = Field(None, description="role preset id (see GET /roles)")
    cmd: str | None = Field(None, description="command to run; defaults to the role's or 'claude'")
    instructions: str | None = Field(
        None, description="override the role's priming instructions"
    )
    task: str | None = Field(
        None,
        description="initial mission to send right after priming, e.g. "
        "'Plan a Salesforce integration' or 'Implement plan.md'",
    )
    mode: str | None = Field(
        None, description="permission mode: normal | accept-edits | auto | plan | bypass"
    )
    cwd: str | None = Field(None, description="working directory for the agent")
    cols: int = Field(200, ge=20, le=500)
    rows: int = Field(50, ge=10, le=200)


class PromptRequest(BaseModel):
    text: str
    timeout: float = Field(180, gt=0, le=1800)


class KeyRequest(BaseModel):
    key: str = Field(..., description='tmux key name, e.g. "Down", "Enter", "C-c"')


class ModeRequest(BaseModel):
    mode: str = Field(..., description="normal | accept-edits | auto | plan")


class AnswerRequest(BaseModel):
    signal_id: str = Field(..., description="id of the open blocking signal")
    text: str = Field(..., description="the reply typed back into the agent")


# ---- helpers --------------------------------------------------------------


def _get(aid: str) -> Controller:
    ctrl = _sessions.get(aid)
    if ctrl is None:
        raise HTTPException(status_code=404, detail=f"no session with id {aid!r}")
    return ctrl


def _lock_for(aid: str) -> threading.Lock:
    with _registry_lock:
        return _locks.setdefault(aid, threading.Lock())


def _safe_state(ctrl: Controller) -> str:
    try:
        return ctrl.state().value
    except SessionError:
        return State.EXITED.value


def _info(aid: str) -> dict:
    # Guard against a concurrent delete between lookups (FIX 5).
    ctrl = _sessions.get(aid)
    if ctrl is None:
        raise HTTPException(status_code=404, detail=f"no session with id {aid!r}")
    m = _meta.get(aid, {})
    # poll() must run under the session lock (FIX 1). Acquire the lock object
    # first (_lock_for briefly takes _registry_lock then releases it) so we
    # never nest session-lock acquisition inside a held _registry_lock — which
    # is why _spawn_agent calls _info OUTSIDE its _registry_lock block.
    harness_state = None
    poller = _pollers.get(aid)
    if poller is not None:
        with _lock_for(aid):
            harness_state = poller.poll().kind
    return {
        "id": aid,
        "name": m.get("name", aid),
        "alive": ctrl.session.is_alive(),
        "cmd": ctrl.session.cmd,
        "cwd": ctrl.session.cwd,
        "role": m.get("role"),
        "label": m.get("label"),
        "emoji": m.get("emoji"),
        "mode": m.get("mode"),
        "prep": m.get("prep"),  # booting | priming | working | ready | error
        "prep_detail": m.get("prep_detail"),
        "task": m.get("task"),
        "order": m.get("order"),
        "state": _safe_state(ctrl),
        "harness_state": harness_state,
    }


def _prime(aid: str) -> None:
    """Background worker: boot → set mode → inject instructions → ready."""
    ctrl = _sessions.get(aid)
    if ctrl is None:
        return
    m = _meta[aid]
    lock = _lock_for(aid)
    try:
        # 1. wait for the REPL to finish booting.
        ctrl.wait_for_settle(timeout=40)
        mode = m.get("mode") or "normal"
        instructions = (m.get("instructions") or "").strip()

        with lock:
            # 2. set autonomy via Shift-Tab keystrokes (best-effort). "normal"
            # is the default and "bypass" is already set at launch (via the
            # danger flag) — neither needs cycling.
            if mode and mode not in ("normal", "bypass"):
                m["prep"] = "priming"
                m["prep_detail"] = f"setting mode → {mode}"
                ok = ctrl.set_mode(mode)
                if not ok:
                    m["prep_detail"] = f"could not reach mode {mode}; left as-is"

            # 3. inject the role instructions as the first message (priming),
            # prefixed with the agent's id + outbox path so it knows where to
            # signal the control center via the agent-comms skill. (The skill
            # file itself is installed at spawn regardless of instructions.)
            if instructions:
                m["prep"] = "priming"
                m["prep_detail"] = "sending instructions"
                priming = (
                    f"You are agent '{aid}' under a control center. To ask, get "
                    "help, report progress, or finish, follow the agent-comms "
                    "skill and write JSON to "
                    f"{HUB.agent_dir(aid) / 'outbox'}. "
                ) + instructions
                ctrl.prompt(priming, timeout=120)

        # 4. if a specific mission was given, fire it off (fire-and-forget) so
        # the agent starts working on spawn (e.g. "Plan a Salesforce
        # integration" / "Implement plan.md"). We must NOT hold the per-session
        # lock for the whole turn (spec §3.5) — otherwise ``answer()`` could
        # never acquire it to reply to the agent's questions. So we take the
        # lock only long enough to SEND the task, then release without waiting.
        task = (m.get("task") or "").strip()
        if task:
            m["prep"] = "working"
            m["prep_detail"] = task[:80]
            with lock:
                ctrl.session.send_text(task)

        m["prep"] = "ready"
        m["prep_detail"] = None
    except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
        m["prep"] = "error"
        m["prep_detail"] = str(exc)


# ---- role endpoints -------------------------------------------------------


@app.get("/roles")
def list_roles() -> dict:
    """List the agent-role presets the UI can spawn."""
    return {
        "roles": [
            {
                "id": r["id"],
                "label": r.get("label", r["id"]),
                "emoji": r.get("emoji", ""),
                "mode": r.get("mode", "normal"),
                "cmd": r.get("cmd", "claude"),
                "description": r.get("description", ""),
                "instructions": r.get("instructions", ""),
            }
            for r in ROLES.values()
        ]
    }


# ---- session endpoints ----------------------------------------------------


def _make_handoff(*, predecessor_aid: str, name_hint: str, cwd: str | None):
    """Build the ``on_handoff`` callback for a poller: spawn the successor the
    finished signal describes. An unknown ``role`` here must NOT 400 — the
    successor falls back to the provided cmd/mode.

    Runs on the poll path (loop or _info), which already holds the predecessor's
    session lock. _spawn_agent acquires _registry_lock (a DIFFERENT session id,
    so no re-acquire of this lock). A spawn failure must not kill the poll loop,
    so it is caught and surfaced on the predecessor's meta (FIX 3)."""
    def _handoff(nxt: dict, report: str) -> dict | None:
        try:
            return _spawn_agent(
                name=nxt.get("role") or name_hint,
                role=nxt.get("role"),
                cmd=nxt.get("cmd"),
                task=nxt.get("task"),
                mode=nxt.get("mode"),
                cwd=nxt.get("cwd") or cwd,
                report_context=report,
            )
        except Exception as exc:  # noqa: BLE001 - surface, don't crash the loop
            m = _meta.get(predecessor_aid)
            if m is not None:
                m["prep_detail"] = f"handoff spawn failed: {exc}"
            return None

    return _handoff


def _spawn_agent(
    *,
    name: str,
    role: str | None = None,
    cmd: str | None = None,
    instructions: str | None = None,
    task: str | None = None,
    mode: str | None = None,
    cwd: str | None = None,
    cols: int = 200,
    rows: int = 50,
    report_context: str | None = None,
) -> dict:
    """Spawn a (optionally role-based) agent session and return its info.

    A plain callable so both the ``POST /sessions`` route and the harness
    handoff callback can spawn successors. An unknown ``role`` is tolerated here
    (it falls back to the provided ``cmd``/``mode`` defaults) — the route layer
    is responsible for 400ing unknown roles on direct API calls.
    """
    global _order
    role_def = ROLES.get(role) if role else None

    eff_cmd = cmd or (role_def.get("cmd") if role_def else None) or "claude"
    eff_mode = mode or (role_def.get("mode") if role_def else None) or "normal"

    # "bypass" is the one mode not reachable via Shift-Tab keystrokes; it must be
    # requested at launch with --dangerously-skip-permissions. We still drive the
    # session purely through tmux afterwards — this only configures startup.
    if eff_mode == "bypass" and "dangerously-skip-permissions" not in eff_cmd:
        eff_cmd = f"{eff_cmd} --dangerously-skip-permissions"
    eff_instructions = (
        instructions
        if instructions is not None
        else (role_def.get("instructions", "") if role_def else "")
    )

    # When picking up a handoff, prepend the predecessor's report to the task so
    # the successor has the context it needs.
    eff_task = task
    if report_context and task:
        eff_task = (
            "Context from the previous agent's handoff report:\n\n"
            f"{report_context}\n\n---\nYour task: {task}"
        )

    aid = new_agent_id(name)
    eff_cwd = cwd or os.getcwd()

    sess = TmuxSession(aid, eff_cmd, cols=cols, rows=rows, cwd=eff_cwd)
    try:
        sess.spawn()
    except SessionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Provision the mailbox + agent-comms skill, then attach a harness poller so
    # the background loop can surface signals and orchestrate finish/handoff.
    HUB.agent_dir(aid)
    install_comms_skill(
        eff_cwd, outbox_path=str(HUB.agent_dir(aid) / "outbox"), agent_id=aid
    )

    # Registry mutation must be atomic (FIX 2). The auto-handoff path reaches
    # here while holding the PREDECESSOR's session lock, then takes
    # _registry_lock — lock ordering is session-lock (outer) → _registry_lock
    # (inner), and never the reverse, so the ordering stays acyclic. The
    # successor is a DIFFERENT aid, so no session lock is re-acquired.
    with _registry_lock:
        _sessions[aid] = Controller(sess)
        _locks[aid] = threading.Lock()
        _order += 1
        _meta[aid] = {
            "id": aid,
            "name": name,
            "cwd": eff_cwd,
            "role": role,
            "label": (role_def.get("label") if role_def else None) or name,
            "emoji": (role_def.get("emoji") if role_def else None) or "💬",
            "mode": eff_mode,
            "instructions": eff_instructions,
            "task": eff_task,
            "prep": "booting",
            "prep_detail": None,
            "order": _order,
        }
        _pollers[aid] = HarnessPoller(
            aid, sess, HUB, cwd=eff_cwd,
            on_handoff=_make_handoff(predecessor_aid=aid, name_hint=name, cwd=eff_cwd),
        )

    # Kick off priming in the background (mode + instructions need a live REPL).
    threading.Thread(target=_prime, args=(aid,), daemon=True).start()
    # _info() acquires the session lock (for harness_state) — call it OUTSIDE
    # the _registry_lock block above to keep the lock ordering acyclic.
    return _info(aid)


@app.post("/sessions")
def create_session(req: SpawnRequest) -> dict:
    """Spawn a new (optionally role-based) agent session.

    Returns immediately; priming (mode + instructions) runs in the background.
    Poll ``GET /sessions`` or ``GET /sessions/{id}`` and watch ``prep`` go
    ``booting`` → ``priming`` → ``ready``.
    """
    # Unknown-role 400 stays here (route-only) and OUTSIDE any lock; _spawn_agent
    # itself tolerates unknown roles (for the handoff path). It takes
    # _registry_lock internally, so do NOT wrap the call (non-reentrant lock).
    if req.role and ROLES.get(req.role) is None:
        raise HTTPException(status_code=400, detail=f"unknown role {req.role!r}")
    return _spawn_agent(
        name=req.name,
        role=req.role,
        cmd=req.cmd,
        instructions=req.instructions,
        task=req.task,
        mode=req.mode,
        cwd=req.cwd,
        cols=req.cols,
        rows=req.rows,
    )


@app.get("/sessions")
def list_sessions() -> dict:
    """List all sessions with role, prep status and live state."""
    with _registry_lock:
        ids = list(_sessions.keys())
    sessions = []
    for i in ids:
        try:
            sessions.append(_info(i))
        except HTTPException:
            continue  # deleted between snapshot and lookup — skip it
    sessions.sort(key=lambda s: s.get("order") or 0)
    return {"sessions": sessions}


@app.get("/sessions/{id}")
def get_session(id: str) -> dict:
    _get(id)
    return _info(id)


@app.get("/sessions/{id}/state")
def get_state(id: str) -> dict:
    ctrl = _get(id)
    return {"id": id, "state": _safe_state(ctrl), "prep": _meta.get(id, {}).get("prep")}


@app.get("/sessions/{id}/screen", response_class=PlainTextResponse)
def get_screen(id: str, history: bool = False) -> str:
    ctrl = _get(id)
    try:
        return ctrl.session.capture(history=history)
    except SessionError as exc:
        raise HTTPException(status_code=410, detail=str(exc)) from exc


@app.post("/sessions/{id}/prompt")
def post_prompt(id: str, req: PromptRequest) -> dict:
    ctrl = _get(id)
    with _lock_for(id):
        try:
            result = ctrl.prompt(req.text, timeout=req.timeout)
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"response": result["response"], "state": result["state"].value}


@app.post("/sessions/{id}/key")
def post_key(id: str, req: KeyRequest) -> dict:
    ctrl = _get(id)
    with _lock_for(id):
        try:
            ctrl.session.send_key(req.key)
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/sessions/{id}/mode")
def post_mode(id: str, req: ModeRequest) -> dict:
    ctrl = _get(id)
    if req.mode == "bypass":
        # bypass can't be toggled on a running session; it needs a relaunch with
        # the danger flag. Tell the caller to respawn with mode=bypass instead.
        raise HTTPException(
            status_code=409,
            detail="'bypass' must be set at spawn (relaunch with mode=bypass); "
            "it is not reachable on a running session.",
        )
    with _lock_for(id):
        try:
            ok = ctrl.set_mode(req.mode)
        except (SessionError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if id in _meta:
        _meta[id]["mode"] = req.mode
    return {"ok": ok, "mode": ctrl.current_mode()}


@app.post("/sessions/{id}/approve")
def post_approve(id: str) -> dict:
    ctrl = _get(id)
    with _lock_for(id):
        try:
            ctrl.approve()
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/sessions/{id}/deny")
def post_deny(id: str) -> dict:
    ctrl = _get(id)
    with _lock_for(id):
        try:
            ctrl.deny()
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/sessions/{id}/interrupt")
def post_interrupt(id: str) -> dict:
    ctrl = _get(id)
    with _lock_for(id):
        try:
            ctrl.interrupt()
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"ok": True}


# ---- harness (mailbox) endpoints ------------------------------------------


def _poller(id: str) -> HarnessPoller:
    p = _pollers.get(id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"no session with id {id!r}")
    return p


@app.get("/sessions/{id}/signals")
def get_signals(id: str) -> dict:
    """The agent's currently-open blocking signal (question / need-context /
    need-help), if any — at most one at a time (spec §3.5)."""
    p = _poller(id)
    with _lock_for(id):  # poll() under the session lock (FIX 1)
        st = p.poll()
    if st.kind == "blocked" and st.open_signal:
        return {"signals": [asdict(st.open_signal)]}
    return {"signals": []}


@app.post("/sessions/{id}/answer")
def post_answer(id: str, req: AnswerRequest) -> dict:
    """Reply to the agent's open signal (typed back in via tmux).

    ``landed`` is False if there was no matching open signal (stale/duplicate
    answer) — the answer was a no-op.
    """
    p = _poller(id)
    with _lock_for(id):
        landed = p.answer(req.signal_id, req.text)
    return {"ok": True, "landed": landed}


@app.get("/sessions/{id}/report", response_class=PlainTextResponse)
def get_report(id: str) -> str:
    """The finished agent's handoff report (its SUMMARY.md content)."""
    report = _poller(id).done_report
    if not report:
        raise HTTPException(status_code=404, detail="no report yet")
    return report


@app.post("/sessions/{id}/handoff")
def post_handoff(id: str) -> dict:
    """Confirm a pending (start:"confirm") handoff: spawn the successor."""
    p = _poller(id)
    with _lock_for(id):
        ok = p.confirm_handoff()
    return {"ok": ok}


@app.delete("/sessions/{id}")
def delete_session(id: str) -> dict:
    with _registry_lock:
        ctrl = _sessions.pop(id, None)
        _locks.pop(id, None)
        _meta.pop(id, None)
        _pollers.pop(id, None)
    if ctrl is None:
        raise HTTPException(status_code=404, detail=f"no session with id {id!r}")
    ctrl.session.kill()
    return {"id": id, "status": "killed"}


# ---- static test UI -------------------------------------------------------

_STATIC_DIR = Path(__file__).resolve().parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/ui", StaticFiles(directory=str(_STATIC_DIR), html=True), name="ui")


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (
        "<html><body style='font-family:sans-serif;padding:2rem'>"
        "<h1>tui-pilot</h1>"
        "<p>Multi-agent control plane for interactive TUIs, driven via tmux.</p>"
        "<ul>"
        "<li><a href='/ui/'>Open the control panel</a></li>"
        "<li><a href='/docs'>OpenAPI docs</a></li>"
        "</ul></body></html>"
    )


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)


if __name__ == "__main__":
    main()
