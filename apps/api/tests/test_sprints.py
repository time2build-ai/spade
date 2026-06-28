from tui_pilot import sprints, projects, pipelines, tasks


def _proj():
    projects.create(id="acme", name="Acme", path="/w")


def test_create_list_current():
    _proj()
    sprints.create(project_id="acme", number=25, day_label="day 10/10", state="done")
    cur = sprints.create(project_id="acme", number=26, day_label="day 2/10", state="active")

    rows = sprints.list_for_project("acme")
    assert [s["number"] for s in rows] == [26, 25]  # newest number first
    assert sprints.current("acme")["id"] == cur["id"]
    assert sprints.current("acme")["number"] == 26


def test_counts_derived_from_real_pipeline_runs():
    """shipped/review/progress/queued come from the project's real pipeline runs."""
    _proj()
    s = sprints.create(project_id="acme", number=26)
    # No runs yet → all zero.
    assert s["shipped"] == 0 and s["total"] == 0

    tid = tasks.create(project_id="acme", title="X")["id"]
    run = pipelines.create_run(project_id="acme", task_id=tid)  # status 'queued'
    got = sprints.current("acme")
    assert got["queued"] == 1 and got["total"] == 1

    pipelines._set_run(run["id"], status="shipped")
    assert sprints.current("acme")["shipped"] == 1


def test_sprints_http_get_and_post():
    from fastapi.testclient import TestClient
    from tui_pilot import server

    _proj()
    client = TestClient(server.app)
    assert client.get("/sprints", params={"project_id": "acme"}).json()["sprints"] == []

    r = client.post("/sprints", json={"project_id": "acme", "number": 26, "day_label": "day 2/10"})
    assert r.status_code == 200 and r.json()["number"] == 26

    rows = client.get("/sprints", params={"project_id": "acme"}).json()["sprints"]
    assert len(rows) == 1 and rows[0]["day_label"] == "day 2/10"
    # Unknown project → 404 on POST.
    assert client.post("/sprints", json={"project_id": "nope", "number": 1}).status_code == 404
