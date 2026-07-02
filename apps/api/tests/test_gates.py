import uuid

from tui_pilot import db, gates, projects, tasks


def _setup():
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="Build X")["id"]
    run_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO lifecycle_runs (id, project_id, task_id, phase, active) "
        "VALUES (?, ?, ?, 'shaping', 1)",
        (run_id, "acme", tid),
    )
    return tid, run_id


def test_open_gate_creates_waiting_row():
    tid, run_id = _setup()
    g = gates.open_gate(tid, run_id, "plan")
    assert g["gate"] == "plan"
    assert g["status"] == "waiting"
    assert g["task_id"] == tid
    assert g["run_id"] == run_id


def test_decide_sets_status_and_decided_at():
    tid, run_id = _setup()
    g = gates.open_gate(tid, run_id, "plan")
    decided = gates.decide(g["id"], "approved", comment="lgtm", by="thiago")
    assert decided["status"] == "approved"
    assert decided["comment"] == "lgtm"
    assert decided["decided_by"] == "thiago"
    assert decided["decided_at"]


def test_gate_for_returns_the_row():
    tid, run_id = _setup()
    gates.open_gate(tid, run_id, "plan")
    g = gates.gate_for(run_id, "plan")
    assert g is not None and g["gate"] == "plan"
    assert gates.gate_for(run_id, "merge") is None


def test_waiting_for_project_joins_task():
    tid, run_id = _setup()
    gates.open_gate(tid, run_id, "plan")
    waiting = gates.waiting_for_project("acme")
    assert len(waiting) == 1
    row = waiting[0]
    assert row["task_id"] == tid
    assert row["gate"] == "plan"
    assert row["task_title"] == "Build X"


def test_waiting_for_project_excludes_decided():
    tid, run_id = _setup()
    g = gates.open_gate(tid, run_id, "plan")
    gates.decide(g["id"], "approved")
    assert gates.waiting_for_project("acme") == []
