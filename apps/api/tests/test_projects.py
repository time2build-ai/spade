from tui_pilot import projects, accounts, db


def _mk_accounts():
    accounts.create(id="t2b", label="T2B", config_dir="/t2b")
    accounts.create(id="inf", label="Inforge", config_dir="/inf")


def test_create_project_and_pool_order():
    _mk_accounts()
    p = projects.create(id="acme", name="Acme", path="/work/acme",
                        account_strategy="round_robin")
    projects.set_pool("acme", ["t2b", "inf"])
    assert projects.pool("acme") == ["t2b", "inf"]
    projects.set_pool("acme", ["inf", "t2b"])
    assert projects.pool("acme") == ["inf", "t2b"]


def test_round_robin_cycles_and_persists():
    _mk_accounts()
    projects.create(id="acme", name="Acme", path="/w", account_strategy="round_robin")
    projects.set_pool("acme", ["t2b", "inf"])
    picks = [projects.next_account("acme") for _ in range(3)]
    assert picks == ["t2b", "inf", "t2b"]
    assert projects.get("acme")["rr_cursor"] == 3


def test_single_strategy_always_first():
    _mk_accounts()
    projects.create(id="s", name="S", path="/w", account_strategy="single")
    projects.set_pool("s", ["t2b"])
    assert [projects.next_account("s") for _ in range(2)] == ["t2b", "t2b"]


def test_next_account_empty_pool_returns_none():
    projects.create(id="e", name="E", path="/w")
    assert projects.next_account("e") is None


def test_next_account_skips_deleted_account():
    _mk_accounts()
    projects.create(id="acme", name="Acme", path="/w", account_strategy="round_robin")
    projects.set_pool("acme", ["t2b", "inf"])
    # Delete one account directly; FK cascade removes its project_accounts row.
    db.execute("DELETE FROM accounts WHERE id = ?", ("inf",))
    picks = [projects.next_account("acme") for _ in range(3)]
    assert picks == ["t2b", "t2b", "t2b"]
    assert "inf" not in picks


def test_update_multiple_fields_atomic():
    projects.create(id="acme", name="Acme", path="/w")
    projects.update("acme", name="Acme Corp", model_ceiling="opus")
    p = projects.get("acme")
    assert p["name"] == "Acme Corp"
    assert p["model_ceiling"] == "opus"


def test_current_project_get_set():
    projects.create(id="acme", name="Acme", path="/w")
    assert projects.current_project_id() is None
    projects.set_current_project("acme")
    assert projects.current_project_id() == "acme"


def test_set_pool_rejects_unknown_account():
    import pytest
    projects.create(id="p", name="P", path="/w")
    with pytest.raises(ValueError):
        projects.set_pool("p", ["does-not-exist"])


def test_patch_project_http_persists_automation_settings():
    """Phase 3: the Settings screen persists autopilot/strategy/ceiling through
    the existing PATCH /projects/{id} route."""
    from fastapi.testclient import TestClient
    from tui_pilot import server

    projects.create(id="acme", name="Acme", path="/w",
                    account_strategy="single", model_ceiling=None, autopilot=0)
    client = TestClient(server.app)

    r = client.patch("/projects/acme", json={
        "autopilot": 1, "account_strategy": "round_robin", "model_ceiling": "opus",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["autopilot"] == 1
    assert body["account_strategy"] == "round_robin"
    assert body["model_ceiling"] == "opus"

    # Persisted to the DB, and an explicit null clears the ceiling.
    assert projects.get("acme")["autopilot"] == 1
    r2 = client.patch("/projects/acme", json={"model_ceiling": None})
    assert r2.status_code == 200 and projects.get("acme")["model_ceiling"] is None
    # Omitted fields are untouched.
    assert projects.get("acme")["autopilot"] == 1
