from tui_pilot import artifacts, projects, tasks


def _setup():
    projects.create(id="acme", name="Acme", path="/w")
    return tasks.create(project_id="acme", title="Build X")["id"]


def test_register_creates_row():
    tid = _setup()
    a = artifacts.register(tid, "run1", "spec", "Spec", "docs/s.md",
                           "feat/SPD-001-x", by="shaping")
    assert a["kind"] == "spec"
    assert a["title"] == "Spec"
    assert a["repo_path"] == "docs/s.md"
    assert a["branch"] == "feat/SPD-001-x"
    assert a["created_by"] == "shaping"
    assert a["task_id"] == tid
    assert a["run_id"] == "run1"


def test_for_task_lists_all():
    tid = _setup()
    artifacts.register(tid, "run1", "spec", "Spec", "docs/s.md", "b", by="shaping")
    artifacts.register(tid, "run1", "plan", "Plan", "docs/p.md", "b", by="shaping")
    rows = artifacts.for_task(tid)
    assert {r["kind"] for r in rows} == {"spec", "plan"}


def test_repoint_to_branch_updates_all_rows():
    tid = _setup()
    artifacts.register(tid, "run1", "spec", "Spec", "docs/s.md", "feat/x", by="shaping")
    artifacts.register(tid, "run1", "plan", "Plan", "docs/p.md", "feat/x", by="shaping")
    artifacts.repoint_to_branch(tid, "development")
    assert all(r["branch"] == "development" for r in artifacts.for_task(tid))
