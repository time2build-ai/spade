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
