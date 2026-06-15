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
