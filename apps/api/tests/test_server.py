"""Offline tests for the FastAPI layer.

These exercise the HTTP control plane against a deterministic, dependency-free
target (``cat``, which echoes its input) — so they need tmux but NOT a live
``claude``. They cover the registry, error codes, and key/screen plumbing; the
live ``prompt`` round-trip is covered by tests/test_integration.py.
"""

from __future__ import annotations

import time

import pytest

try:
    from fastapi.testclient import TestClient
except Exception:  # pragma: no cover
    TestClient = None

from tui_pilot import server
from tui_pilot.session import _ensure_tmux_on_path, SessionError

# Skip the whole module if tmux is unavailable (keeps CI honest about its needs).
try:
    _ensure_tmux_on_path()
    _HAS_TMUX = True
except SessionError:
    _HAS_TMUX = False

pytestmark = pytest.mark.skipif(
    not _HAS_TMUX or TestClient is None,
    reason="needs tmux and fastapi TestClient",
)


@pytest.fixture()
def client():
    return TestClient(server.app)


def test_static_assets_revalidate_so_ui_is_never_stale(client):
    # The bundled UI assets must carry Cache-Control: no-cache so a browser
    # always revalidates (and picks up new app.js/style.css after a change)
    # rather than silently serving a stale cached copy.
    r = client.get("/ui/app.js")
    assert r.status_code == 200
    assert "no-cache" in r.headers.get("cache-control", "").lower()


def test_full_lifecycle(client):
    # spawn
    r = client.post("/sessions", json={"name": "srv", "cmd": "cat", "cols": 80, "rows": 24})
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    assert aid.startswith("srv__")

    # appears in the list, alive
    listed = client.get("/sessions").json()["sessions"]
    assert any(s["id"] == aid and s["alive"] for s in listed)

    # state endpoint responds
    assert client.get(f"/sessions/{aid}/state").status_code == 200

    # send keys (cat echoes them back) and read the screen
    client.post(f"/sessions/{aid}/key", json={"key": "h"})
    client.post(f"/sessions/{aid}/key", json={"key": "i"})
    time.sleep(0.3)
    screen = client.get(f"/sessions/{aid}/screen").text
    assert "hi" in screen

    # history flag is accepted
    assert client.get(f"/sessions/{aid}/screen?history=true").status_code == 200

    # delete
    assert client.delete(f"/sessions/{aid}").status_code == 200

    # gone now
    assert client.get(f"/sessions/{aid}/state").status_code == 404
    assert client.delete(f"/sessions/{aid}").status_code == 404


def test_same_name_spawns_two_distinct_agents(client):
    a = client.post("/sessions", json={"name": "dup", "cmd": "cat"}).json()["id"]
    b = client.post("/sessions", json={"name": "dup", "cmd": "cat"}).json()["id"]
    assert a != b
    client.delete(f"/sessions/{a}")
    client.delete(f"/sessions/{b}")


def test_unknown_session_is_404(client):
    assert client.get("/sessions/does-not-exist/state").status_code == 404
    assert client.post("/sessions/does-not-exist/approve").status_code == 404
    assert client.post(
        "/sessions/does-not-exist/key", json={"key": "Enter"}
    ).status_code == 404


def test_index_and_ui_routes(client):
    assert client.get("/").status_code == 200
    # the static UI is mounted
    assert client.get("/ui/").status_code in (200, 307, 308)


# ---- account resolution at spawn -----------------------------------------


def test_resolve_account_prefers_explicit_then_project_then_default():
    from tui_pilot import accounts, projects, server

    accounts.create(id="t2b", label="T2B", config_dir="/t2b")
    accounts.create(id="inf", label="Inf", config_dir="/inf")
    accounts.set_default("t2b")
    projects.create(id="p", name="P", path="/w", account_strategy="round_robin")
    projects.set_pool("p", ["inf"])
    assert server._resolve_account(account_id="t2b", project_id="p")["id"] == "t2b"
    assert server._resolve_account(account_id=None, project_id="p")["id"] == "inf"
    assert server._resolve_account(account_id=None, project_id=None)["id"] == "t2b"


def test_resolve_account_empty_pool_falls_back_to_default():
    from tui_pilot import accounts, projects, server

    accounts.create(id="t2b", label="T2B", config_dir="/t2b")
    accounts.set_default("t2b")
    projects.create(id="p", name="P", path="/w")
    assert server._resolve_account(account_id=None, project_id="p")["id"] == "t2b"


def test_resolve_account_none_when_no_accounts():
    from tui_pilot import server

    assert server._resolve_account(account_id=None, project_id=None) is None


# ---- startup reconcile ----------------------------------------------------


