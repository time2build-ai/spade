import json
from pathlib import Path
import pytest
from tui_pilot.comms import Hub

@pytest.fixture()
def hub(tmp_path):
    return Hub(root=tmp_path / "comms")

def test_paths_are_per_agent(hub):
    p = hub.agent_dir("dev-1-abc")
    assert p.name == "dev-1-abc"
    for sub in ("outbox", "inbox", "handoffs", "processed"):
        assert (p / sub).is_dir()  # created on demand

def test_scan_returns_new_outbox_signals(hub):
    aid = "dev-1-abc"
    hub.agent_dir(aid)
    (hub.agent_dir(aid) / "outbox" / "s1.json").write_text(
        json.dumps({"id": "s1", "action": "progress", "text": "hi"})
    )
    sigs = hub.scan(aid)
    assert [s["id"] for s in sigs] == ["s1"]

def test_mark_processed_is_idempotent(hub):
    aid = "dev-1-abc"
    out = hub.agent_dir(aid) / "outbox" / "s1.json"
    out.write_text(json.dumps({"id": "s1", "action": "progress"}))
    hub.mark_processed(aid, "s1")
    assert not out.exists()
    assert (hub.agent_dir(aid) / "processed" / "s1.json").exists()
    assert hub.scan(aid) == []          # gone from outbox
    hub.mark_processed(aid, "s1")       # second call: no error

def test_malformed_json_is_quarantined_not_raised(hub):
    aid = "dev-1-abc"
    (hub.agent_dir(aid) / "outbox" / "bad.json").write_text("{ not json")
    sigs = hub.scan(aid)
    assert sigs == []                   # bad file skipped
    assert (hub.agent_dir(aid) / "processed" / "bad.json").exists()

def test_archive_report_writes_handoff_copy(hub):
    aid = "dev-1-abc"
    path = hub.archive_report(aid, "# Done\nstuff", ts="20260614-0000")
    assert Path(path).read_text().startswith("# Done")
    assert "handoffs" in path


def test_filename_is_canonical_id_so_mark_processed_removes_it(hub):
    """Regression: a signal file whose internal JSON id differs from its
    filename must still be removed by mark_processed — otherwise it is
    re-scanned/re-executed forever (the runaway-spawn bug)."""
    aid = "orch-1"
    # filename 'spawn-planner' but internal id 's1' (orchestrator-style naming)
    (hub.agent_dir(aid) / "outbox" / "spawn-planner.json").write_text(
        json.dumps({"id": "s1", "action": "spawn", "task": "go"})
    )
    sigs = hub.scan(aid)
    assert len(sigs) == 1
    assert sigs[0]["id"] == "spawn-planner"          # filename stem wins
    hub.mark_processed(aid, sigs[0]["id"])
    assert hub.scan(aid) == []                         # actually removed → no re-run
