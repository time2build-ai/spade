import pytest
from tui_pilot import tasks, projects


def _proj():
    projects.create(id="acme", name="Acme", path="/w")


def test_tasks_tables_exist():
    from tui_pilot import db
    rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks', 'task_nodes')")
    names = {r["name"] for r in rows}
    assert "tasks" in names
    assert "task_nodes" in names


def test_spd_ids_are_globally_sequential_and_unique():
    _proj()
    t = tasks.create(project_id="acme", title="Checkout bug", feature="Checkout", priority=1)
    assert t["id"] == "SPD-001" and t["status"] == "ready"
    assert tasks.create(project_id="acme", title="Second")["id"] != t["id"]
    # Ids are globally sequential across projects (not reset per project), so a
    # second project's first task continues the one flat SPD-NNN sequence.
    projects.create(id="beta", name="Beta", path="/b")
    beta = tasks.create(project_id="beta", title="First on beta")
    assert beta["id"] == "SPD-003"
    assert beta["id"] != t["id"]


def test_move_validates_status():
    _proj()
    t = tasks.create(project_id="acme", title="X")
    tasks.move(t["id"], "in_progress")
    assert tasks.get(t["id"])["status"] == "in_progress"
    with pytest.raises(ValueError):
        tasks.move(t["id"], "bogus")


def test_list_for_project():
    _proj()
    tasks.create(project_id="acme", title="A")
    tasks.create(project_id="acme", title="B")
    assert len(tasks.list_for_project("acme")) == 2


def test_grounding_set_and_get():
    _proj()
    t = tasks.create(project_id="acme", title="X")
    tasks.set_nodes(t["id"], ["n1", "n2"])
    assert set(tasks.nodes(t["id"])) == {"n1", "n2"}
    tasks.set_nodes(t["id"], ["n3"])
    assert tasks.nodes(t["id"]) == ["n3"]


# -- comments ------------------------------------------------------------------

def test_task_comments_table_exists():
    from tui_pilot import db
    rows = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='task_comments'"
    )
    assert {r["name"] for r in rows} == {"task_comments"}


def test_add_and_list_comment():
    _proj()
    t = tasks.create(project_id="acme", title="X")
    c = tasks.add_comment(
        t["id"], body="developer added test_hello.py", author="developer", kind="stage_report"
    )
    assert c["id"] and c["created_at"]
    assert c["task_id"] == t["id"]
    assert c["author"] == "developer"
    assert c["kind"] == "stage_report"
    assert c["body"] == "developer added test_hello.py"
    listed = tasks.comments(t["id"])
    assert len(listed) == 1 and listed[0]["body"] == "developer added test_hello.py"


def test_add_comment_defaults_to_note_kind():
    _proj()
    t = tasks.create(project_id="acme", title="X")
    c = tasks.add_comment(t["id"], body="looks good", author="you")
    assert c["kind"] == "note"


def test_comments_ordered_oldest_first():
    _proj()
    t = tasks.create(project_id="acme", title="X")
    tasks.add_comment(t["id"], body="first")
    tasks.add_comment(t["id"], body="second")
    tasks.add_comment(t["id"], body="third")
    assert [c["body"] for c in tasks.comments(t["id"])] == ["first", "second", "third"]


def test_comments_cascade_on_task_delete():
    _proj()
    t = tasks.create(project_id="acme", title="X")
    tasks.add_comment(t["id"], body="hi")
    tasks.delete(t["id"])
    assert tasks.comments(t["id"]) == []
