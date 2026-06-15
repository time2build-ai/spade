"""FastAPI HTTP layer — multi-agent control plane.

A live registry of named sessions, each a
:class:`~tui_pilot.controller.Controller` over a
:class:`~tui_pilot.session.TmuxSession`. The registry is the in-memory source of
truth, but it is backed by SQLite persistence under ``~/.tui-pilot`` (sessions,
roles, projects, accounts, missions). On startup ``_reconcile_sessions()``
reattaches any still-live tmux agents from the previous run and
``orchestrator_server.reload_missions()`` restores their missions (and persisted
autopilot flags); dead rows are marked exited.

On top of the raw drive-a-TUI API this
adds **agent roles**: presets (Planner, Developer, …) — seeded from
``roles.yaml`` into SQLite and editable via ``/roles`` — that customise an
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

import logging
import os
import shlex
import threading
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import accounts, projects, roles_seed, sessions_store
from .comms import Hub
from .controller import Controller
from .harness import HarnessPoller
from .identity import new_agent_id
from .models import model_id
from .screen import State, parse_menu
from .session import (
    SessionError,
    TmuxSession,
    build_cmd,
    install_comms_skill,
    install_orchestrator_skill,
    install_spade_data_skill,
)

logger = logging.getLogger("tui_pilot")

app = FastAPI(
    title="tui-pilot",
    description="Drive & orchestrate interactive TUI agents over HTTP, via tmux only.",
    version="0.2.0",
)

# Orchestrator wiring (missions/brakes state, executor callbacks, drain helpers,
# and its HTTP router) lives in a separate module to keep this file focused on
# session plumbing. Imported here for module load; its functions reach back into
# this module's internals lazily (no import cycle at load time).
import sys  # noqa: E402

from . import orchestrator_server  # noqa: E402
from . import registry_server  # noqa: E402
from . import spade_server  # noqa: E402

app.include_router(orchestrator_server.router)
app.include_router(registry_server.router)
app.include_router(spade_server.router)

# This module object, passed to orchestrator_server helpers so they can reach
# back into the registry (_sessions/_meta/_pollers/_lock_for/_spawn_agent/…)
# without a load-time import cycle.
_module = sys.modules[__name__]

_ROLES_PATH = Path(__file__).resolve().parent.parent / "roles.yaml"


def load_roles() -> dict[str, dict]:
    """Load agent-role presets from roles.yaml, keyed by id (seed source only)."""
    if not _ROLES_PATH.exists():
        return {}
    data = yaml.safe_load(_ROLES_PATH.read_text()) or {}
    return {r["id"]: r for r in data.get("roles", [])}


def refresh_roles() -> None:
    """Reload ROLES from the DB (after a seed or a role edit)."""
    global ROLES
    ROLES = roles_seed.load_roles_from_db()


def _ensure_roles() -> None:
    """Seed the DB from YAML if empty and refresh the in-memory ROLES map.

    Role-dependent paths call this so they work even under the per-test fixture
    that hands each test a fresh, empty DB (ROLES is set once at import time and
    would otherwise be stale/empty).

    Hot-path trim: ``seed_if_empty()`` is one cheap idempotent SELECT count, but
    the SELECT * in ``refresh_roles()`` only runs when ``ROLES`` is currently
    empty. On a fresh-DB test, ``seed_if_empty()`` repopulates the table and
    ``refresh_roles()`` reloads it; in production after the first load, ``ROLES``
    stays non-empty so we skip the per-spawn SELECT *."""
    roles_seed.seed_if_empty()
    roles_seed.upsert_pipeline_roles()
    if not ROLES or "integrator" not in ROLES:
        refresh_roles()


# Seed + load at import; role-dependent code paths re-ensure lazily.
roles_seed.seed_if_empty()
# Ensure the pipeline roles (integrator/documentor added after the foundation
# seed) exist even on an already-seeded DB, then reload ROLES.
roles_seed.upsert_pipeline_roles()
ROLES = roles_seed.load_roles_from_db()

# In-memory registry. Guarded by a registry lock for structural changes; each
# session has its own lock serialising *mutating* tmux operations. Read-only
# captures (state/screen) intentionally skip the lock so the UI stays live even
# while a session is mid-prime or mid-turn.
_sessions: dict[str, Controller] = {}
_meta: dict[str, dict] = {}
_locks: dict[str, threading.Lock] = {}
_registry_lock = threading.Lock()
_order = 0

# Per-session harness pollers. Each agent's mailbox lives INSIDE its own working
# directory (`<cwd>/.agent-comms/<id>/...`) — not a central hub — so that an
# agent in `accept-edits`/`auto` mode can write its signal files without tripping
# a permission prompt (writes inside the cwd are auto-accepted). The control
# center already knows each session's cwd, so "agents in many directories" still
# works: each session's poller watches that session's own mailbox.
_pollers: dict[str, HarnessPoller] = {}


def _hub_for(cwd: str) -> Hub:
    """Return the mailbox hub rooted in an agent's working directory."""
    return Hub(Path(cwd) / ".agent-comms")


