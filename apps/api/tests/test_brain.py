import pytest
from tui_pilot import brain, projects


def _proj():
    projects.create(id="acme", name="Acme", path="/w")


def test_brain_tables_exist():
    from tui_pilot import db
    rows = db.query("SELECT name FROM sqlite_master WHERE type='table'")
    names = {r["name"] for r in rows}
    assert "brain_nodes" in names
    assert "brain_edges" in names


def test_node_and_edge_crud():
    _proj()
    n1 = brain.create_node(project_id="acme", type="feature", label="Checkout")
    n2 = brain.create_node(project_id="acme", type="decision", label="ADR-1 Stripe")
    assert {n["id"] for n in brain.list_nodes("acme")} == {n1["id"], n2["id"]}
    e = brain.add_edge(project_id="acme", from_id=n1["id"], to_id=n2["id"], rel="decided_by")
    assert brain.list_edges("acme")[0]["from_id"] == n1["id"]
    brain.delete_node(n1["id"])
    assert brain.list_edges("acme") == []   # edge cascades when a node is deleted


def test_invalid_node_type_rejected():
    _proj()
    with pytest.raises(ValueError):
        brain.create_node(project_id="acme", type="bogus", label="x")


def test_update_node():
    _proj()
    n = brain.create_node(project_id="acme", type="feature", label="A")
    brain.update_node(n["id"], label="B", detail="notes")
    assert brain.get_node(n["id"])["label"] == "B"


def test_update_node_invalid_type_rejected():
    _proj()
    n = brain.create_node(project_id="acme", type="feature", label="A")
    with pytest.raises(ValueError):
        brain.update_node(n["id"], type="bogus")


def test_add_edge_bad_node_id_rejected():
    _proj()
    n = brain.create_node(project_id="acme", type="feature", label="A")
    with pytest.raises(ValueError):
        brain.add_edge(project_id="acme", from_id="nope", to_id=n["id"])
    with pytest.raises(ValueError):
        brain.add_edge(project_id="acme", from_id=n["id"], to_id="nope")


def test_decision_node_status_owner_persist_and_patch():
    """Phase 3: decision (ADR) brain nodes carry real status + owner columns."""
    _proj()
    n = brain.create_node(project_id="acme", type="decision",
                          label="Use collaborative filtering",
                          status="active", owner="Akira")
    assert n["status"] == "active" and n["owner"] == "Akira"
    assert brain.get_node(n["id"])["status"] == "active"

    brain.update_node(n["id"], status="superseded", owner="Maya")
    got = brain.get_node(n["id"])
    assert got["status"] == "superseded" and got["owner"] == "Maya"


def test_node_status_owner_via_http(monkeypatch):
    from fastapi.testclient import TestClient
    from tui_pilot import server

    _proj()
    client = TestClient(server.app)
    r = client.post("/brain/nodes", json={
        "project_id": "acme", "type": "decision", "label": "Lazy-load carousels",
        "status": "proposed", "owner": "Robert",
    })
    assert r.status_code == 200
    nid = r.json()["id"]
    assert r.json()["status"] == "proposed" and r.json()["owner"] == "Robert"

    # GET /brain/nodes returns the columns; PATCH flips status.
    nodes = {n["id"]: n for n in client.get("/brain/nodes", params={"project_id": "acme"}).json()["nodes"]}
    assert nodes[nid]["status"] == "proposed"
    assert client.patch(f"/brain/nodes/{nid}", json={"status": "active"}).json()["status"] == "active"
