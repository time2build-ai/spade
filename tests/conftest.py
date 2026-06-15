"""Make the project root importable so `import tui_pilot` works under pytest."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from tui_pilot import db

@pytest.fixture(autouse=True)
def tui_pilot_home(monkeypatch, tmp_path):
    """Every test gets its own empty SQLite DB under a temp home."""
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path / "home"))
    db.reset()
    yield
    db.reset()
