from fastapi.testclient import TestClient


def test_task_endpoints():
    from tui_pilot.server import app
    from tui_pilot import projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)
    r = c.post("/tasks", json={"project_id": "acme", "title": "Checkout", "feature": "Checkout", "priority": 1})
    assert r.status_code == 200
    tid = r.json()["id"]
    assert c.get("/tasks?project_id=acme").json()["tasks"][0]["id"] == tid
    assert c.post(f"/tasks/{tid}/move", json={"status": "review"}).status_code == 200
    assert c.get(f"/tasks/{tid}").json()["status"] == "review"


def test_get_unknown_task_404():
    from tui_pilot.server import app
    c = TestClient(app)
    assert c.get("/tasks/SPD-999").status_code == 404


def test_move_invalid_status_400():
    from tui_pilot.server import app
    from tui_pilot import projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    assert c.post(f"/tasks/{tid}/move", json={"status": "bogus"}).status_code == 400


def test_set_nodes_then_get_returns_nodes():
    from tui_pilot.server import app
    from tui_pilot import projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    assert c.put(f"/tasks/{tid}/nodes", json={"node_ids": ["n1", "n2"]}).status_code == 200
    nodes = c.get(f"/tasks/{tid}").json()["nodes"]
    assert set(nodes) == {"n1", "n2"}