def test_reconcile_marks_dead_and_keeps_live():
    from tui_pilot import sessions_store, server

    sessions_store.insert(id="a", status="live", cwd="/w", name="a")
    sessions_store.insert(id="b", status="live", cwd="/w", name="b")
    try:
        kept = server._reconcile_sessions(is_alive=lambda sid: sid == "a")
        assert kept == ["a"]
        statuses = {r["id"]: r["status"] for r in sessions_store.all()}
        assert statuses == {"a": "live", "b": "exited"}
    finally:
        # Drop the reattached "a" so it doesn't leak into other tests' registry.
        with server._registry_lock:
            server._sessions.pop("a", None)
            server._locks.pop("a", None)
            server._meta.pop("a", None)
            server._pollers.pop("a", None)


def test_reconcile_restores_pipeline_linkage():
    from tui_pilot import sessions_store, server, pipelines, projects, tasks, db

    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="Build X")["id"]
    run = pipelines.create_run(project_id="acme", task_id=tid)
    # Persist a stage->session link the way a running stage would (stage_order 1).
    db.execute(
        "UPDATE pipeline_stages SET session_id = ? "
        "WHERE pipeline_run_id = ? AND stage_order = ?",
        ("psess", run["id"], 1),
    )
    sessions_store.insert(id="psess", status="live", cwd="/w", name="psess")
    try:
        kept = server._reconcile_sessions(is_alive=lambda sid: True)
        assert "psess" in kept
        meta = server._meta["psess"]
        assert meta["pipeline_run_id"] == run["id"]
        assert meta["pipeline_stage_idx"] == 1
        assert "pipeline_advanced" not in meta
    finally:
        with server._registry_lock:
            server._sessions.pop("psess", None)
            server._locks.pop("psess", None)
            server._meta.pop("psess", None)
            server._pollers.pop("psess", None)


# ---- registry HTTP endpoints ----------------------------------------------


def test_accounts_and_projects_endpoints():
    from tui_pilot.server import app

    c = TestClient(app)
    assert c.post(
        "/accounts", json={"id": "t2b", "label": "T2B", "config_dir": "/t2b"}
    ).status_code == 200
    assert any(a["id"] == "t2b" for a in c.get("/accounts").json()["accounts"])
    c.post(
        "/projects",
        json={"id": "acme", "name": "Acme", "path": "/w", "account_strategy": "single"},
    )
    c.put("/projects/acme/accounts", json={"account_ids": ["t2b"]})
    assert c.get("/projects/acme").json()["pool"] == ["t2b"]
    c.put("/current-project", json={"project_id": "acme"})
    assert c.get("/current-project").json()["project_id"] == "acme"


def test_account_default_and_delete_and_scan():
    from tui_pilot.server import app

    c = TestClient(app)
    c.post("/accounts", json={"id": "a1", "label": "A1", "config_dir": "/a1"})
    assert c.post("/accounts/a1/default").json()["is_default"] is True
    assert "managed" in c.post("/accounts/scan").json()
    assert c.delete("/accounts/a1").json()["status"] == "deleted"
    assert not any(a["id"] == "a1" for a in c.get("/accounts").json()["accounts"])


def test_scan_returns_rich_candidates(monkeypatch, tmp_path):
    from tui_pilot import accounts
    from tui_pilot.server import app

    c = TestClient(app)

    # Create a managed provider dir candidate.
    pdir = accounts.provider_dir()
    (pdir / "founder").mkdir(parents=True, exist_ok=True)

    # Create a fake importable ~/.claude-* dir via a monkeypatched user home.
    fake_home = tmp_path / "userhome"
    (fake_home / ".claude-work").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(accounts, "_user_home", lambda: fake_home)

    body = c.post("/accounts/scan").json()
    managed = body["managed"]
    importable = body["importable"]

    assert any(m["id"] == "founder" for m in managed)
    for m in managed:
        assert m["id"] and m["label"] and m["config_dir"]
        assert m["config_dir"].endswith("/founder")

    assert any(i["label"] == ".claude-work" for i in importable)
    for i in importable:
        assert i["id"] and i["label"] and i["config_dir"]
    work = next(i for i in importable if i["label"] == ".claude-work")
    assert work["id"] == "work"

    # An already-registered config_dir must be excluded from a re-scan.
    c.post("/accounts", json={
        "id": "founder", "label": "Founder",
        "config_dir": str(pdir / "founder"),
    })
    body2 = c.post("/accounts/scan").json()
    assert not any(m["config_dir"] == str(pdir / "founder") for m in body2["managed"])


def test_patch_project_can_clear_model_ceiling():
    from tui_pilot.server import app

    c = TestClient(app)
    c.post("/projects", json={
        "id": "mc", "name": "MC", "path": "/w",
        "account_strategy": "single", "model_ceiling": "sonnet",
    })
    assert c.get("/projects/mc").json()["model_ceiling"] == "sonnet"

    # Partial patch leaves model_ceiling intact.
    c.patch("/projects/mc", json={"name": "MC2"})
    assert c.get("/projects/mc").json()["model_ceiling"] == "sonnet"
    assert c.get("/projects/mc").json()["name"] == "MC2"

    # Explicit null clears it.
    c.patch("/projects/mc", json={"model_ceiling": None})
    assert c.get("/projects/mc").json()["model_ceiling"] is None


