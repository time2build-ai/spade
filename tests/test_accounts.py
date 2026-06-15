from tui_pilot import accounts


def test_create_and_get():
    a = accounts.create(id="t2b", label="Time2Build", config_dir="/x/t2b", color="#34d399")
    assert a["label"] == "Time2Build"
    assert accounts.get("t2b")["config_dir"] == "/x/t2b"
    assert [r["id"] for r in accounts.list_all()] == ["t2b"]


def test_single_default_invariant():
    accounts.create(id="a", label="A", config_dir="/a")
    accounts.create(id="b", label="B", config_dir="/b")
    accounts.set_default("a")
    accounts.set_default("b")
    defaults = [r["id"] for r in accounts.list_all() if r["is_default"]]
    assert defaults == ["b"]
    assert accounts.default_account()["id"] == "b"


def test_default_account_none_when_empty():
    assert accounts.default_account() is None
