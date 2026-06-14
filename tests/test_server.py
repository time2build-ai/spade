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
