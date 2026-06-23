"""Sessions persistence store: thin db-helper wrapper over the `sessions` table.

Records a row per spawned agent so the fleet can be reconciled (reattached) on
restart. Writes go through db.execute/db.tx only — never a raw connection.
"""
from __future__ import annotations

from tui_pilot import db

# Columns insert() accepts (mirrors schema.sql `sessions`).
_COLS = (
    "id", "project_id", "account_id", "name", "role", "model", "mode", "cwd",
    "mission_id", "parent", "reason", "status", "is_orchestrator",
    "sort_order", "created_at",
)


def insert(**cols) -> None:
    """Insert (or replace) a session row. Unknown columns are rejected."""
    bad = set(cols) - set(_COLS)
    if bad:
        raise ValueError(f"unknown session columns: {sorted(bad)}")
    names = list(cols)
    placeholders = ", ".join("?" for _ in names)
    sql = (
        f"INSERT OR REPLACE INTO sessions ({', '.join(names)}) "
        f"VALUES ({placeholders})"
    )
    db.execute(sql, tuple(cols[n] for n in names))


def set_status(id: str, status: str) -> None:
    db.execute("UPDATE sessions SET status = ? WHERE id = ?", (status, id))


def all() -> list[dict]:
    return [dict(r) for r in db.query("SELECT * FROM sessions ORDER BY sort_order ASC, rowid ASC")]


def all_live() -> list[dict]:
    return [
        dict(r)
        for r in db.query(
            "SELECT * FROM sessions WHERE status = 'live' ORDER BY sort_order ASC, rowid ASC"
        )
    ]


def get(id: str) -> dict | None:
    rows = db.query("SELECT * FROM sessions WHERE id = ?", (id,))
    return dict(rows[0]) if rows else None
