"""Server-layer harness tests: signal/answer/report/handoff endpoints + the
background poller, against a deterministic ``cat`` session (no live claude).

Each agent's mailbox now lives inside its working directory
(``<cwd>/.agent-comms/<id>/``), so tests pass a tmp ``cwd`` and drop signal
files there via ``server._hub_for(cwd)``.
"""

import json
import time

import pytest
from fastapi.testclient import TestClient

from tui_pilot import server


@pytest.fixture()
def client():
    return TestClient(server.app)


def _outbox(cwd, aid):
    """The agent's outbox dir for a given cwd (mirrors the server's layout)."""
    return server._hub_for(cwd).agent_dir(aid) / "outbox"


def test_spawn_agent_helper_returns_distinct_ids(client, tmp_path):
    a = server._spawn_agent(name="x", cmd="cat", cwd=str(tmp_path / "a"))
    b = server._spawn_agent(name="x", cmd="cat", cwd=str(tmp_path / "b"))
    assert a["id"] != b["id"]                      # same name OK now
    server.delete_session(a["id"])
    server.delete_session(b["id"])


def test_mission_does_not_hold_lock(client, tmp_path):
    aid = client.post(
        "/sessions",
        json={"name": "m", "cmd": "cat", "cwd": str(tmp_path), "task": "echo working"},
    ).json()["id"]
    time.sleep(1.0)
    lock = server._locks[aid]
    acquired = lock.acquire(timeout=2.0)   # must be free, not held by the mission
    assert acquired is True
    lock.release()
    client.delete(f"/sessions/{aid}")


def test_signal_surfaces_and_can_be_answered(client, tmp_path):
    cwd = str(tmp_path)
    aid = client.post("/sessions", json={"name": "h", "cmd": "cat", "cwd": cwd}).json()["id"]
    (_outbox(cwd, aid) / "s1.json").write_text(
        json.dumps({"id": "s1", "action": "ask_question", "text": "PG?"})
    )
    sigs = []
    for _ in range(20):
        sigs = client.get(f"/sessions/{aid}/signals").json()["signals"]
        if sigs:
            break
        time.sleep(0.1)
    assert sigs and sigs[0]["action"] == "ask_question"
    r = client.post(f"/sessions/{aid}/answer", json={"signal_id": "s1", "text": "Postgres"})
    assert r.status_code == 200 and r.json()["landed"] is True
    assert client.get(f"/sessions/{aid}/signals").json()["signals"] == []
    client.delete(f"/sessions/{aid}")


def test_session_info_includes_harness_state(client, tmp_path):
    aid = client.post("/sessions", json={"name": "h", "cmd": "cat", "cwd": str(tmp_path)}).json()["id"]
    assert "harness_state" in client.get(f"/sessions/{aid}").json()
    client.delete(f"/sessions/{aid}")


def test_finished_report_and_confirm_handoff_endpoint(client, tmp_path):
    import os

    cwd = str(tmp_path / "proj")
    os.makedirs(cwd)
    aid = client.post("/sessions", json={"name": "f", "cmd": "cat", "cwd": cwd}).json()["id"]
    (_outbox(cwd, aid) / "f1.json").write_text(
        json.dumps({"id": "f1", "action": "finished", "report": "# Done",
                    "next": {"role": "plain", "cmd": "cat", "task": "go",
                             "cwd": cwd, "start": "confirm"}})
    )
    for _ in range(20):
        if client.get(f"/sessions/{aid}").json()["harness_state"] == "done":
            break
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

    cwd = str(tmp_path / "p")
    os.makedirs(cwd)
    aid = client.post("/sessions", json={"name": "a", "cmd": "cat", "cwd": cwd}).json()["id"]
    (_outbox(cwd, aid) / "f1.json").write_text(
        json.dumps({"id": "f1", "action": "finished", "report": "# Done",
                    "next": {"role": "plain", "cmd": "cat", "task": "go",
                             "cwd": cwd, "start": "auto"}})
    )
    # hammer /sessions (each triggers _info->poll) while the background loop polls
    for _ in range(40):
        client.get("/sessions")
        time.sleep(0.05)
        if client.get(f"/sessions/{aid}").json()["harness_state"] == "done":
            break
    time.sleep(0.5)
    sessions = client.get("/sessions").json()["sessions"]
    assert len([s for s in sessions if s["id"] != aid]) == 1   # exactly one, not two
    for s in sessions:
        client.delete(f"/sessions/{s['id']}")
