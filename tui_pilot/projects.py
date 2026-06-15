"""Projects domain module.

A "project" maps a local filesystem path to an ordered pool of accounts and a
scheduling strategy (single | round_robin).
"""

from __future__ import annotations

from datetime import datetime, timezone

from tui_pilot import db

# Columns that callers are allowed to UPDATE via update().
_WRITABLE_COLS = {"name", "path", "account_strategy", "model_ceiling", "autopilot"}


# -- helpers ------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict | None:
    return dict(row) if row is not None else None


# -- CRUD ---------------------------------------------------------------------

def create(
    id: str,
    name: str,
    path: str,
    account_strategy: str = "single",
    model_ceiling: str | None = None,
    autopilot: int = 0,
) -> dict:
    """Insert a new project and return it as a dict."""
    db.execute(
        "INSERT INTO projects (id, name, path, account_strategy, model_ceiling, autopilot, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (id, name, path, account_strategy, model_ceiling, autopilot, _now()),
    )
    return get(id)


def get(id: str) -> dict | None:
    """Return one project by id, or None if not found."""
    rows = db.query("SELECT * FROM projects WHERE id = ?", (id,))
    return _row_to_dict(rows[0]) if rows else None


def list_all() -> list[dict]:
    """Return all projects ordered by created_at / rowid ascending."""
    rows = db.query("SELECT * FROM projects ORDER BY created_at ASC, rowid ASC")
    return [dict(r) for r in rows]


def update(id: str, **fields) -> None:
    """Update whitelisted columns on a project in a single atomic statement."""
    bad = set(fields) - _WRITABLE_COLS
    if bad:
        raise ValueError(f"non-writable columns: {sorted(bad)}")
    if not fields:
        return
    set_clause = ", ".join(f"{col} = ?" for col in fields)
    params = tuple(fields.values()) + (id,)
    with db.tx() as cx:
        cx.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", params)


def delete(id: str) -> None:
    """Delete a project (FK CASCADE removes its project_accounts rows)."""
    db.execute("DELETE FROM projects WHERE id = ?", (id,))


# -- Pool management ----------------------------------------------------------

def set_pool(project_id: str, account_ids: list[str]) -> None:
    """Replace the ordered account pool for a project atomically."""
    with db.tx() as cx:
        cx.execute(
            "DELETE FROM project_accounts WHERE project_id = ?", (project_id,)
        )
        for position, account_id in enumerate(account_ids):
            cx.execute(
                "INSERT INTO project_accounts (project_id, account_id, position) "
                "VALUES (?, ?, ?)",
                (project_id, account_id, position),
            )


def pool(project_id: str) -> list[str]:
    """Return account_ids for the project ordered by position ascending."""
    rows = db.query(
        "SELECT account_id FROM project_accounts WHERE project_id = ? ORDER BY position ASC",
        (project_id,),
    )
    return [r["account_id"] for r in rows]


# -- Round-robin scheduling ---------------------------------------------------

def next_account(project_id: str) -> str | None:
    """Return the next account for the project, advancing the cursor atomically.

    The ENTIRE read-modify-write runs inside a single db.tx() block so the
    cursor read and increment are atomic against concurrent callers. This
    deliberately replaces the spec's "registry lock" suggestion: resolving
    the account BEFORE the tmux spawn means the atomic DB increment is an
    equivalent-or-stronger guard — two concurrent spawns are guaranteed to
    receive distinct accounts without any additional in-process locking.
    Do NOT "fix" this to use a registry lock.

    Note: `account_strategy` is not read here. A `single`-strategy project
    relies on its pool having exactly one entry (the pool-editing layer
    enforces that); the cycling logic is identical either way.
    """
    with db.tx() as cx:
        # Fetch pool, filtering out accounts that no longer exist.
        rows = cx.execute(
            "SELECT pa.account_id FROM project_accounts pa "
            "JOIN accounts a ON a.id = pa.account_id "
            "WHERE pa.project_id = ? ORDER BY pa.position ASC",
            (project_id,),
        ).fetchall()
        account_pool = [r["account_id"] for r in rows]

        if not account_pool:
            return None

        cursor_row = cx.execute(
            "SELECT rr_cursor FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        cursor = cursor_row["rr_cursor"] if cursor_row else 0

        chosen = account_pool[cursor % len(account_pool)]
        cx.execute(
            "UPDATE projects SET rr_cursor = ? WHERE id = ?",
            (cursor + 1, project_id),
        )

    return chosen


# -- App state ----------------------------------------------------------------

def current_project_id() -> str | None:
    """Return the current project id from app_state, or None."""
    rows = db.query("SELECT current_project_id FROM app_state WHERE id = 1")
    if not rows:
        return None
    return rows[0]["current_project_id"]


def set_current_project(pid: str) -> None:
    """Set the current project in app_state."""
    db.execute(
        "UPDATE app_state SET current_project_id = ? WHERE id = 1", (pid,)
    )
