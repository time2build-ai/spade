"""Task 2.1: fanout_agents CRUD + Task 2.2: fan-out phase entry + barrier."""

import threading

from tui_pilot import db, fanout, projects, tasks


def _run(run_id: str) -> str:
    """Create the minimal project/task/lifecycle_run chain so a fanout row's
    FOREIGN KEY(run_id) resolves. Returns run_id."""
    pid = f"p-{run_id}"
    projects.create(id=pid, name="P", path="/w")
    tid = tasks.create(project_id=pid, title="T")["id"]
    db.execute(
        "INSERT INTO lifecycle_runs (id, project_id, task_id, phase, kind, active, "
        "created_at, updated_at) VALUES (?, ?, ?, 'investigating', 'research', 1, "
        "'t', 't')",
        (run_id, pid, tid),
    )
    return run_id


# -- Task 2.1: CRUD -----------------------------------------------------------

def test_create_rows_inserts_n_queued():
    _run("run1")
    rows = fanout.create_rows("run1", "investigating",
                              [{"angle": "a", "mode": "web"}, {"angle": "b"}])
    assert len(rows) == 2
    assert [r["idx"] for r in rows] == [0, 1]
    assert all(r["status"] == "queued" for r in rows)
    assert rows[0]["mode"] == "web"
    assert not fanout.all_done("run1", "investigating")


def test_mark_done_and_all_done_barrier():
    _run("run2")
    fanout.create_rows("run2", "investigating", ["a", "b"])
    assert fanout.mark_done("run2", "investigating", 0, "art0") is True
    assert not fanout.all_done("run2", "investigating")
    assert fanout.mark_done("run2", "investigating", 1, "art1") is True
    assert fanout.all_done("run2", "investigating")
    # per-row idempotency: a second mark_done is a no-op (already resolved)
    assert fanout.mark_done("run2", "investigating", 1, "art1b") is False
    row = fanout.get_row("run2", "investigating", 1)
    assert row["status"] == "done" and row["report_artifact_id"] == "art1"


def test_dropped_counts_as_resolved():
    _run("run3")
    fanout.create_rows("run3", "investigating", ["a", "b"])
    fanout.mark_done("run3", "investigating", 0, "art0")
    assert not fanout.all_done("run3", "investigating")
    assert fanout.drop("run3", "investigating", 1) is True
    assert fanout.all_done("run3", "investigating")


def test_block_holds_barrier_and_pending():
    _run("run4")
    fanout.create_rows("run4", "investigating", ["a", "b"])
    fanout.mark_done("run4", "investigating", 0, "art0")
    assert fanout.block("run4", "investigating", 1) is True
    # a blocked row is unresolved → barrier still held
    assert not fanout.all_done("run4", "investigating")
    pending = fanout.pending("run4", "investigating")
    assert [r["idx"] for r in pending] == [1]


def test_drop_does_not_override_a_done_row():
    _run("run5")
    fanout.create_rows("run5", "investigating", ["a"])
    fanout.mark_done("run5", "investigating", 0, "art0")
    assert fanout.drop("run5", "investigating", 0) is False
    assert fanout.get_row("run5", "investigating", 0)["status"] == "done"


def test_all_done_false_when_no_rows():
    # vacuous safety: no rows means the phase never "completed"
    assert fanout.all_done("nope", "investigating") is False
