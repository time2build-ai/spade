"""SQLite persistence: one DB file under $TUI_PILOT_HOME (default ~/.tui-pilot)."""
from __future__ import annotations
import contextlib
import os
import sqlite3
import threading
from pathlib import Path


def home() -> Path:
    return Path(os.environ.get("TUI_PILOT_HOME", str(Path.home() / ".tui-pilot")))


def db_path() -> Path:
    return home() / "tui-pilot.db"


_conn: sqlite3.Connection | None = None
_init_lock = threading.Lock()       # guards lazy connect only
_exec_lock = threading.RLock()      # serializes ALL query execution
_SCHEMA = Path(__file__).resolve().parent / "schema.sql"


def get_conn() -> sqlite3.Connection:
    global _conn
    with _init_lock:
        if _conn is None:
            db_path().parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(str(db_path()), check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA foreign_keys=ON")
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.executescript(_SCHEMA.read_text())
            _conn.commit()
        return _conn


@contextlib.contextmanager
def tx():
    """Serialized transaction: yields the connection under _exec_lock, commits
    on success, rolls back on error. Re-entrant (RLock) so nested helper calls
    are safe within one logical transaction."""
    cx = get_conn()
    with _exec_lock:
        try:
            yield cx
            cx.commit()
        except Exception:
            cx.rollback()
            raise


def query(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    with _exec_lock:
        return get_conn().execute(sql, params).fetchall()


def execute(sql: str, params: tuple = ()) -> None:
    with tx() as cx:
        cx.execute(sql, params)


def reset() -> None:
    """Close the singleton so the next get_conn() reopens at the current path.
    Test-only helper to isolate per-test databases."""
    global _conn
    with _init_lock, _exec_lock:
        if _conn is not None:
            _conn.close()
        _conn = None
