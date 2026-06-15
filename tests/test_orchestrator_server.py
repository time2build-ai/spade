import json
import pytest, time
from fastapi.testclient import TestClient
from tui_pilot import server
from tui_pilot import orchestrator_server

@pytest.fixture()
def client():
    return TestClient(server.app)

@pytest.fixture(autouse=True)
def _reset_orch_state():
    """Missions/brakes are module-global; reset between tests for isolation."""
    orchestrator_server._missions.clear()
    orchestrator_server._brakes.clear()
    yield
    orchestrator_server._missions.clear()
    orchestrator_server._brakes.clear()

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
    assert spawned[0]["cmd"].startswith("cat")  # cmd threaded through → stays offline
    assert "--model claude-haiku-4-5" in spawned[0]["cmd"]
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")


def test_worker_question_is_forwarded_to_orchestrator(client, tmp_path):
    o = client.post("/sessions", json={"name":"orch","cmd":"cat","cwd":str(tmp_path),
                                       "is_orchestrator": True}).json()["id"]
    w = client.post("/sessions", json={"name":"w","cmd":"cat","cwd":str(tmp_path),
                                       "parent": o, "mission":"m1"}).json()["id"]
    wb = server._hub_for(str(tmp_path)).agent_dir(w) / "outbox" / "q.json"
    wb.write_text(json.dumps({"id":"q","action":"ask_question","text":"PG or MySQL?"}))
    got = False
    for _ in range(40):
        screen = client.get(f"/sessions/{o}/screen").text
        if "PG or MySQL?" in screen and w in screen:
            got = True; break
        time.sleep(0.1)
    assert got
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")


def test_missions_list_and_autopilot_toggle(client, tmp_path):
    o = client.post("/sessions", json={"name":"orch","cmd":"cat","cwd":str(tmp_path),
                                       "is_orchestrator": True}).json()["id"]
    client.post("/sessions", json={"name":"w","cmd":"cat","cwd":str(tmp_path),
                                   "parent": o, "mission":"m1"})
    missions = client.get("/missions").json()["missions"]
    assert any(m["mission"] == "m1" for m in missions)
    r = client.post("/missions/m1/autopilot", json={"autopilot": True})
    assert r.status_code == 200 and r.json()["autopilot"] is True
    assert any(m["mission"]=="m1" and m["autopilot"] for m in client.get("/missions").json()["missions"])
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")


def test_opus_spawn_supervised_creates_a_brake(client, tmp_path):
    o = client.post("/sessions", json={"name":"orch","cmd":"cat","cwd":str(tmp_path),
                                       "is_orchestrator": True}).json()["id"]
    ob = server._hub_for(str(tmp_path)).agent_dir(o) / "outbox" / "s.json"
    ob.write_text(json.dumps({"id":"s","action":"spawn","role":"plain","cmd":"cat",
                              "model":"opus","task":"hard","mission":"m1","reason":"gnarly"}))
    brake = None
    for _ in range(40):
        brakes = client.get("/brakes").json()["brakes"]
        if brakes: brake = brakes[0]; break
        time.sleep(0.1)
    assert brake and brake["brake"] == "opus_spawn"
    assert not [s for s in client.get("/sessions").json()["sessions"] if s.get("model")=="opus"]
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")