def _advance_login_sessions() -> None:
    """Login sessions have no poller. After the human completes the OAuth login,
    Claude shows "Login successful. Press Enter to continue…" and waits — auto-press
    Enter once (per session) so a finished login isn't left hanging on that screen."""
    for aid, m in list(_meta.items()):
        if m.get("role") != "login" or m.get("login_continued"):
            continue
        ctrl = _sessions.get(aid)
        if ctrl is None:
            continue
        try:
            screen = ctrl.session.capture().lower()
            if "press enter to continue" in screen or "login successful" in screen:
                with _lock_for(aid):
                    ctrl.session.send_key("Enter")
                m["login_continued"] = True
        except Exception:  # noqa: BLE001 - never let one session kill the loop
            pass


def _poll_loop() -> None:
    """Daemon: tick every poller ~1s so progress/finish/handoff are processed
    without the UI having to poll. One poller raising must not stop the loop.

    Two-phase per tick to honour the concurrency invariant (hold at most ONE
    session lock at a time; never send into another session while holding one):

      1. COLLECT — for each session, under ITS OWN lock: a worker runs the normal
         ``poller.poll()`` (and, if it has a parent, we gather any cross-session
         forward notes); an orchestrator instead scans+parses+marks its outbox
         and we gather ``(orch, signal)`` descriptors. We only GATHER here — we
         never send into another session or run the executor under a lock.
      2. DRAIN — after ALL session locks are released: run gathered signals
         through the executor and deliver results/forwards. Each drained item
         takes at most ONE target session lock.
    """
    while True:
        signals: list = []   # (orch_aid, OrchestrationSignal)
        forwards: list = []  # (orch_aid, note)
        advances: list = []  # (run_id, stage_idx, report) for parentless pipeline stages
        for aid, poller in list(_pollers.items()):
            try:
                # HarnessPoller is not internally synchronized; every poll()
                # must run under the session lock (same lock answer()/
                # confirm_handoff() take) so unlocked loop polls don't race.
                with _lock_for(aid):
                    if _meta.get(aid, {}).get("is_orchestrator"):
                        # Orchestrator: scan its outbox for orchestration signals
                        # instead of the normal worker poll. Executor runs later,
                        # in the unlocked DRAIN phase.
                        signals.extend(
                            orchestrator_server.collect_orchestrator(_module, aid)
                        )
                    else:
                        st = poller.poll()
                        # Worker with a parent: gather forward notes (questions /
                        # permission prompts) — no send under this lock.
                        forwards.extend(
                            orchestrator_server.collect_worker_forward(_module, aid, st)
                        )
                        # Pipeline stage (parentless, has a pipeline_run_id):
                        # gather a once-only auto-advance item. collect_worker_forward
                        # returns early for parentless workers, so there is no
                        # conflict with orchestrator finish-forwarding.
                        item = _collect_pipeline_advance(aid, st)
                        if item is not None:
                            advances.append(item)
            except Exception:  # noqa: BLE001 - never let one agent kill the loop
                pass
        _advance_login_sessions()
        # DRAIN: no session lock held here; each item takes at most one lock.
        try:
            orchestrator_server.drain(_module, signals, forwards)
        except Exception:  # noqa: BLE001 - never let drain kill the loop
            pass
        for run_id, stage_idx, report in advances:
            try:
                _drain_pipeline_advance(run_id, stage_idx, report)
            except Exception:  # noqa: BLE001 - never let one advance kill the loop
                logger.warning(
                    "pipeline auto-advance failed for run %s stage %s",
                    run_id, stage_idx, exc_info=True,
                )
        time.sleep(1.0)


