import pytest, time
from fastapi.testclient import TestClient
from tui_pilot import server

@pytest.fixture()
def client():
    return TestClient(server.app)

def test_spawn_records_model_mission_parent_reason(client, tmp_path):
    r = client.post("/sessions", json={"name":"w","cmd":"cat","cwd":str(tmp_path),
        "model":"sonnet","mission":"m1","parent":"orch-1","reason":"standard markup"})
    assert r.status_code == 200
    info = r.json()
    aid = info["id"]
    try:
        assert info["model"] == "sonnet"
        assert info["mission"] == "m1"
        assert info["parent"] == "orch-1"
        assert info["reason"] == "standard markup"
        assert "--model claude-sonnet-4-6" in info["cmd"]
    finally:
        client.delete(f"/sessions/{aid}")
