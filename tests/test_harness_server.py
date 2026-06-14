import json, time
import pytest
from fastapi.testclient import TestClient
from tui_pilot import server
from tui_pilot.comms import Hub

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "HUB", Hub(tmp_path))   # isolate the hub
    return TestClient(server.app)

def test_spawn_agent_helper_returns_distinct_ids(client):
    a = server._spawn_agent(name="x", cmd="cat")
    b = server._spawn_agent(name="x", cmd="cat")        # same name OK now
    assert a["id"] != b["id"]
    server.delete_session(a["id"]); server.delete_session(b["id"])

def test_mission_does_not_hold_lock(client):
    aid = client.post("/sessions", json={"name": "m", "cmd": "cat",
                                         "task": "echo working"}).json()["id"]
    time.sleep(1.0)
    lock = server._locks[aid]
    acquired = lock.acquire(timeout=2.0)
    assert acquired is True
    lock.release()
    client.delete(f"/sessions/{aid}")