def _collect_pipeline_advance(aid: str, harness_state):
    """COLLECT phase (under the worker's lock): if ``aid`` is a parentless
    pipeline stage that just finished, mark it advanced once and return a
    ``(run_id, stage_idx, report)`` item; else None.

    The ``pipeline_advanced`` flag is a per-worker scratch key written under the
    worker's session lock (held by the caller), mirroring the ``finish_forwarded``
    guard in collect_worker_forward — so a stage advances exactly once.
    """
    m = _meta.get(aid)
    if not m or m.get("parent") or m.get("is_orchestrator"):
        return None
    run_id = m.get("pipeline_run_id")
    if not run_id:
        return None
    if harness_state is None or harness_state.kind != "done":
        return None
    if m.get("pipeline_advanced"):
        return None
    # Confirm the run still exists before claiming the advance.
    from . import pipelines
    if pipelines.get(run_id) is None:
        return None
    m["pipeline_advanced"] = True
    report = (harness_state.report or "").strip()
    return (run_id, m.get("pipeline_stage_idx", 0), report)


def _drain_pipeline_advance(run_id: str, stage_idx: int, report: str) -> None:
    """DRAIN phase (no session lock held): complete the finished stage and start
    the next (or ship the run). The spawn callback may take _registry_lock."""
    from . import pipelines
    from .spade_server import _pipeline_spawn

    run = pipelines.get(run_id)
    if run is None:
        return
    pipelines.complete_stage(run_id, stage_idx, report, spawn=_pipeline_spawn(run))


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
    model: str | None = Field(None, description="model tier, e.g. 'sonnet' | 'opus' | 'haiku'")
    mission: str | None = Field(None, description="the mission assigned to this worker")
    parent: str | None = Field(None, description="id of the agent that spawned this worker")
    reason: str | None = Field(None, description="why this worker was spawned")
    is_orchestrator: bool = Field(False, description="this session is the orchestrator")
    account_id: str | None = Field(None, description="explicit account (CLAUDE_CONFIG_DIR) to use")
    project_id: str | None = Field(None, description="project whose account pool to draw from")
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


class MenuRequest(BaseModel):
    index: int


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
    except (SessionError, AttributeError):
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
    # An orchestrator's outbox carries ORCHESTRATION signals (spawn/answer/…),
    # which the harness poller would quarantine as unknown actions — and racing
    # this read-path poll against the loop's collect_orchestrator would steal the
    # signal before it is dispatched. So skip the harness poll for orchestrators;
    # the poll loop scans their outbox via collect_orchestrator instead.
    if poller is not None and not m.get("is_orchestrator"):
        with _lock_for(aid):
            harness_state = poller.poll().kind
    # Surface whether the agent is showing an interactive menu so the UI can
    # render a menu card. Lock-free read (capture only); guard against a dead
    # session so listing never 500s.
    try:
        has_menu = parse_menu(ctrl.session.capture()) is not None
    except SessionError:
        has_menu = False
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
        "model": m.get("model"),
        "mission": m.get("mission"),
        "parent": m.get("parent"),
        "reason": m.get("reason"),
        "state": _safe_state(ctrl),
        "harness_state": harness_state,
        "has_menu": has_menu,
        "account_id": m.get("account_id"),
        "project_id": m.get("project_id"),
    }


