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


def test_create_generates_spd_id_per_project():
    _proj()
    t = tasks.create(project_id="acme", title="Checkout bug", feature="Checkout", priority=1)
    assert t["id"].startswith("SPD-") and t["status"] == "ready"
    assert tasks.create(project_id="acme", title="Second")["id"] != t["id"]


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
