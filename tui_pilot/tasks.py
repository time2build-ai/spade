"""Tasks domain module.

A "task" (SPD-NNN) is the core backlog unit. Each task belongs to one project.
"""

from __future__ import annotations

from datetime import datetime, timezone

from tui_pilot import db

STATUSES = ["ready", "in_progress", "review", "shipped", "blocked"]

_WRITABLE_COLS = {"title", "feature", "priority", "description", "origin_quote", "origin_source"}


# -- helpers ------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict | None:
    return dict(row) if row is not None else None


# -- ID generation ------------------------------------------------------------

def next_task_id(project_id: str) -> str:
    """Return the next SPD-NNN id for the project (inside an outer tx)."""
    with db.tx() as cx:
        row = cx.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE project_id = ?", (project_id,)
        ).fetchone()
        n = (row["cnt"] if row else 0) + 1
        return f"SPD-{n:03d}"


# -- CRUD ---------------------------------------------------------------------

def create(
    project_id: str,
    title: str,
    feature: str | None = None,
    priority: int = 2,
    description: str | None = None,
    origin_quote: str | None = None,
    origin_source: str | None = None,
) -> dict:
    """Insert a new task and return the created row as a dict."""
    with db.tx() as cx:
        row = cx.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE project_id = ?", (project_id,)
        ).fetchone()
        n = (row["cnt"] if row else 0) + 1
        tid = f"SPD-{n:03d}"
        cx.execute(
            "INSERT INTO tasks "
            "(id, project_id, title, feature, priority, status, "
            " origin_quote, origin_source, description, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)",
            (tid, project_id, title, feature, priority,
             origin_quote, origin_source, description, _now()),
        )
    return get(tid)


def get(id: str) -> dict | None:
    """Return one task by id, or None if not found."""
    rows = db.query("SELECT * FROM tasks WHERE id = ?", (id,))
    return _row_to_dict(rows[0]) if rows else None


def list_for_project(project_id: str) -> list[dict]:
    """Return all tasks for a project ordered by created_at ascending."""
    rows = db.query(
        "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC, rowid ASC",
        (project_id,),
    )
    return [dict(r) for r in rows]


def update(id: str, **fields) -> None:
    """Update whitelisted columns on a task."""
    bad = set(fields) - _WRITABLE_COLS
    if bad:
        raise ValueError(f"non-writable columns: {sorted(bad)}")
    if not fields:
        return
    set_clause = ", ".join(f"{col} = ?" for col in fields)
    params = tuple(fields.values()) + (id,)
    with db.tx() as cx:
        cx.execute(f"UPDATE tasks SET {set_clause} WHERE id = ?", params)


def delete(id: str) -> None:
    """Delete a task (FK CASCADE removes its task_nodes rows)."""
    db.execute("DELETE FROM tasks WHERE id = ?", (id,))


# -- Status management --------------------------------------------------------

def move(id: str, status: str) -> None:
    """Move a task to a new status. Raises ValueError if status not in STATUSES."""
    if status not in STATUSES:
        raise ValueError(f"invalid status {status!r}; must be one of {STATUSES}")
    with db.tx() as cx:
        cx.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, id))


# -- Grounding (task_nodes) ---------------------------------------------------

def set_nodes(task_id: str, node_ids: list[str]) -> None:
    """Replace all grounded node_ids for a task atomically."""
    with db.tx() as cx:
        cx.execute("DELETE FROM task_nodes WHERE task_id = ?", (task_id,))
        for nid in node_ids:
            cx.execute(
                "INSERT INTO task_nodes (task_id, node_id) VALUES (?, ?)",
                (task_id, nid),
            )


def nodes(task_id: str) -> list[str]:
    """Return the list of node_ids grounded to this task."""
    rows = db.query(
        "SELECT node_id FROM task_nodes WHERE task_id = ? ORDER BY rowid ASC",
        (task_id,),
    )
    return [r["node_id"] for r in rows]