def _prime(aid: str) -> None:
    """Background worker: boot → accept the trust prompt → ready.

    Mode and the first message are now configured at LAUNCH (``--permission-mode``
    / ``--dangerously-skip-permissions`` and Claude's prompt argument), so this no
    longer cycles Shift-Tab or types the first message — it only waits for the REPL
    and clears the one-time "trust this folder?" prompt that can block boot."""
    ctrl = _sessions.get(aid)
    if ctrl is None:
        return
    m = _meta[aid]
    lock = _lock_for(aid)
    try:
        # wait for the REPL to finish booting.
        ctrl.wait_for_settle(timeout=40)

        # A fresh working directory triggers Claude's "Quick safety check / trust
        # this folder?" prompt at boot, which blocks before the launch prompt runs.
        # The default selection (❯) is "Yes, I trust this folder", so a bare Enter
        # accepts it; Claude then proceeds with the launch prompt. We provision the
        # cwd ourselves, so this is expected.
        boot_screen = ctrl.session.capture().lower()
        if "trust this folder" in boot_screen or "quick safety check" in boot_screen:
            with lock:
                ctrl.session.send_key("Enter")
            ctrl.wait_for_settle(timeout=20)

        m["prep"] = "ready"
        m["prep_detail"] = None
    except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
        m["prep"] = "error"
        m["prep_detail"] = str(exc)


# ---- role endpoints -------------------------------------------------------


@app.get("/roles")
def list_roles() -> dict:
    """List the agent-role presets the UI can spawn."""
    _ensure_roles()
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


def _resolve_account(account_id: str | None, project_id: str | None) -> dict | None:
    """Pick the account a spawn should use.

    Precedence: an explicit ``account_id`` wins; else a ``project_id`` advances
    that project's round-robin pool (falling back to the default if the pool is
    empty); else the global default. May return None when no accounts exist.
    """
    if account_id:
        return accounts.get(account_id)
    if project_id:
        # next_account advances the round-robin cursor as a side effect; the
        # caller may still reject this spawn (not-logged-in / tmux failure),
        # intentionally consuming a rotation slot — see the call site in
        # _spawn_agent.
        aid = projects.next_account(project_id)
        return accounts.get(aid) if aid else accounts.default_account()
    return accounts.default_account()


# App permission-mode names → Claude Code's --permission-mode values. "normal"
# is Claude's default (no flag) and "bypass" uses --dangerously-skip-permissions.
_PERM_MODE = {"accept-edits": "acceptEdits", "auto": "auto", "plan": "plan"}


def _api_base() -> str:
    """Base URL agents use to reach this server's HTTP API (for the spade-data
    skill). Defaults to the README port; override with TUI_PILOT_API_BASE when
    running on a different host/port."""
    return os.environ.get("TUI_PILOT_API_BASE", "http://127.0.0.1:8765")


