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


def test_node_provenance_source_and_updated_at():
    """Phase 3: brain nodes carry real source + an updated_at that bumps on edit."""
    _proj()
    n = brain.create_node(project_id="acme", type="feature", label="Checkout",
                          owner="Akira", source="Sprint Planning")
    assert n["source"] == "Sprint Planning"
    assert n["owner"] == "Akira"
    # created → updated_at is set (== created_at on insert).
    assert n["updated_at"] is not None
    first_touch = n["updated_at"]

    # Any edit bumps updated_at (and persists source via the whitelist).
    brain.update_node(n["id"], source="Architecture review")
    got = brain.get_node(n["id"])
    assert got["source"] == "Architecture review"
    assert got["updated_at"] >= first_touch


def test_export_manifest_real_counts_and_resources():
    """Phase 3: /brain/export reflects the real graph."""
    _proj()
    f = brain.create_node(project_id="acme", type="feature", label="Checkout")
    brain.create_node(project_id="acme", type="decision", label="Use Stripe")
    export = brain.export_manifest("acme")
    assert export["node_count"] == 2
    assert export["by_type"] == {"feature": 1, "decision": 1}
    assert any(r["uri"].endswith(f["id"]) and r["type"] == "feature" for r in export["resources"])


def test_find_gaps_orphan_unresolved_undecided():
    _proj()
    # Orphan feature with no edges → orphan + undecided-feature.
    f = brain.create_node(project_id="acme", type="feature", label="Search")
    # A proposed decision → unresolved-decision (also orphan until linked).
    d = brain.create_node(project_id="acme", type="decision", label="Adopt X", status="proposed")
    gaps = brain.find_gaps("acme")
    kinds = {(g["id"], g["kind"]) for g in gaps}
    assert (f["id"], "orphan") in kinds
    assert (f["id"], "undecided-feature") in kinds
    assert (d["id"], "unresolved-decision") in kinds

    # Link the feature to the decision → no longer orphan/undecided for the feature.
    brain.add_edge(project_id="acme", from_id=f["id"], to_id=d["id"])
    gaps2 = {(g["id"], g["kind"]) for g in brain.find_gaps("acme")}
    assert (f["id"], "orphan") not in gaps2
    assert (f["id"], "undecided-feature") not in gaps2
    # The decision is still proposed → still flagged unresolved.
    assert (d["id"], "unresolved-decision") in gaps2


def test_brain_export_gaps_http():
    from fastapi.testclient import TestClient
    from tui_pilot import server

    _proj()
    brain.create_node(project_id="acme", type="feature", label="Lonely")
    client = TestClient(server.app)
    exp = client.get("/brain/export", params={"project_id": "acme"}).json()
    assert exp["node_count"] == 1
    gaps = client.get("/brain/gaps", params={"project_id": "acme"}).json()["gaps"]
    assert any(g["kind"] == "orphan" for g in gaps)


def test_find_conflict_proposed_vs_active():
    """Phase 3: a real gate conflict is derived from proposed vs active decisions."""
    _proj()
    # No decisions → no conflict.
    assert brain.find_conflict("acme") is None

    active = brain.create_node(project_id="acme", type="decision", label="Use collaborative filtering",
                               status="active", owner="Akira")
    # Only an active one → still no conflict (needs a proposal).
    assert brain.find_conflict("acme") is None

    proposed = brain.create_node(project_id="acme", type="decision", label="Switch to content-based",
                                 status="proposed", owner="Robert")
    c = brain.find_conflict("acme")
    assert c is not None
    assert c["proposed"]["id"] == proposed["id"] and c["proposed"]["owner"] == "Robert"
    assert c["existing"]["id"] == active["id"] and c["existing"]["label"] == "Use collaborative filtering"


def test_gate_conflict_http():
    from fastapi.testclient import TestClient
    from tui_pilot import server

    _proj()
    client = TestClient(server.app)
    assert client.get("/gate/conflict", params={"project_id": "acme"}).json()["conflict"] is None

    brain.create_node(project_id="acme", type="decision", label="A", status="active")
    brain.create_node(project_id="acme", type="decision", label="B", status="proposed")
    c = client.get("/gate/conflict", params={"project_id": "acme"}).json()["conflict"]
    assert c["existing"]["label"] == "A" and c["proposed"]["label"] == "B"
