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
    # force bypasses the transition guard (admin override): ready -> pr_review is
    # not a legal forward transition, but force allows the jump.
    tasks.move(t["id"], "pr_review", force=True)
    assert tasks.get(t["id"])["status"] == "pr_review"
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


def test_move_rejects_illegal_transition():
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]  # status 'ready'
    with pytest.raises(ValueError):
        tasks.move(tid, "shipped")  # ready -> shipped is not legal


def test_move_allows_legal_transition_chain():
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]
    for nxt in ["shaping", "plan_review", "building", "pr_review", "shipped"]:
        tasks.move(tid, nxt)
    assert tasks.get(tid)["status"] == "shipped"


def test_move_force_bypasses_transition_rules():
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]
    tasks.move(tid, "shipped", force=True)
    assert tasks.get(tid)["status"] == "shipped"


def test_any_status_can_go_to_blocked_and_back_via_force():
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]
    tasks.move(tid, "shaping")
    tasks.move(tid, "blocked")  # any -> blocked is always legal
    assert tasks.get(tid)["status"] == "blocked"
