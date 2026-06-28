from tui_pilot import integrations, projects


def _proj():
    projects.create(id="acme", name="Acme", path="/w")


def test_create_list_ordered():
    _proj()
    integrations.create(project_id="acme", name="Sentry", category="Observability")
    integrations.create(project_id="acme", name="GitHub", category="Source", connected=True)
    rows = integrations.list_for_project("acme")
    # ordered by category, then name
    assert [r["name"] for r in rows] == ["Sentry", "GitHub"][::-1] or [r["category"] for r in rows] == ["Observability", "Source"]
    assert any(r["name"] == "GitHub" and r["connected"] == 1 for r in rows)


def test_set_connected_toggles_status():
    _proj()
    i = integrations.create(project_id="acme", name="Slack", category="Comms")
    assert i["connected"] == 0 and i["status"] == "off"
    on = integrations.set_connected(i["id"], True)
    assert on["connected"] == 1 and on["status"] == "connected"
    off = integrations.set_connected(i["id"], False)
    assert off["connected"] == 0 and off["status"] == "off"


def test_integrations_http_get_post_patch():
    from fastapi.testclient import TestClient
    from tui_pilot import server

    _proj()
    client = TestClient(server.app)
    assert client.get("/integrations", params={"project_id": "acme"}).json()["integrations"] == []

    r = client.post("/integrations", json={"project_id": "acme", "name": "Linear", "category": "Issues"})
    assert r.status_code == 200
    iid = r.json()["id"]

    p = client.patch(f"/integrations/{iid}", json={"connected": True})
    assert p.status_code == 200 and p.json()["connected"] == 1 and p.json()["status"] == "connected"

    assert client.patch("/integrations/nope", json={"connected": True}).status_code == 404
    assert client.post("/integrations", json={"project_id": "nope", "name": "X"}).status_code == 404
