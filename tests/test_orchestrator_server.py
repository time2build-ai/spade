import json
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


def test_orchestrator_spawn_signal_creates_worker(client, tmp_path):
    o = client.post("/sessions", json={"name":"orch","cmd":"cat","cwd":str(tmp_path),
                                       "is_orchestrator": True}).json()["id"]
    ob = server._hub_for(str(tmp_path)).agent_dir(o) / "outbox" / "s1.json"
    ob.write_text(json.dumps({"id":"s1","action":"spawn","role":"plain","cmd":"cat",
                              "model":"haiku","task":"go","mission":"m1","cwd":str(tmp_path)}))
    spawned = None
    for _ in range(40):
        ss = client.get("/sessions").json()["sessions"]
        spawned = [s for s in ss if s.get("parent") == o]
        if spawned: break
        time.sleep(0.1)
    assert spawned and spawned[0]["mission"] == "m1"
    assert "--model claude-haiku-4-5" in spawned[0]["cmd"]
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")
