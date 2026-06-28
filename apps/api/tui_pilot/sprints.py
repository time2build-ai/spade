"""Sprints domain module — a project's iteration cadence.

A sprint is a lightweight record (number, day label, state). Per-sprint task
counts (shipped/review/in-progress/queued) are NOT stored; they are derived from
the project's pipeline runs at read time so the figures never drift from reality.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from tui_pilot import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return "spr_" + uuid.uuid4().hex[:12]


def create(project_id: str, number: int, day_label: str | None = None,
           state: str = "active", started_at: str | None = None) -> dict:
    """Insert a sprint and return the created row (with derived counts)."""
    sid = _new_id()
    db.execute(
        "INSERT INTO sprints (id, project_id, number, day_label, state, started_at, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (sid, project_id, number, day_label, state, started_at, _now()),
    )
    return get(sid)


def get(id: str) -> dict | None:
    rows = db.query("SELECT * FROM sprints WHERE id = ?", (id,))
    if not rows:
        return None
    row = dict(rows[0])
    _attach_counts(row)
    return row


def list_for_project(project_id: str) -> list[dict]:
    """All sprints for a project, newest number first, with derived counts."""
    rows = db.query(
        "SELECT * FROM sprints WHERE project_id = ? ORDER BY number DESC, rowid DESC",
        (project_id,),
    )
    out = []
    for r in rows:
        d = dict(r)
        _attach_counts(d)
        out.append(d)
    return out


def current(project_id: str) -> dict | None:
    """The active sprint (highest number with state='active'), or None."""
    rows = db.query(
        "SELECT * FROM sprints WHERE project_id = ? AND state = 'active' "
        "ORDER BY number DESC LIMIT 1",
        (project_id,),
    )
    if not rows:
        return None
    row = dict(rows[0])
    _attach_counts(row)
    return row


# Map a pipeline run's status to one of the four sprint buckets.
_BUCKET = {"shipped": "shipped", "running": "progress", "paused": "review", "queued": "queued"}


def _attach_counts(sprint: dict) -> None:
    """Derive shipped/review/progress/queued + total from the project's REAL
    pipeline runs. (We don't yet bind runs to a specific sprint, so the counts
    reflect the project's current pipeline state — a real signal, noted.)"""
    rows = db.query(
        "SELECT status, COUNT(*) AS c FROM pipeline_runs WHERE project_id = ? GROUP BY status",
        (sprint["project_id"],),
    )
    counts = {"shipped": 0, "review": 0, "progress": 0, "queued": 0}
    for r in rows:
        bucket = _BUCKET.get(r["status"])
        if bucket:
            counts[bucket] += r["c"]
    sprint.update(counts)
    sprint["total"] = sum(counts.values())
