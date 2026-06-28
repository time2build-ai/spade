"""SQLite persistence: one DB file under $TUI_PILOT_HOME (default ~/.spade)."""
from __future__ import annotations
import contextlib
import os
import sqlite3
import threading
from pathlib import Path


def home() -> Path:
    return Path(os.environ.get("TUI_PILOT_HOME", str(Path.home() / ".spade")))


def db_path() -> Path:
    return home() / "tui-pilot.db"


_conn: sqlite3.Connection | None = None
_init_lock = threading.Lock()       # guards lazy connect only
_exec_lock = threading.RLock()      # serializes ALL query execution
_tx_depth = threading.local()       # tracks nested tx() re-entrancy per thread
_SCHEMA = Path(__file__).resolve().parent / "schema.sql"


def get_conn() -> sqlite3.Connection:
    """Return the shared connection singleton, lazily opening it.

    Writes from concurrent threads MUST go through tx()/execute(); calling
    .execute() directly on the returned connection is only safe in
    single-threaded / test code.
    """
    global _conn
    with _init_lock:
        if _conn is None:
            db_path().parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(str(db_path()), check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA foreign_keys=ON")
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.executescript(_SCHEMA.read_text())
            _migrate(_conn)
            _conn.commit()
        return _conn


# Additive, idempotent column migrations for existing DBs. The base schema uses
# CREATE TABLE IF NOT EXISTS, so pre-existing tables never gain new columns from
# the script alone — add them here (nullable, backward-compatible).
_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "accounts": {"role": "TEXT", "model": "TEXT", "plan": "TEXT"},
}


def _migrate(conn) -> None:
    for table, cols in _ADDED_COLUMNS.items():
        existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for col, decl in cols.items():
            if col not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


@contextlib.contextmanager
def tx():
    """Serialized transaction: yields the connection under _exec_lock, commits
    on success, rolls back on error. Re-entrant (RLock) so nested helper calls
    are safe within one logical transaction; only the OUTERMOST tx commits or
    rolls back, so a nested tx() never commits early when the outer one fails."""
    cx = get_conn()
    with _exec_lock:
        depth = getattr(_tx_depth, "n", 0)
        _tx_depth.n = depth + 1
        try:
            yield cx
            if _tx_depth.n == 1:
                cx.commit()
        except Exception:
            if _tx_depth.n == 1:
                cx.rollback()
            raise
        finally:
            _tx_depth.n -= 1


def query(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    cx = get_conn()
    with _exec_lock:
        return cx.execute(sql, params).fetchall()


def execute(sql: str, params: tuple = ()) -> None:
    """Run a single statement in its own committed transaction."""
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
