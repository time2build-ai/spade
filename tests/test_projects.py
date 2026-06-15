from tui_pilot import projects, accounts


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


def test_next_account_skips_orphans_and_empty_pool_returns_none():
    projects.create(id="e", name="E", path="/w")
    assert projects.next_account("e") is None


def test_current_project_get_set():
    projects.create(id="acme", name="Acme", path="/w")
    assert projects.current_project_id() is None
    projects.set_current_project("acme")
    assert projects.current_project_id() == "acme"