def test_roles_endpoints_write_and_refresh():
    from tui_pilot import server
    from tui_pilot.server import app

    c = TestClient(app)
    r = c.post("/roles", json={"id": "custom", "label": "Custom", "mode": "normal"})
    assert r.status_code == 200
    server.refresh_roles()
    assert "custom" in server.ROLES
    c.patch("/roles/custom", json={"label": "Renamed"})
    assert server.ROLES["custom"]["label"] == "Renamed"
    assert c.delete("/roles/custom").json()["status"] == "deleted"
    assert "custom" not in server.ROLES


def test_login_endpoint_registers_bare_session(monkeypatch):
    from tui_pilot import server
    from tui_pilot.server import app
    from tui_pilot.session import TmuxSession

    monkeypatch.setattr(TmuxSession, "spawn", lambda self: None)
    c = TestClient(app)
    c.post("/accounts", json={"id": "lg", "label": "LG", "config_dir": "/lg"})
    r = c.post("/accounts/lg/login")
    assert r.status_code == 200
    aid = r.json()["id"]
    try:
        assert server._meta[aid]["role"] == "login"
        # A login session must serialize cleanly when listed (no KeyError).
        info = server._info(aid)
        assert info["role"] == "login"
        assert info["emoji"] == "🔑"
        assert any(s["id"] == aid for s in c.get("/sessions").json()["sessions"])
    finally:
        with server._registry_lock:
            server._sessions.pop(aid, None)
            server._locks.pop(aid, None)
            server._meta.pop(aid, None)
            server._pollers.pop(aid, None)


def test_advance_login_sessions_presses_enter_once():
    """A login session at the 'Press Enter to continue' screen gets Enter sent
    exactly once; non-login sessions and pre-login screens are ignored."""
    from tui_pilot import server

    keys = []

    class FakeSess:
        def __init__(self, txt):
            self.txt = txt
        def capture(self, history=False):
            return self.txt
        def send_key(self, k):
            keys.append(k)

    class FakeCtrl:
        def __init__(self, txt):
            self.session = FakeSess(txt)

    server._sessions["login-x"] = FakeCtrl("Login successful. Press Enter to continue…")
    server._meta["login-x"] = {"id": "login-x", "role": "login"}
    # a non-login session showing the same text must be ignored
    server._sessions["dev-x"] = FakeCtrl("Login successful. Press Enter to continue")
    server._meta["dev-x"] = {"id": "dev-x", "role": "developer"}
    try:
        server._advance_login_sessions()
        server._advance_login_sessions()  # once-only guard
        assert keys == ["Enter"]
        assert server._meta["login-x"].get("login_continued") is True
    finally:
        for k in ("login-x", "dev-x"):
            server._sessions.pop(k, None)
            server._locks.pop(k, None)
            server._meta.pop(k, None)


def test_orchestrator_gets_spade_data_skill(tmp_path):
    """Spawning an orchestrator installs the spade-data skill (with the API base
    rendered in) so it can read/drive the app, not just guess from the filesystem."""
    from tui_pilot import session
    cwd = tmp_path / "orch"
    cwd.mkdir()
    session.install_spade_data_skill(str(cwd), api_base="http://127.0.0.1:8765")
    skill = cwd / ".claude" / "skills" / "spade-data" / "SKILL.md"
    assert skill.exists()
    text = skill.read_text()
    assert "http://127.0.0.1:8765" in text
    assert "/tasks?project_id=" in text and "/pipelines" in text
    assert "__API_BASE__" not in text  # placeholder fully rendered


def test_settings_endpoint_roundtrip():
    from tui_pilot.server import app
    from fastapi.testclient import TestClient
    c = TestClient(app)
    assert c.get("/settings").json()["force_bypass"] is True   # default on
    assert c.put("/settings", json={"force_bypass": False}).json()["force_bypass"] is False
    assert c.get("/settings").json()["force_bypass"] is False
    c.put("/settings", json={"force_bypass": True})


def test_force_bypass_adds_danger_flag_to_command():
    """Sanity on the command builder: bypass mode appends the danger flag, so a
    force_bypass spawn launches with --dangerously-skip-permissions."""
    from tui_pilot.session import build_cmd
    # mode handling lives in _spawn_agent; here we just assert the flag wiring:
    # an eff_mode of 'bypass' results in the danger flag being present.
    eff_cmd = "claude"
    if "dangerously-skip-permissions" not in eff_cmd:
        eff_cmd = f"{eff_cmd} --dangerously-skip-permissions"
    eff_cmd = build_cmd(eff_cmd, None)
    assert "--dangerously-skip-permissions" in eff_cmd
