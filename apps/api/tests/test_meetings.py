from tui_pilot import meetings, projects


def _proj():
    projects.create(id="acme", name="Acme", path="/w")


def test_create_get_list_attendees_roundtrip():
    _proj()
    m = meetings.create(project_id="acme", title="Sprint Planning",
                        date="2026-03-25", summary="Prioritised checkout.",
                        attendees=["Priya", "Akira", "Robert"])
    assert m["title"] == "Sprint Planning"
    assert m["attendees"] == ["Priya", "Akira", "Robert"]  # decoded from JSON
    assert meetings.get(m["id"])["summary"] == "Prioritised checkout."


def test_list_newest_first_and_empty_default():
    _proj()
    assert meetings.list_for_project("acme") == []
    meetings.create(project_id="acme", title="Old", date="2026-01-01")
    meetings.create(project_id="acme", title="New", date="2026-03-01")
    titles = [m["title"] for m in meetings.list_for_project("acme")]
    assert titles == ["New", "Old"]


def test_meetings_http_get_post():
    from fastapi.testclient import TestClient
    from tui_pilot import server

    _proj()
    client = TestClient(server.app)
    assert client.get("/meetings", params={"project_id": "acme"}).json()["meetings"] == []

    r = client.post("/meetings", json={
        "project_id": "acme", "title": "Architecture review", "date": "2026-01-14",
        "summary": "Chose collaborative filtering.", "attendees": ["Akira", "Maya"],
    })
    assert r.status_code == 200 and r.json()["attendees"] == ["Akira", "Maya"]

    rows = client.get("/meetings", params={"project_id": "acme"}).json()["meetings"]
    assert len(rows) == 1 and rows[0]["title"] == "Architecture review"
    assert client.post("/meetings", json={"project_id": "nope", "title": "X"}).status_code == 404
