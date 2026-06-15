import os
from pathlib import Path
from tui_pilot import db

def test_home_defaults_to_dot_tui_pilot(monkeypatch):
    monkeypatch.delenv("TUI_PILOT_HOME", raising=False)
    assert db.home() == Path.home() / ".tui-pilot"

def test_home_honors_env(monkeypatch, tmp_path):
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path))
    assert db.home() == tmp_path
    assert db.db_path() == tmp_path / "tui-pilot.db"

def test_connect_creates_schema(monkeypatch, tmp_path):
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path))
    db.reset()
    conn = db.get_conn()
    tables = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"accounts", "projects", "project_accounts",
            "roles", "sessions", "missions", "app_state"} <= tables

def test_foreign_keys_enabled(monkeypatch, tmp_path):
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path))
    db.reset()
    assert db.get_conn().execute("PRAGMA foreign_keys").fetchone()[0] == 1
