"""Task 2.1: fanout_agents CRUD + Task 2.2: fan-out phase entry + barrier."""

import threading

import pytest

from tui_pilot import (
    artifacts, db, fanout, lifecycle, lifecycle_templates as LT, projects, tasks,
)


# -- synthetic fan-out template (scoping -> investigating[fanout] -> synthesis) -

_SYNTH = {
    "terminal_status": "delivered",
    "needs_workspace": False,
    "phases": [
        {"name": "scoping", "agent": True, "fanout": False,
         "gate": None, "column": "Planning"},
        {"name": "investigating", "agent": True, "fanout": True,
         "gate": None, "column": "In progress"},
        {"name": "synthesis", "agent": True, "fanout": False,
         "gate": None, "column": "Review"},
        {"name": "delivered", "agent": False, "fanout": False,
         "gate": None, "column": "Done"},
    ],
    "gate_advances": {},
}


@pytest.fixture
def synth_kind():
    """Register a throwaway fan-out kind and refresh the transition-pair cache."""
    LT.LIFECYCLE_TEMPLATES["_synth"] = _SYNTH
    LT.transition_pairs.cache_clear()
    try:
        yield "_synth"
    finally:
        LT.LIFECYCLE_TEMPLATES.pop("_synth", None)
        LT.transition_pairs.cache_clear()


class Rec:
    """Recording spawn: threads fanout_idx via the run dict, returns a session."""
    def __init__(self):
        self.calls = []

    def __call__(self, run, phase):
        idx = run.get("fanout_idx")
        self.calls.append((phase, idx))
        sid = f"sess-{phase}" + (f"-{idx}" if idx is not None else "")
        return (sid, "acct")

    def count(self, phase):
        return sum(1 for p, _ in self.calls if p == phase)


class FakeGit:
    def prepare_workspace(self, cfg, task_id, slug, kind="feat"):
        return {}


def _start_synth(kind, rec):
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="Research X")["id"]
    tasks.set_kind(tid, kind) if hasattr(tasks, "set_kind") else \
        db.execute("UPDATE tasks SET kind = ? WHERE id = ?", (kind, tid))
    run = lifecycle.start_run("acme", tid, spawn=rec, git=FakeGit())
    return run


# -- Task 2.2: fan-out entry + barrier ----------------------------------------

