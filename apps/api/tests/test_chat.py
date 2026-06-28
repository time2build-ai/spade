from tui_pilot import chat, projects


def _proj():
    projects.create(id="acme", name="Acme", path="/w")


def test_threads_pinned_first_then_recent():
    _proj()
    chat.create_thread("acme", title="A")
    chat.create_thread("acme", title="B", pinned=True)
    rows = chat.list_threads("acme")
    assert rows[0]["title"] == "B" and rows[0]["pinned"] == 1


def test_message_payload_roundtrip_and_bumps_thread():
    _proj()
    t = chat.create_thread("acme", title="T")
    first_updated = t["updated_at"]

    chat.add_message(t["id"], role="user", text="hi", who="Robert")
    m = chat.add_message(t["id"], role="assistant", text="here's the diff", who="Spade",
                         payload={"action": {"kind": "ADR-EDIT", "id": "ADR-031"}})
    msgs = chat.list_messages(t["id"])
    assert [x["role"] for x in msgs] == ["user", "assistant"]
    assert msgs[1]["payload"]["action"]["kind"] == "ADR-EDIT"  # decoded JSON
    assert m["payload"]["action"]["id"] == "ADR-031"
    # Adding a message bumped the thread's updated_at.
    assert chat.get_thread(t["id"])["updated_at"] >= first_updated


def test_chat_http_flow():
    from fastapi.testclient import TestClient
    from tui_pilot import server

    _proj()
    client = TestClient(server.app)
    assert client.get("/chat/threads", params={"project_id": "acme"}).json()["threads"] == []

    t = client.post("/chat/threads", json={"project_id": "acme", "title": "Why is conv down?"}).json()
    tid = t["id"]
    assert client.get("/chat/threads", params={"project_id": "acme"}).json()["threads"][0]["id"] == tid

    client.post(f"/chat/threads/{tid}/messages", json={"role": "user", "text": "why?", "who": "R"})
    r = client.post(f"/chat/threads/{tid}/messages", json={
        "role": "assistant", "text": "signals", "who": "Spade",
        "payload": {"plan": {"title": "Investigate", "steps": ["a", "b"]}},
    })
    assert r.status_code == 200 and r.json()["payload"]["plan"]["steps"] == ["a", "b"]

    msgs = client.get(f"/chat/threads/{tid}/messages").json()["messages"]
    assert len(msgs) == 2
    # 404s on unknown thread / project.
    assert client.get("/chat/threads/nope/messages").status_code == 404
    assert client.post("/chat/threads", json={"project_id": "nope"}).status_code == 404