def test_concurrent_polls_and_deletes_do_not_deadlock(client, tmp_path):
    import threading
    o = client.post("/sessions", json={"name":"orch","cmd":"cat","cwd":str(tmp_path),
                                       "is_orchestrator": True}).json()["id"]
    workers = []
    for i in range(3):
        w = client.post("/sessions", json={"name":f"w{i}","cmd":"cat","cwd":str(tmp_path),
                                           "parent": o, "mission":"m1"}).json()["id"]
        workers.append(w)
    # A couple of worker questions + one orchestrator spawn (cmd:cat → offline).
    for i, w in enumerate(workers[:2]):
        wb = server._hub_for(str(tmp_path)).agent_dir(w) / "outbox" / f"q{i}.json"
        wb.write_text(json.dumps({"id":f"q{i}","action":"ask_question","text":f"Q{i}?"}))
    ob = server._hub_for(str(tmp_path)).agent_dir(o) / "outbox" / "sp.json"
    ob.write_text(json.dumps({"id":"sp","action":"spawn","role":"plain","cmd":"cat",
                              "task":"go","mission":"m1","cwd":str(tmp_path)}))

    errors = []
    def hammer(path):
        try:
            for _ in range(30):
                client.get(path)
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=hammer, args=(p,))
               for p in ("/sessions", "/brakes", "/missions") for _ in range(2)]
    for t in threads: t.start()
    deadline = time.time() + 15
    for t in threads:
        t.join(timeout=max(0.1, deadline - time.time()))
    assert not any(t.is_alive() for t in threads), "threads hung — possible deadlock"
    assert errors == []
    assert client.get("/sessions").status_code == 200
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")


def test_orchestrator_gets_orchestrator_skill_installed(client, tmp_path):
    o = client.post("/sessions", json={"name": "orch", "cmd": "cat",
                                       "cwd": str(tmp_path), "is_orchestrator": True}).json()["id"]
    skill = tmp_path / ".claude" / "skills" / "orchestrator-comms" / "SKILL.md"
    try:
        assert skill.is_file()
        assert "spawn" in skill.read_text()
    finally:
        client.delete(f"/sessions/{o}")


def test_one_spawn_signal_spawns_exactly_one_worker(client, tmp_path):
    """Regression for the runaway-spawn bug: a spawn signal whose FILENAME
    differs from its internal id must run ONCE, not every poll tick."""
    import json, time
    o = client.post("/sessions", json={"name": "o", "cmd": "cat",
                                       "cwd": str(tmp_path), "is_orchestrator": True}).json()["id"]
    # filename != internal id (orchestrator-style descriptive name)
    ob = server._hub_for(str(tmp_path)).agent_dir(o) / "outbox" / "spawn-the-dev.json"
    ob.write_text(json.dumps({"id": "s1", "action": "spawn", "role": "plain",
                              "cmd": "cat", "model": "haiku", "task": "hi",
                              "mission": "m1", "cwd": str(tmp_path)}))
    # let several poll ticks elapse
    for _ in range(15):
        time.sleep(0.2)
        workers = [s for s in client.get("/sessions").json()["sessions"]
                   if s.get("parent") == o]
        if len(workers) > 1:
            break  # runaway — fail fast
    workers = [s for s in client.get("/sessions").json()["sessions"] if s.get("parent") == o]
    assert len(workers) == 1, f"expected exactly 1 worker, got {len(workers)} (runaway)"
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")


def test_worker_finish_is_forwarded_to_orchestrator(client, tmp_path):
    """When a worker finishes, its parent orchestrator must be told (once) so it
    isn't left idle, unaware the work is done."""
    import json, time, os
    cwd = str(tmp_path / "p"); os.makedirs(cwd)
    o = client.post("/sessions", json={"name": "orch", "cmd": "cat",
                                       "cwd": cwd, "is_orchestrator": True}).json()["id"]
    w = client.post("/sessions", json={"name": "w", "cmd": "cat", "cwd": cwd,
                                       "parent": o, "mission": "m1"}).json()["id"]
    # worker finishes
    wb = server._hub_for(cwd).agent_dir(w) / "outbox" / "done.json"
    wb.write_text(json.dumps({"id": "done", "action": "finished",
                              "report": "# Done\nbuilt the thing"}))
    # the orchestrator's screen (cat echoes) should receive a FINISHED note
    got = False
    for _ in range(40):
        screen = client.get(f"/sessions/{o}/screen").text
        if "FINISHED" in screen and w in screen:
            got = True
            break
        time.sleep(0.1)
    assert got, "worker finish was not forwarded to the orchestrator"
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")
