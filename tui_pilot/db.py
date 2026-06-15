"""SQLite persistence: one DB file under $TUI_PILOT_HOME (default ~/.tui-pilot)."""
from __future__ import annotations
import os
import sqlite3
import threading
from pathlib import Path

def home() -> Path:
    return Path(os.environ.get("TUI_PILOT_HOME", str(Path.home() / ".tui-pilot")))

def db_path() -> Path:
    return home() / "tui-pilot.db"
