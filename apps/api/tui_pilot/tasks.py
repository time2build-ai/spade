"""Tasks domain module.

A "task" (SPD-NNN) is the core backlog unit. Each task belongs to one project.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from tui_pilot import db

# Lifecycle statuses first, then the two LEGACY values the live pipeline still
# writes (in_progress/review). Legacy values are dropped in Chunk 6 once the
# pipeline is retired; keeping them here means pipeline board moves stay valid.
STATUSES = ["ready", "shaping", "plan_review", "building", "pr_review",
            "shipped", "blocked", "in_progress", "review"]

# Legal forward transitions of the lifecycle state machine. "any -> blocked" and
# "blocked -> <resume>" are handled specially (see move). Board reads tasks.status;
# the lifecycle engine is the sole writer during a lifecycle run. Legacy statuses
# are intentionally absent — the pipeline moves them with force=True.
TRANSITIONS = {
    "ready": {"shaping"},
    "shaping": {"plan_review", "blocked"},
    "plan_review": {"building", "shaping", "blocked"},
    "building": {"pr_review", "building", "blocked"},
    "pr_review": {"shipped", "pr_review", "blocked"},
    "shipped": set(),
    "blocked": set(STATUSES),  # a blocked task may resume into any phase
}

# Task→task link relationships. "blocks"/"subtask" are directional (from→to),
# "related" is symmetric. See add_link / links for semantics.
LINK_RELS = ["blocks", "related", "subtask"]

_WRITABLE_COLS = {"title", "feature", "priority", "description", "origin_quote", "origin_source"}


# -- helpers ------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict | None:
    return dict(row) if row is not None else None


# -- ID generation ------------------------------------------------------------

def _next_task_id(cx) -> str:
    """Return the next globally-sequential SPD-NNN id, using the OPEN connection/cursor.

    Ids are globally sequential across the whole workspace (not per-project), so
    `tasks.id` stays a global PRIMARY KEY. Must be called from inside an existing
    db.tx() block so id allocation and the subsequent INSERT stay atomic in one
    transaction (avoids a count/insert race).

    Derives the next number from the MAX existing SPD-NNN suffix (not COUNT),
    so deletions that leave gaps can't produce an id that collides with a
    still-existing higher-numbered task.
    """
    rows = cx.execute("SELECT id FROM tasks WHERE id LIKE 'SPD-%'").fetchall()
    mx = 0
    for r in rows:
        try:
            mx = max(mx, int(str(r["id"]).split("-", 1)[1]))
        except (ValueError, IndexError):
            continue
    return f"SPD-{mx + 1:03d}"


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
        tid = _next_task_id(cx)
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

def move(id: str, status: str, force: bool = False) -> None:
    """Move a task to a new status, enforcing the transition table.

    Any status may go to 'blocked'. 'blocked' may resume into any status. Other
    jumps must appear in TRANSITIONS[current]. force=True bypasses the guard
    (admin override + legacy pipeline moves); callers should log a system note
    when forcing an admin override.
    """
    if status not in STATUSES:
        raise ValueError(f"invalid status {status!r}; must be one of {STATUSES}")
    cur = get(id)
    current = cur["status"] if cur else "ready"
    legal = status == "blocked" or status in TRANSITIONS.get(current, set())
    if not force and not legal:
        raise ValueError(f"illegal transition {current!r} -> {status!r}")
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


# -- Links (task dependencies) ------------------------------------------------

def add_link(from_task: str, to_task: str, rel: str) -> dict:
    """Create a task→task link and return the created row.

    ``rel`` must be one of ``LINK_RELS``. Self-links are rejected. The caller is
    responsible for 404ing on missing tasks (the FK CASCADE protects integrity).
    """
    if rel not in LINK_RELS:
        raise ValueError(f"invalid rel {rel!r}; must be one of {LINK_RELS}")
    if from_task == to_task:
        raise ValueError("a task cannot link to itself")
    lid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO task_links (id, from_task, to_task, rel, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (lid, from_task, to_task, rel, _now()),
    )
    return link_get(lid)


def link_get(link_id: str) -> dict | None:
    """Return one link by id, or None if not found."""
    rows = db.query("SELECT * FROM task_links WHERE id = ?", (link_id,))
    return _row_to_dict(rows[0]) if rows else None


def remove_link(link_id: str) -> None:
    """Delete a link by id."""
    db.execute("DELETE FROM task_links WHERE id = ?", (link_id,))


def links(task_id: str) -> list[dict]:
    """Return all links where this task is the from_task OR the to_task."""
    rows = db.query(
        "SELECT * FROM task_links WHERE from_task = ? OR to_task = ? "
        "ORDER BY created_at ASC, rowid ASC",
        (task_id, task_id),
    )
    return [dict(r) for r in rows]


# -- Comments (activity trail) ------------------------------------------------

def add_comment(
    task_id: str,
    body: str,
    author: str | None = None,
    kind: str = "note",
) -> dict:
    """Append a comment to a task's activity trail and return the created row.

    ``kind`` is free-form but conventionally one of ``note`` (a manual note),
    ``stage_report`` (an agent's finished handoff report) or ``system`` (an
    automatic event like "pipeline started" / "shipped").
    """
    cid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO task_comments (id, task_id, author, kind, body, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (cid, task_id, author, kind, body, _now()),
    )
    rows = db.query("SELECT * FROM task_comments WHERE id = ?", (cid,))
    return dict(rows[0])


def comments(task_id: str) -> list[dict]:
    """Return a task's comments, oldest first."""
    rows = db.query(
        "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC, rowid ASC",
        (task_id,),
    )
    return [dict(r) for r in rows]