def test_fanout_advances_only_when_all_done(synth_kind):
    rec = Rec()
    run = _start_synth(synth_kind, rec)
    lifecycle.enter_fanout(run, "investigating",
                           angles=["a", "b", "c"], spawn=rec, git=FakeGit())
    assert rec.count("investigating") == 3          # 3 agents spawned
    # idempotent: a second enter for the same (run, phase) spawns nothing
    lifecycle.enter_fanout(run, "investigating",
                           angles=["x"], spawn=rec, git=FakeGit())
    assert rec.count("investigating") == 3
    rid = run["id"]
    lifecycle.advance_fanout(rid, "investigating", 0, report='{"k":1}',
                             spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 1, report='{}',
                             spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "investigating"   # barrier held
    lifecycle.advance_fanout(rid, "investigating", 2, report='{}',
                             spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "synthesis"       # barrier released
    assert rec.count("synthesis") == 1
    # three findings registered as inline artifacts
    findings = [a for a in artifacts.for_task(run["task_id"]) if a["kind"] == "finding"]
    assert len(findings) == 3


def test_duplicate_advance_is_noop(synth_kind):
    rec = Rec()
    run = _start_synth(synth_kind, rec)
    rid = run["id"]
    lifecycle.enter_fanout(run, "investigating", angles=["a", "b"],
                           spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 0, report='{}',
                             spawn=rec, git=FakeGit())
    # duplicate for a done row: no new finding, barrier not touched
    lifecycle.advance_fanout(rid, "investigating", 0, report='{"dup":1}',
                             spawn=rec, git=FakeGit())
    findings = [a for a in artifacts.for_task(run["task_id"]) if a["kind"] == "finding"]
    assert len(findings) == 1
    assert lifecycle.get(rid)["phase"] == "investigating"


def test_blocked_angle_holds_then_drop_releases(synth_kind):
    rec = Rec()
    run = _start_synth(synth_kind, rec)
    rid = run["id"]
    lifecycle.enter_fanout(run, "investigating", angles=["a", "b"],
                           spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 0, report='{}',
                             spawn=rec, git=FakeGit())
    fanout.block(rid, "investigating", 1)
    assert lifecycle.get(rid)["phase"] == "investigating"   # blocked holds
    lifecycle.drop_angle(rid, "investigating", 1, spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "synthesis"       # drop released
    assert rec.count("synthesis") == 1


def test_all_angles_dropped_spawns_synthesis_with_zero_findings(synth_kind):
    rec = Rec()
    run = _start_synth(synth_kind, rec)
    rid = run["id"]
    lifecycle.enter_fanout(run, "investigating", angles=["a", "b"],
                           spawn=rec, git=FakeGit())
    lifecycle.drop_angle(rid, "investigating", 0, spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "investigating"
    lifecycle.drop_angle(rid, "investigating", 1, spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "synthesis"
    assert rec.count("synthesis") == 1
    findings = [a for a in artifacts.for_task(run["task_id"]) if a["kind"] == "finding"]
    assert findings == []


def test_late_finish_after_drop_does_not_flip_or_register(synth_kind):
    rec = Rec()
    run = _start_synth(synth_kind, rec)
    rid = run["id"]
    lifecycle.enter_fanout(run, "investigating", angles=["a", "b"],
                           spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 0, report='{}',
                             spawn=rec, git=FakeGit())
    lifecycle.drop_angle(rid, "investigating", 1, spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "synthesis"
    syntheses_before = rec.count("synthesis")
    # a LATE finish for the dropped angle must not flip it or add a finding
    lifecycle.advance_fanout(rid, "investigating", 1, report='{"late":1}',
                             spawn=rec, git=FakeGit())
    assert fanout.get_row(rid, "investigating", 1)["status"] == "dropped"
    findings = [a for a in artifacts.for_task(run["task_id"]) if a["kind"] == "finding"]
    assert len(findings) == 1
    assert rec.count("synthesis") == syntheses_before      # no second synthesis


def test_retry_angle_guards_resolved_rows(synth_kind):
    rec = Rec()
    run = _start_synth(synth_kind, rec)
    rid = run["id"]
    lifecycle.enter_fanout(run, "investigating", angles=["a", "b"],
                           spawn=rec, git=FakeGit())
    before = rec.count("investigating")
    fanout.block(rid, "investigating", 0)
    lifecycle.retry_angle(rid, "investigating", 0, spawn=rec, git=FakeGit())
    assert rec.count("investigating") == before + 1        # blocked → re-spawned
    lifecycle.advance_fanout(rid, "investigating", 0, report='{}',
                             spawn=rec, git=FakeGit())
    # retry on a done row: no re-spawn
    now = rec.count("investigating")
    lifecycle.retry_angle(rid, "investigating", 0, spawn=rec, git=FakeGit())
    assert rec.count("investigating") == now


def test_concurrent_drop_vs_finish_resolves_to_one_advance(synth_kind):
    rec = Rec()
    run = _start_synth(synth_kind, rec)
    rid = run["id"]
    lifecycle.enter_fanout(run, "investigating", angles=["a", "b"],
                           spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 0, report='{}',
                             spawn=rec, git=FakeGit())
    # row 1 is the last outstanding: race a drop against a finish
    barrier = threading.Barrier(2)

    def do_finish():
        barrier.wait()
        lifecycle.advance_fanout(rid, "investigating", 1, report='{}',
                                 spawn=rec, git=FakeGit())

    def do_drop():
        barrier.wait()
        lifecycle.drop_angle(rid, "investigating", 1, spawn=rec, git=FakeGit())

    t1, t2 = threading.Thread(target=do_finish), threading.Thread(target=do_drop)
    t1.start(); t2.start(); t1.join(); t2.join()
    assert lifecycle.get(rid)["phase"] == "synthesis"
    assert rec.count("synthesis") == 1     # exactly one — never zero, never two


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
