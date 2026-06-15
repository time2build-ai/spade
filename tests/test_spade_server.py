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
