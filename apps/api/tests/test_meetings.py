from tui_pilot import meetings, projects, tasks


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


# -- ingest: transcript → backlog -------------------------------------------

def test_extract_action_items_parses_arrows_and_priority():
    items = meetings.extract_action_items(
        "You: Let's get going. No action here.\n"
        "Maya: The list view matters most. → Build the todo list view\n"
        "Devin: This one's urgent. →! Fix the save race\n"
        "Priya: just chatting\n"
    )
    assert [i["title"] for i in items] == ["Build the todo list view", "Fix the save race"]
    # speaker label is stripped from the kept quote
    assert items[0]["quote"] == "The list view matters most."
    # plain priority 2, bang priority 1
    assert items[0]["priority"] == 2 and items[1]["priority"] == 1


def test_ingest_sample_creates_meeting_and_grounded_tasks():
    _proj()
    out = meetings.ingest("acme", sample="todo-kickoff")
    mtg, created = out["meeting"], out["tasks"]
    assert mtg["source"] == "Granola" and mtg["transcript"]
    assert len(created) >= 5  # one task per action line in the sample
    # every task is grounded back to the meeting
    for t in created:
        assert t["origin_source"] == mtg["title"]
        assert t["status"] == "ready"
    # tasks really landed in the project backlog (the sample is in Spanish)
    titles = [t["title"] for t in tasks.list_for_project("acme")]
    assert "Construir la vista de lista de tareas con alta y marcado" in titles


def test_ingest_requires_sample_or_transcript():
    _proj()
    import pytest
    with pytest.raises(ValueError):
        meetings.ingest("acme", title="No transcript")
    with pytest.raises(ValueError):
        meetings.ingest("acme", sample="does-not-exist")


def test_ingest_http_endpoint_and_samples_catalog():
    from fastapi.testclient import TestClient
    from tui_pilot import server

    _proj()
    client = TestClient(server.app)

    samples = client.get("/meetings/samples").json()["samples"]
    assert any(s["id"] == "todo-kickoff" for s in samples)

    r = client.post("/meetings/ingest", json={"project_id": "acme", "sample": "todo-kickoff"})
    assert r.status_code == 200
    body = r.json()
    assert body["meeting"]["title"] == "Todo App — kickoff"
    assert len(body["tasks"]) >= 5

    # explicit transcript path
    r2 = client.post("/meetings/ingest", json={
        "project_id": "acme", "title": "Adhoc", "source": "Manual",
        "transcript": "You: do the thing → Ship the thing\n",
    })
    assert r2.status_code == 200 and r2.json()["tasks"][0]["title"] == "Ship the thing"

    # validation + project guards
    assert client.post("/meetings/ingest", json={"project_id": "acme"}).status_code == 422
    assert client.post("/meetings/ingest", json={
        "project_id": "nope", "sample": "todo-kickoff"}).status_code == 404
