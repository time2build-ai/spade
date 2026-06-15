"""Offline tests for agent roles + multi-session metadata.

Uses a deterministic ``cat`` target (no live claude) by overriding the role's
command, and only exercises roles whose priming is a no-op (empty instructions,
``normal`` mode) so the background prime thread finishes instantly.
"""

from __future__ import annotations

import time
import uuid

import pytest

try:
    from fastapi.testclient import TestClient
except Exception:  # pragma: no cover
    TestClient = None

from tui_pilot import server
from tui_pilot.session import SessionError, _ensure_tmux_on_path

try:
    _ensure_tmux_on_path()
    _HAS_TMUX = True
except SessionError:
    _HAS_TMUX = False

pytestmark = pytest.mark.skipif(
    not _HAS_TMUX or TestClient is None, reason="needs tmux and fastapi TestClient"
)


@pytest.fixture()
def client():
    server.refresh_roles()
    return TestClient(server.app)


def test_seed_roles_populates_db_from_yaml():
    from tui_pilot import roles_seed, db

    roles_seed.seed_if_empty()
    ids = {r["id"] for r in db.query("SELECT id FROM roles")}
    assert {"planner", "developer", "reviewer", "plain", "orchestrator"} <= ids


def test_seed_is_idempotent():
    from tui_pilot import roles_seed, db

    roles_seed.seed_if_empty()
    roles_seed.seed_if_empty()
    n = db.query("SELECT count(*) c FROM roles")[0]["c"]
    assert n == 5


def test_roles_endpoint_lists_presets(client):
    data = client.get("/roles").json()
    ids = {r["id"] for r in data["roles"]}
    assert {"planner", "developer", "plain"} <= ids
    dev = next(r for r in data["roles"] if r["id"] == "developer")
    assert dev["mode"] == "accept-edits"
    assert dev["instructions"]  # developer has priming text


def test_role_spawn_records_metadata(client):
    name = f"role-{uuid.uuid4().hex[:8]}"
    # plain role + cat override => no real claude, priming is a no-op.
    r = client.post("/sessions", json={"name": name, "role": "plain", "cmd": "cat"})
    assert r.status_code == 200, r.text
    info = r.json()
    aid = info["id"]
    assert info["name"] == name
    assert info["role"] == "plain"
    assert info["mode"] == "normal"
    assert info["emoji"]  # carried from the preset

    try:
        # prep should settle to "ready" quickly (nothing to prime).
        for _ in range(40):
            prep = client.get(f"/sessions/{aid}").json()["prep"]
            if prep == "ready":
                break
            time.sleep(0.1)
        assert prep == "ready"

        # it shows up in the multi-session list with its metadata + state.
        listed = client.get("/sessions").json()["sessions"]
        mine = next(s for s in listed if s["id"] == aid)
        assert mine["role"] == "plain"
        assert "state" in mine and "prep" in mine
    finally:
        client.delete(f"/sessions/{aid}")


def test_spawn_accepts_initial_task(client):
    name = f"role-{uuid.uuid4().hex[:8]}"
    # plain role + cat: priming is a no-op; the task is recorded and surfaced.
    # (We delete promptly so the background prime thread, which would try to send
    # the task to `cat`, unblocks as soon as the session is gone.)
    r = client.post(
        "/sessions",
        json={"name": name, "role": "plain", "cmd": "cat", "task": "do the thing"},
    )
    assert r.status_code == 200
    info = r.json()
    aid = info["id"]
    try:
        assert info["task"] == "do the thing"
        listed = client.get("/sessions").json()["sessions"]
        assert any(s["id"] == aid and s["task"] == "do the thing" for s in listed)
    finally:
        client.delete(f"/sessions/{aid}")


def test_unknown_role_is_rejected(client):
    name = f"role-{uuid.uuid4().hex[:8]}"
    r = client.post("/sessions", json={"name": name, "role": "nope", "cmd": "cat"})
    assert r.status_code == 400


def test_bypass_mode_appends_danger_flag_at_spawn(client):
    name = f"role-{uuid.uuid4().hex[:8]}"
    # plain role (empty instructions) + cat keeps priming a no-op; we only check
    # that bypass rewrote the launch command.
    r = client.post(
        "/sessions",
        json={"name": name, "role": "plain", "cmd": "cat", "mode": "bypass"},
    )
    assert r.status_code == 200
    info = r.json()
    aid = info["id"]
    try:
        assert info["mode"] == "bypass"
        assert info["cmd"].endswith("--dangerously-skip-permissions")
    finally:
        client.delete(f"/sessions/{aid}")


def test_bypass_cannot_be_set_on_running_session(client):
    name = f"role-{uuid.uuid4().hex[:8]}"
    aid = client.post("/sessions", json={"name": name, "role": "plain", "cmd": "cat"}).json()["id"]
    try:
        # bypass needs a relaunch, so the runtime /mode switch is refused.
        r = client.post(f"/sessions/{aid}/mode", json={"mode": "bypass"})
        assert r.status_code == 409
    finally:
        client.delete(f"/sessions/{aid}")


def test_instructions_and_mode_override_role(client):
    name = f"role-{uuid.uuid4().hex[:8]}"
    # Override to empty instructions + normal mode so priming stays a no-op,
    # even though we pass a role whose defaults differ.
    r = client.post(
        "/sessions",
        json={
            "name": name, "role": "developer", "cmd": "cat",
            "instructions": "", "mode": "normal",
        },
    )
    assert r.status_code == 200
    info = r.json()
    aid = info["id"]
    try:
        assert info["mode"] == "normal"  # override beat the developer default
    finally:
        client.delete(f"/sessions/{aid}")