def _build_first_message(aid: str, instructions: str | None, task: str | None) -> str:
    """The agent's first message: a control-center preamble + role instructions +
    (optional) task, collapsed to a single line. Passed as Claude's launch prompt
    so Claude submits it directly. Empty when there's nothing to prime/task."""
    instructions = (instructions or "").strip()
    task = (task or "").strip()
    if not instructions and not task:
        return ""
    parts = [
        f"You are agent '{aid}' running under an automated control center. To ask "
        "a question, request context/help, report progress, or finish, use the "
        "agent-comms skill (it has your exact outbox path). "
    ]
    if instructions:
        parts.append(instructions)
    if task:
        parts.append(" --- YOUR TASK (begin now) --- " + task)
    else:
        parts.append(
            " Acknowledge in one sentence that you are ready, then wait for my "
            "next message."
        )
    # Collapse all whitespace so it's a clean single-line prompt argument.
    return " ".join("".join(parts).split())


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
    model: str | None = None,
    mission: str | None = None,
    parent: str | None = None,
    reason: str | None = None,
    is_orchestrator: bool = False,
    account_id: str | None = None,
    project_id: str | None = None,
) -> dict:
    """Spawn a (optionally role-based) agent session and return its info.

    A plain callable so both the ``POST /sessions`` route and the harness
    handoff callback can spawn successors. An unknown ``role`` is tolerated here
    (it falls back to the provided ``cmd``/``mode`` defaults) — the route layer
    is responsible for 400ing unknown roles on direct API calls.
    """
    global _order
    _ensure_roles()
    role_def = ROLES.get(role) if role else None

    eff_cmd = cmd or (role_def.get("cmd") if role_def else None) or "claude"
    eff_mode = mode or (role_def.get("mode") if role_def else None) or "normal"

    # Permission mode is set at LAUNCH (no flaky post-boot Shift-Tab cycling):
    # bypass keeps the explicit danger flag; the others map to --permission-mode.
    # "normal" is Claude's default and needs no flag.
    if eff_mode == "bypass":
        if "dangerously-skip-permissions" not in eff_cmd:
            eff_cmd = f"{eff_cmd} --dangerously-skip-permissions"
    else:
        perm = _PERM_MODE.get(eff_mode)
        if perm and "--permission-mode" not in eff_cmd:
            eff_cmd = f"{eff_cmd} --permission-mode {perm}"
    # Launch the worker on the requested model tier (idempotent; no-op if None).
    eff_cmd = build_cmd(eff_cmd, model_id(model))
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
    # An empty working dir defaults to a per-agent scratch workspace — NOT the
    # server's own cwd — so an agent can't clobber the tui-pilot project's own
    # files (e.g. a Planner overwriting our real plan.md). Callers who want an
    # agent to work in a specific project pass `cwd` explicitly.
    if cwd:
        eff_cwd = cwd
    else:
        eff_cwd = str(Path.home() / ".tui-pilot" / "workspaces" / aid)
        os.makedirs(eff_cwd, exist_ok=True)

    # Resolve which account (CLAUDE_CONFIG_DIR) this session runs under BEFORE
    # spawning, so we can inject the config dir and guard against an account that
    # isn't logged in. The round-robin advance happens here too (atomic in the DB).
    acct = _resolve_account(account_id, project_id)
    # Note: for a round_robin project the cursor has already advanced by this
    # point; a rejected spawn (auth guard / tmux failure below) consumes a
    # rotation slot intentionally — the retry then lands on the next account
    # rather than re-hitting the same one.
    if acct and accounts.auth_status(acct["config_dir"]) == "not_logged_in":
        raise HTTPException(
            status_code=400, detail=f"account {acct['id']} is not logged in"
        )
    env = {"CLAUDE_CONFIG_DIR": acct["config_dir"]} if acct else {}

    # Pass the first message (preamble + instructions + task) as Claude's launch
    # PROMPT argument instead of typing it into the TUI afterwards. Claude submits
    # it itself, so we avoid the bracketed-paste bug where a long typed message
    # sits unsubmitted in the composer (the agent looked "frozen" on start).
    first_msg = _build_first_message(aid, eff_instructions, eff_task)
    if first_msg:
        eff_cmd = f"{eff_cmd} {shlex.quote(first_msg)}"

    sess = TmuxSession(aid, eff_cmd, cols=cols, rows=rows, cwd=eff_cwd, env=env)
    try:
        sess.spawn()
    except SessionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Provision the mailbox (inside the agent's cwd) + agent-comms skill, then
    # attach a harness poller so the background loop can surface signals and
    # orchestrate finish/handoff.
    hub = _hub_for(eff_cwd)
    hub.agent_dir(aid)
    _outbox = str(hub.agent_dir(aid) / "outbox")
    install_comms_skill(eff_cwd, outbox_path=_outbox, agent_id=aid)
    if is_orchestrator:
        # the orchestrator also gets the spawn/answer/kill/status action shapes
        install_orchestrator_skill(eff_cwd, outbox_path=_outbox, agent_id=aid)
        # …and the spade-data skill so it can READ + DRIVE the app (projects,
        # backlog, brain, pipelines) over the local HTTP API instead of guessing
        # from the filesystem.
        install_spade_data_skill(eff_cwd, api_base=_api_base())

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
            "model": model,
            "mission": mission,
            "parent": parent,
            "reason": reason,
            "is_orchestrator": is_orchestrator,
            "account_id": acct and acct["id"],
            "project_id": project_id,
        }
        # Persist the session row (best-effort: a DB hiccup must not abort the
        # in-memory spawn, which is the live source of truth). Inside the same
        # registry-lock block so the in-memory + persisted records are atomic.
        try:
            sessions_store.insert(
                id=aid,
                project_id=project_id,
                account_id=(acct and acct["id"]),
                name=name,
                role=role,
                model=model,
                mode=eff_mode,
                cwd=eff_cwd,
                mission_id=mission,
                parent=parent,
                reason=reason,
                is_orchestrator=1 if is_orchestrator else 0,
                sort_order=_order,
                status="live",
                created_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception:  # noqa: BLE001 - persistence is best-effort (still swallowed)
            logger.warning("failed to persist session %s", aid, exc_info=True)
        _pollers[aid] = HarnessPoller(
            aid, sess, hub, cwd=eff_cwd,
            on_handoff=_make_handoff(predecessor_aid=aid, name_hint=name, cwd=eff_cwd),
        )

    # Register the mission so it shows up in GET /missions even before any
    # orchestration signal references it (lazy-creates the mission record).
    if mission:
        orchestrator_server._mission(mission)

    # Kick off priming in the background (mode + instructions need a live REPL).
    threading.Thread(target=_prime, args=(aid,), daemon=True).start()
    # _info() acquires the session lock (for harness_state) — call it OUTSIDE
    # the _registry_lock block above to keep the lock ordering acyclic.
    return _info(aid)


def _reconcile_sessions(is_alive=None) -> list[str]:
    """Reattach still-live tmux sessions on startup; mark the rest exited.

    For each persisted ``live`` session: if its tmux session is still alive,
    rebuild the in-memory registry entry (Controller/lock/poller/meta) with the
    SAME wiring as _spawn_agent and keep it ``live``; otherwise mark it
    ``exited`` in the DB. Per-row work is wrapped so one bad row can't abort the
    whole reconcile. Returns the ids that were kept (reattached)."""
    global _order
    if is_alive is None:
        is_alive = lambda sid: TmuxSession(sid, "").is_alive()  # noqa: E731
    _ensure_roles()
    kept: list[str] = []
    max_order = 0
    rows = sessions_store.all_live()
    with _registry_lock:
        for row in rows:
            sid = row["id"]
            try:
                max_order = max(max_order, row.get("sort_order") or 0)
                if not is_alive(sid):
                    sessions_store.set_status(sid, "exited")
                    continue
                cwd = row.get("cwd")
                sess = TmuxSession(sid, "claude", cwd=cwd)
                _sessions[sid] = Controller(sess)
                _locks[sid] = threading.Lock()
                hub = _hub_for(cwd)
                _pollers[sid] = HarnessPoller(
                    sid, sess, hub, cwd=cwd,
                    on_handoff=_make_handoff(
                        predecessor_aid=sid, name_hint=row.get("name") or sid, cwd=cwd
                    ),
                )
                role_def = ROLES.get(row.get("role")) if row.get("role") else None
                _meta[sid] = {
                    "id": sid,
                    "name": row.get("name") or sid,
                    "cwd": cwd,
                    "role": row.get("role"),
                    "label": (role_def.get("label") if role_def else None)
                    or (row.get("name") or sid),
                    "emoji": (role_def.get("emoji") if role_def else None) or "💬",
                    "mode": row.get("mode"),
                    "instructions": (role_def.get("instructions", "") if role_def else ""),
                    "task": None,
                    "prep": "ready",
                    "prep_detail": None,
                    "order": row.get("sort_order") or 0,
                    "model": row.get("model"),
                    "mission": row.get("mission_id"),
                    "parent": row.get("parent"),
                    "reason": row.get("reason"),
                    "is_orchestrator": bool(row.get("is_orchestrator")),
                    "account_id": row.get("account_id"),
                    "project_id": row.get("project_id"),
                }
                # Restore pipeline linkage from already-persisted stage data so a
                # reattached pipeline-stage worker stays visible to the
                # auto-advance collector. Best-effort: never break reconcile.
                # Deliberately do NOT set pipeline_advanced, so a stage that
                # finished during downtime can still advance after reattach.
                try:
                    from tui_pilot import pipelines
                    link = pipelines.stage_by_session(sid)
                    if link is not None:
                        _meta[sid]["pipeline_run_id"] = link["pipeline_run_id"]
                        _meta[sid]["pipeline_stage_idx"] = link["stage_order"]
                except Exception:  # noqa: BLE001 - best-effort linkage restore
                    logger.warning(
                        "failed to restore pipeline linkage for %s", sid,
                        exc_info=True,
                    )
                kept.append(sid)
            except Exception:  # noqa: BLE001 - one bad row can't abort reconcile (swallowed)
                logger.warning("failed to reconcile session %s", sid, exc_info=True)
        # Resume the module order counter past the highest reattached row.
        _order = max(_order, max_order)
    return kept


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
    _ensure_roles()
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
        model=req.model,
        mission=req.mission,
        parent=req.parent,
        reason=req.reason,
        is_orchestrator=req.is_orchestrator,
        account_id=req.account_id,
        project_id=req.project_id,
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


@app.get("/sessions/{id}/menu")
def get_menu(id: str) -> dict:
    """The agent's current interactive menu (prompt + options + selection), or
    null if no menu is on screen. Lock-free read (capture only)."""
    ctrl = _get(id)
    try:
        screen = ctrl.session.capture()
    except SessionError as exc:
        raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"menu": parse_menu(screen)}


