from tui_pilot import feedback, projects


def _proj():
    projects.create(id="acme", name="Acme", path="/w")


def test_create_get_sources_roundtrip():
    _proj()
    c = feedback.create(project_id="acme", label="Checkout slow on mobile", count=12,
                        sources=[{"name": "Intercom", "n": 7, "color": "var(--blue)"}])
    assert c["label"] == "Checkout slow on mobile" and c["count"] == 12
    assert c["sources"][0]["name"] == "Intercom"  # decoded from JSON
    assert feedback.get(c["id"])["count"] == 12


def test_list_biggest_first():
    _proj()
    assert feedback.list_for_project("acme") == []
    feedback.create(project_id="acme", label="small", count=3)
    feedback.create(project_id="acme", label="big", count=12)
    labels = [c["label"] for c in feedback.list_for_project("acme")]
    assert labels == ["big", "small"]


def test_feedback_http_get_post():
    from fastapi.testclient import TestClient
    from tui_pilot import server

    _proj()
    client = TestClient(server.app)
    assert client.get("/feedback", params={"project_id": "acme"}).json()["clusters"] == []

    r = client.post("/feedback", json={
        "project_id": "acme", "label": "Recs feel random", "count": 8,
        "sources": [{"name": "App Store", "n": 5, "color": "var(--amber)"}],
    })
    assert r.status_code == 200 and r.json()["sources"][0]["n"] == 5

    rows = client.get("/feedback", params={"project_id": "acme"}).json()["clusters"]
    assert len(rows) == 1 and rows[0]["label"] == "Recs feel random"
    assert client.post("/feedback", json={"project_id": "nope", "label": "x"}).status_code == 404
