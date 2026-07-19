"""Stale-session reaper: dead / idle-past-TTL / orphan reaping."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from tui_pilot import server, sessions_store
from tui_pilot.screen import State


class FakeSession:
    def __init__(self, *, alive=True, menu=False):
        self._alive = alive
        self.cmd = "claude"
        self.cwd = "/w"
        self.killed = False
        self._menu = menu

    def is_alive(self):
        return self._alive

    def kill(self):
        self.killed = True
        self._alive = False

    # parse_menu(capture()) is None unless we want a pending menu
    def capture(self, history=False, ansi=False):
        return "❯ 1. Yes\n  2. No" if self._menu else "idle screen"


class FakeCtrl:
    def __init__(self, session, state=State.IDLE):
        self.session = session
        self._state = state

    def state(self):
        return self._state


def _register(aid, *, state=State.IDLE, alive=True, menu=False,
              created_at=None, status="live"):
    """Put a fake session in the registry + store the way a spawn would."""
    sess = FakeSession(alive=alive, menu=menu)
    server._sessions[aid] = FakeCtrl(sess, state=state)
    server._locks[aid] = __import__("threading").Lock()
    server._meta[aid] = {"id": aid, "name": aid, "cwd": "/w"}
    sessions_store.insert(
        id=aid, status=status, cwd="/w", name=aid,
        created_at=created_at or datetime.now(timezone.utc).isoformat(),
    )
    return sess


def _cleanup_registry(*aids):
    with server._registry_lock:
        for aid in aids:
            server._sessions.pop(aid, None)
            server._locks.pop(aid, None)
            server._meta.pop(aid, None)
            server._pollers.pop(aid, None)


def test_reaps_dead_keeps_live_idle_under_ttl():
    old = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
    fresh = datetime.now(timezone.utc).isoformat()
    _register("dead-1", alive=False, created_at=old)
    fresh_sess = _register("idle-fresh", state=State.IDLE, created_at=fresh)
    try:
        # is_alive injected (avoid real tmux); fresh session is younger than TTL.
        reaped = server.reap_sessions(
            ttl_s=3600,
            is_alive=lambda sid: sid != "dead-1",
            tmux_names=lambda: [],
        )
        assert reaped["dead"] == ["dead-1"]
        assert reaped["idle"] == []  # fresh idle session stays
        assert "dead-1" not in server._sessions and "idle-fresh" in server._sessions
        assert not fresh_sess.killed
        # dead row marked exited in the store
        assert sessions_store.get("dead-1")["status"] == "exited"
    finally:
        _cleanup_registry("dead-1", "idle-fresh")


def test_reaps_idle_past_ttl_but_not_busy_or_menu():
    old = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
    idle = _register("idle-old", state=State.IDLE, created_at=old)
    busy = _register("busy-old", state=State.STREAMING, created_at=old)
    menu = _register("menu-old", state=State.IDLE, menu=True, created_at=old)
    try:
        reaped = server.reap_sessions(
            ttl_s=3600, is_alive=lambda sid: True, tmux_names=lambda: [],
        )
        assert reaped["idle"] == ["idle-old"]
        assert idle.killed                       # idle + old → killed
        assert not busy.killed and "busy-old" in server._sessions   # WORKING kept
        assert not menu.killed and "menu-old" in server._sessions   # pending menu kept
    finally:
        _cleanup_registry("idle-old", "busy-old", "menu-old")


def test_force_idle_reaps_regardless_of_age():
    fresh = _register("idle-fresh2", state=State.IDLE)
    try:
        reaped = server.reap_sessions(
            force_idle=True, is_alive=lambda sid: True, tmux_names=lambda: [],
        )
        assert reaped["idle"] == ["idle-fresh2"] and fresh.killed
    finally:
        _cleanup_registry("idle-fresh2")


def test_orphan_tmux_not_in_registry_is_killed(monkeypatch):
    # A store row that is NOT live, whose tmux is still alive → orphan.
    sessions_store.insert(id="orph-1", status="exited", cwd="/w", name="orph-1",
                          created_at=datetime.now(timezone.utc).isoformat())
    killed = []

    class _T:
        def __init__(self, name, *a, **k): self.name = name
        def kill(self): killed.append(self.name)

    monkeypatch.setattr(server, "TmuxSession", _T)
    reaped = server.reap_sessions(
        ttl_s=0, is_alive=lambda sid: True,
        tmux_names=lambda: ["orph-1", "some-humans-shell"],
    )
    # only our orphan row is reaped; the unrelated shell is left alone
    assert reaped["orphan"] == ["orph-1"] and killed == ["orph-1"]


def test_cleanup_endpoint_reaps_idle_with_force():
    fresh = _register("idle-ep", state=State.IDLE)
    try:
        c = TestClient(server.app)
        # No real tmux server in tests → orphan sweep finds nothing; idle=true
        # forces the fresh idle session to be reaped.
        r = c.post("/sessions/cleanup", params={"idle": "true"})
        assert r.status_code == 200
        body = r.json()
        assert "idle-ep" in body["idle"] and body["count"] >= 1
        assert fresh.killed
    finally:
        _cleanup_registry("idle-ep")


def test_deleting_a_project_kills_its_sessions():
    from tui_pilot import projects

    projects.create(id="proj-x", name="X", path="/w")
    projects.create(id="proj-y", name="Y", path="/w")
    mine = _register("orch-x", state=State.IDLE)
    mine_w = _register("dev-x", state=State.STREAMING)   # a busy worker is killed too
    other = _register("orch-y", state=State.IDLE)
    # tag sessions to their projects
    server._meta["orch-x"]["project_id"] = "proj-x"
    server._meta["dev-x"]["project_id"] = "proj-x"
    server._meta["orch-y"]["project_id"] = "proj-y"
    try:
        c = TestClient(server.app)
        r = c.delete("/projects/proj-x")
        assert r.status_code == 200
        killed = r.json()["sessions_killed"]
        assert set(killed) == {"orch-x", "dev-x"}
        # proj-x sessions are gone + tmux killed; proj-y is untouched
        assert mine.killed and mine_w.killed and not other.killed
        assert "orch-x" not in server._sessions and "dev-x" not in server._sessions
        assert "orch-y" in server._sessions
    finally:
        _cleanup_registry("orch-x", "dev-x", "orch-y")


def test_reaps_finished_lifecycle_agent_immediately(monkeypatch):
    # Reload-robust: an idle agent whose run has advanced past its phase (matched
    # via the persisted mission=run id + role=phase) is done — reaped on the next
    # sweep, not after the 2h idle TTL. A session tied to no run is kept.
    from tui_pilot import lifecycle
    done = _register("scoping-done", state=State.IDLE)
    server._meta["scoping-done"].update({"mission": "run-1", "role": "scoping"})
    keep = _register("solo-idle", state=State.IDLE)  # no mission → not tied to a run
    monkeypatch.setattr(
        lifecycle, "get",
        lambda rid: {"id": rid, "phase": "synthesis", "agent_session_id": "synth-x"} if rid == "run-1" else None,
    )
    try:
        reaped = server.reap_sessions(
            ttl_s=3600, is_alive=lambda sid: True, tmux_names=lambda: [],
        )
        assert reaped["done"] == ["scoping-done"]         # scoping != synthesis → stale
        assert done.killed and "scoping-done" not in server._sessions
        assert not keep.killed and "solo-idle" in server._sessions
    finally:
        _cleanup_registry("scoping-done", "solo-idle")