@app.post("/sessions/{id}/menu")
def post_menu(id: str, req: MenuRequest) -> dict:
    """Select a menu option by index: navigate the cursor with arrow keystrokes
    (Up/Down from the currently-selected row) then press Enter."""
    ctrl = _get(id)
    with _lock_for(id):
        menu = parse_menu(ctrl.session.capture())
        if not menu:
            raise HTTPException(409, "no active menu")
        if req.index not in {o["index"] for o in menu["options"]}:
            raise HTTPException(400, f"option {req.index} not in menu")
        delta = req.index - menu["selected"]
        key = "Down" if delta > 0 else "Up"
        for _ in range(abs(delta)):
            ctrl.session.send_key(key)
            time.sleep(0.05)
        ctrl.session.send_key("Enter")
    return {"ok": True, "selected": req.index}


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


# Reattach any still-live tmux sessions persisted by a prior run, AFTER all
# helpers above are defined (the poll loop thread, started near the top, only
# begins ticking these once they are in the registry). Best-effort: a reconcile
# failure must never stop import/startup.
try:
    _reconcile_sessions()
    # Restore persisted missions (and their autopilot flags) into the in-memory
    # _missions dict so a reattached worker's mission is live in GET /missions
    # immediately — a persisted autopilot=1 must not silently degrade to
    # supervised until the mission is next referenced.
    orchestrator_server.reload_missions()
except Exception:  # noqa: BLE001 - startup reconcile is best-effort (swallowed)
    logger.warning("startup session reconcile failed", exc_info=True)


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)


if __name__ == "__main__":
    main()
