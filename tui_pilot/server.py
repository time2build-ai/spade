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

import threading
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .controller import Controller
from .screen import State
from .session import SessionError, TmuxSession

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


# ---- helpers --------------------------------------------------------------


def _get(name: str) -> Controller:
    ctrl = _sessions.get(name)
    if ctrl is None:
        raise HTTPException(status_code=404, detail=f"no session named {name!r}")
    return ctrl


def _lock_for(name: str) -> threading.Lock:
    with _registry_lock:
        return _locks.setdefault(name, threading.Lock())


def _safe_state(ctrl: Controller) -> str:
    try:
        return ctrl.state().value
    except SessionError:
        return State.EXITED.value


def _info(name: str) -> dict:
    ctrl = _sessions[name]
    m = _meta.get(name, {})
    return {
        "name": name,
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
    }


def _prime(name: str) -> None:
    """Background worker: boot → set mode → inject instructions → ready."""
    ctrl = _sessions.get(name)
    if ctrl is None:
        return
    m = _meta[name]
    lock = _lock_for(name)
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

            # 3. inject the role instructions as the first message (priming).
            if instructions:
                m["prep"] = "priming"
                m["prep_detail"] = "sending instructions"
                ctrl.prompt(instructions, timeout=120)

            # 4. if a specific mission was given, kick it off immediately so the
            # agent starts working on spawn (e.g. "Plan a Salesforce
            # integration" / "Implement plan.md").
            task = (m.get("task") or "").strip()
            if task:
                m["prep"] = "working"
                m["prep_detail"] = task[:80]
                result = ctrl.prompt(task, timeout=1800)
                m["task_state"] = result.get("state").value if result.get("state") else None

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


@app.post("/sessions")
def create_session(req: SpawnRequest) -> dict:
    """Spawn a new (optionally role-based) agent session.

    Returns immediately; priming (mode + instructions) runs in the background.
    Poll ``GET /sessions`` or ``GET /sessions/{name}`` and watch ``prep`` go
    ``booting`` → ``priming`` → ``ready``.
    """
    global _order
    role = ROLES.get(req.role) if req.role else None
    if req.role and role is None:
        raise HTTPException(status_code=400, detail=f"unknown role {req.role!r}")

    cmd = req.cmd or (role.get("cmd") if role else None) or "claude"
    mode = req.mode or (role.get("mode") if role else None) or "normal"

    # "bypass" is the one mode not reachable via Shift-Tab keystrokes; it must be
    # requested at launch with --dangerously-skip-permissions. We still drive the
    # session purely through tmux afterwards — this only configures startup.
    if mode == "bypass" and "dangerously-skip-permissions" not in cmd:
        cmd = f"{cmd} --dangerously-skip-permissions"
    instructions = (
        req.instructions
        if req.instructions is not None
        else (role.get("instructions", "") if role else "")
    )

    with _registry_lock:
        if req.name in _sessions:
            raise HTTPException(status_code=409, detail="session already exists")
        sess = TmuxSession(req.name, cmd, cols=req.cols, rows=req.rows, cwd=req.cwd)
        try:
            sess.spawn()
        except SessionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _sessions[req.name] = Controller(sess)
        _locks[req.name] = threading.Lock()
        _order += 1
        _meta[req.name] = {
            "role": req.role,
            "label": (role.get("label") if role else None) or req.name,
            "emoji": (role.get("emoji") if role else None) or "💬",
            "mode": mode,
            "instructions": instructions,
            "task": req.task,
            "prep": "booting",
            "prep_detail": None,
            "order": _order,
        }

    # Kick off priming in the background (mode + instructions need a live REPL).
    threading.Thread(target=_prime, args=(req.name,), daemon=True).start()
    return _info(req.name)


@app.get("/sessions")
def list_sessions() -> dict:
    """List all sessions with role, prep status and live state."""
    with _registry_lock:
        names = list(_sessions.keys())
    sessions = [_info(n) for n in names]
    sessions.sort(key=lambda s: s.get("order") or 0)
    return {"sessions": sessions}


@app.get("/sessions/{name}")
def get_session(name: str) -> dict:
    _get(name)
    return _info(name)


@app.get("/sessions/{name}/state")
def get_state(name: str) -> dict:
    ctrl = _get(name)
    return {"name": name, "state": _safe_state(ctrl), "prep": _meta.get(name, {}).get("prep")}


@app.get("/sessions/{name}/screen", response_class=PlainTextResponse)
def get_screen(name: str, history: bool = False) -> str:
    ctrl = _get(name)
    try:
        return ctrl.session.capture(history=history)
    except SessionError as exc:
        raise HTTPException(status_code=410, detail=str(exc)) from exc


@app.post("/sessions/{name}/prompt")
def post_prompt(name: str, req: PromptRequest) -> dict:
    ctrl = _get(name)
    with _lock_for(name):
        try:
            result = ctrl.prompt(req.text, timeout=req.timeout)
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"response": result["response"], "state": result["state"].value}


@app.post("/sessions/{name}/key")
def post_key(name: str, req: KeyRequest) -> dict:
    ctrl = _get(name)
    with _lock_for(name):
        try:
            ctrl.session.send_key(req.key)
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/sessions/{name}/mode")
def post_mode(name: str, req: ModeRequest) -> dict:
    ctrl = _get(name)
    if req.mode == "bypass":
        # bypass can't be toggled on a running session; it needs a relaunch with
        # the danger flag. Tell the caller to respawn with mode=bypass instead.
        raise HTTPException(
            status_code=409,
            detail="'bypass' must be set at spawn (relaunch with mode=bypass); "
            "it is not reachable on a running session.",
        )
    with _lock_for(name):
        try:
            ok = ctrl.set_mode(req.mode)
        except (SessionError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if name in _meta:
        _meta[name]["mode"] = req.mode
    return {"ok": ok, "mode": ctrl.current_mode()}


@app.post("/sessions/{name}/approve")
def post_approve(name: str) -> dict:
    ctrl = _get(name)
    with _lock_for(name):
        try:
            ctrl.approve()
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/sessions/{name}/deny")
def post_deny(name: str) -> dict:
    ctrl = _get(name)
    with _lock_for(name):
        try:
            ctrl.deny()
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/sessions/{name}/interrupt")
def post_interrupt(name: str) -> dict:
    ctrl = _get(name)
    with _lock_for(name):
        try:
            ctrl.interrupt()
        except SessionError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
    return {"ok": True}


@app.delete("/sessions/{name}")
def delete_session(name: str) -> dict:
    with _registry_lock:
        ctrl = _sessions.pop(name, None)
        _locks.pop(name, None)
        _meta.pop(name, None)
    if ctrl is None:
        raise HTTPException(status_code=404, detail=f"no session named {name!r}")
    ctrl.session.kill()
    return {"name": name, "status": "killed"}


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
