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

def test_signal_surfaces_and_can_be_answered(client):
    aid = client.post("/sessions", json={"name": "h", "cmd": "cat"}).json()["id"]
    out = server.HUB.agent_dir(aid) / "outbox" / "s1.json"
    out.write_text(json.dumps({"id": "s1", "action": "ask_question", "text": "PG?"}))
    sigs = []
    for _ in range(20):
        sigs = client.get(f"/sessions/{aid}/signals").json()["signals"]
        if sigs: break
        time.sleep(0.1)
    assert sigs and sigs[0]["action"] == "ask_question"
    assert client.post(f"/sessions/{aid}/answer",
                       json={"signal_id": "s1", "text": "Postgres"}).status_code == 200
    assert client.get(f"/sessions/{aid}/signals").json()["signals"] == []
    client.delete(f"/sessions/{aid}")

def test_session_info_includes_harness_state(client):
    aid = client.post("/sessions", json={"name": "h", "cmd": "cat"}).json()["id"]
    assert "harness_state" in client.get(f"/sessions/{aid}").json()
    client.delete(f"/sessions/{aid}")

def test_finished_report_and_confirm_handoff_endpoint(client, tmp_path):
    import os
    cwd = str(tmp_path / "proj"); os.makedirs(cwd)
    aid = client.post("/sessions", json={"name": "f", "cmd": "cat", "cwd": cwd}).json()["id"]
    out = server.HUB.agent_dir(aid) / "outbox" / "f1.json"
    out.write_text(json.dumps({"id": "f1", "action": "finished", "report": "# Done",
                               "next": {"role": "plain", "cmd": "cat", "task": "go",
                                        "start": "confirm"}}))
    for _ in range(20):
        if client.get(f"/sessions/{aid}").json()["harness_state"] == "done": break
        time.sleep(0.1)
    assert client.get(f"/sessions/{aid}/report").text.startswith("# Done")
    n_before = len(client.get("/sessions").json()["sessions"])
    assert client.post(f"/sessions/{aid}/handoff").status_code == 200
    n_after = len(client.get("/sessions").json()["sessions"])
    assert n_after == n_before + 1
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")

def test_auto_handoff_spawns_exactly_one_successor(client, tmp_path):
    import os
    cwd = str(tmp_path / "p"); os.makedirs(cwd)
    aid = client.post("/sessions", json={"name": "a", "cmd": "cat", "cwd": cwd}).json()["id"]
    out = server.HUB.agent_dir(aid) / "outbox" / "f1.json"
    out.write_text(json.dumps({"id": "f1", "action": "finished", "report": "# Done",
                               "next": {"role": "plain", "cmd": "cat", "task": "go", "start": "auto"}}))
    # hammer /sessions (each triggers _info->poll) while the background loop also polls
    for _ in range(40):
        client.get("/sessions"); time.sleep(0.05)
        if client.get(f"/sessions/{aid}").json()["harness_state"] == "done": break
    time.sleep(0.5)
    sessions = client.get("/sessions").json()["sessions"]
    assert len([s for s in sessions if s["id"] != aid]) == 1   # exactly one successor, not two
    for s in sessions: client.delete(f"/sessions/{s['id']}")
