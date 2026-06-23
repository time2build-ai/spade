from pathlib import Path
from tui_pilot import accounts, db


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


def test_set_default_nonexistent_raises_and_preserves_default():
    accounts.create(id="a", label="A", config_dir="/a")
    accounts.set_default("a")
    import pytest
    with pytest.raises(ValueError):
        accounts.set_default("nonexistent")
    # The previously-set default must remain intact (transaction rolled back).
    assert accounts.default_account()["id"] == "a"


def test_scan_managed_lists_provider_dirs():
    base = accounts.provider_dir()  # = db.home()/agents/claude-code
    (base / "inforge").mkdir(parents=True)
    (base / "founder").mkdir(parents=True)
    assert set(accounts.scan_managed()) == {"inforge", "founder"}


def test_scan_importable_finds_dot_claude_dirs(monkeypatch, tmp_path):
    monkeypatch.setattr(accounts, "_user_home", lambda: tmp_path)
    (tmp_path / ".claude-t2b").mkdir()
    (tmp_path / ".claude-inforge").mkdir()
    (tmp_path / ".claude").mkdir()  # base config — also importable
    found = set(accounts.scan_importable())
    assert str(tmp_path / ".claude-t2b") in found
    assert str(tmp_path / ".claude-inforge") in found
    assert str(tmp_path / ".claude") in found


def test_auth_status(tmp_path):
    d = tmp_path / "acct"; d.mkdir()
    assert accounts.auth_status(str(d)) == "not_logged_in"
    # An empty {} credentials file is NOT proof of login (false positive).
    (d / ".credentials.json").write_text("{}")
    assert accounts.auth_status(str(d)) == "not_logged_in"
    # A real credentials payload counts as authed.
    (d / ".credentials.json").write_text('{"claudeAiOauth": {"accessToken": "x"}}')
    assert accounts.auth_status(str(d)) == "authed"


def test_auth_status_claude_json_requires_oauth_account(tmp_path):
    # .claude.json can exist for config-only reasons; only treat as authed when
    # it carries a real oauthAccount/apiKey AND a completed login.
    d = tmp_path / "acct2"; d.mkdir()
    (d / ".claude.json").write_text('{"foo": 1}')
    assert accounts.auth_status(str(d)) == "not_logged_in"
    # oauthAccount metadata WITHOUT a completed login (the half-finished login
    # case) is still not usable — Claude re-prompts the login menu.
    (d / ".claude.json").write_text('{"oauthAccount": {"emailAddress": "x@y.z"}}')
    assert accounts.auth_status(str(d)) == "not_logged_in"
    # oauthAccount + a completed login → authed.
    (d / ".claude.json").write_text(
        '{"oauthAccount": {"emailAddress": "x@y.z"}, "hasCompletedOnboarding": true}'
    )
    assert accounts.auth_status(str(d)) == "authed"
    # …or evidence of prior successful starts.
    (d / ".claude.json").write_text(
        '{"oauthAccount": {"emailAddress": "x@y.z"}, "numStartups": 5}'
    )
    assert accounts.auth_status(str(d)) == "authed"


def test_auth_status_empty_dir(tmp_path):
    d = tmp_path / "empty"; d.mkdir()
    assert accounts.auth_status(str(d)) == "not_logged_in"


def test_create_managed_makes_dir():
    a = accounts.create_managed(id="inforge", label="Inforge", color="#60a5fa")
    assert Path(a["config_dir"]) == accounts.provider_dir() / "inforge"
    assert Path(a["config_dir"]).is_dir()


def test_import_existing_registers_without_moving(tmp_path):
    src = tmp_path / ".claude-t2b"; src.mkdir()
    a = accounts.import_existing(id="t2b", label="Time2Build", config_dir=str(src))
    assert a["config_dir"] == str(src)
