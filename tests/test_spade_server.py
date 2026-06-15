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


def test_brain_node_edge_endpoints():
    from tui_pilot.server import app
    from tui_pilot import projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)
    # Create two nodes
    r1 = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "Checkout"})
    assert r1.status_code == 200
    n1_id = r1.json()["id"]
    r2 = c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "ADR-1 Stripe"})
    assert r2.status_code == 200
    n2_id = r2.json()["id"]
    # List nodes
    nodes = c.get("/brain/nodes?project_id=acme").json()["nodes"]
    assert {n["id"] for n in nodes} == {n1_id, n2_id}
    # Create edge
    re = c.post("/brain/edges", json={"project_id": "acme", "from_id": n1_id, "to_id": n2_id, "rel": "decided_by"})
    assert re.status_code == 200
    edges = c.get("/brain/edges?project_id=acme").json()["edges"]
    assert edges[0]["from_id"] == n1_id
    assert edges[0]["to_id"] == n2_id


def test_brain_invalid_type_returns_400():
    from tui_pilot.server import app
    from tui_pilot import projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)
    r = c.post("/brain/nodes", json={"project_id": "acme", "type": "bogus", "label": "x"})
    assert r.status_code == 400


def test_brain_edge_bad_node_id_returns_400():
    from tui_pilot.server import app
    from tui_pilot import projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)
    n1_id = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "Checkout"}).json()["id"]
    r = c.post("/brain/edges", json={"project_id": "acme", "from_id": "bogus", "to_id": n1_id})
    assert r.status_code == 400


def test_brain_node_404():
    from tui_pilot.server import app
    c = TestClient(app)
    r = c.get("/brain/nodes?project_id=nonexistent")
    assert r.status_code == 200  # returns empty list, not 404
    r2 = c.patch("/brain/nodes/nope", json={"label": "y"})
    assert r2.status_code == 404


def test_grounding_round_trip():
    from tui_pilot.server import app
    from tui_pilot import projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)
    # Create two brain nodes
    n1_id = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "Checkout"}).json()["id"]
    n2_id = c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "ADR-1"}).json()["id"]
    # Create a task
    tid = c.post("/tasks", json={"project_id": "acme", "title": "Implement checkout"}).json()["id"]
    # Ground the task to those nodes
    r = c.put(f"/tasks/{tid}/nodes", json={"node_ids": [n1_id, n2_id]})
    assert r.status_code == 200
    # GET task and assert nodes are present
    task = c.get(f"/tasks/{tid}").json()
    assert set(task["nodes"]) == {n1_id, n2_id}
    # Verify the node labels can be resolved via GET /brain/nodes
    nodes_resp = c.get("/brain/nodes?project_id=acme").json()["nodes"]
    node_map = {n["id"]: n["label"] for n in nodes_resp}
    assert node_map[n1_id] == "Checkout"
    assert node_map[n2_id] == "ADR-1"


def test_pipeline_endpoints_manual_advance_to_shipped(monkeypatch):
    from tui_pilot.server import app
    from tui_pilot import server, projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)

    spawned = []

    def fake_spawn_agent(**kw):
        spawned.append(kw)
        return {"id": f"fakesess{len(spawned)}", "account_id": "a"}

    monkeypatch.setattr(server, "_spawn_agent", fake_spawn_agent)

    tid = c.post("/tasks", json={"project_id": "acme", "title": "Build X"}).json()["id"]

    # create pipeline
    run = c.post("/pipelines", json={"project_id": "acme", "task_id": tid}).json()
    rid = run["id"]
    assert [s["role"] for s in run["stages"]] == ["developer", "reviewer", "integrator", "documentor"]

    # list + get
    assert c.get("/pipelines?project_id=acme").json()["pipelines"][0]["id"] == rid
    assert c.get(f"/pipelines/{rid}").json()["id"] == rid

    # start stage 0
    started = c.post(f"/pipelines/{rid}/start").json()
    assert started["status"] == "running"
    assert started["stages"][0]["state"] == "running"
    assert started["stages"][0]["session_id"] == "fakesess1"

    # advance through all 4 stages
    for i in range(4):
        c.post(f"/pipelines/{rid}/advance", json={"report": f"r{i}"})

    final = c.get(f"/pipelines/{rid}").json()
    assert final["status"] == "shipped"
    assert [s["state"] for s in final["stages"]] == ["done"] * 4
    assert c.get(f"/tasks/{tid}").json()["status"] == "shipped"


def test_advance_already_shipped_run_is_idempotent(monkeypatch):
    from tui_pilot.server import app
    from tui_pilot import server, projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)

    monkeypatch.setattr(
        server, "_spawn_agent",
        lambda **kw: {"id": "fakesess", "account_id": "a"},
    )

    tid = c.post("/tasks", json={"project_id": "acme", "title": "Build X"}).json()["id"]
    rid = c.post("/pipelines", json={"project_id": "acme", "task_id": tid}).json()["id"]
    c.post(f"/pipelines/{rid}/start")
    for i in range(4):
        c.post(f"/pipelines/{rid}/advance", json={"report": f"r{i}"})
    assert c.get(f"/pipelines/{rid}").json()["status"] == "shipped"

    # Advancing an already-shipped run returns it unchanged, no error.
    r = c.post(f"/pipelines/{rid}/advance", json={"report": "again"})
    assert r.status_code == 200
    assert r.json()["status"] == "shipped"
    assert [s["state"] for s in r.json()["stages"]] == ["done"] * 4
    assert c.get(f"/tasks/{tid}").json()["status"] == "shipped"


def test_pipeline_create_404_for_missing_task():
    from tui_pilot.server import app
    from tui_pilot import projects
    projects.create(id="acme", name="Acme", path="/w")
    c = TestClient(app)
    assert c.post("/pipelines", json={"project_id": "acme", "task_id": "SPD-999"}).status_code == 404
    assert c.post("/pipelines", json={"project_id": "nope", "task_id": "SPD-1"}).status_code == 404
