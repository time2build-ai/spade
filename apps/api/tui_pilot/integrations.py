"""Integrations domain module — a project's connected external services.

Each integration row stores name, category, status, a usage blurb and a
connected flag. The connect toggle in the UI persists via set_connected().
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from tui_pilot import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return "int_" + uuid.uuid4().hex[:12]


def create(project_id: str, name: str, category: str | None = None,
           status: str = "off", usage: str | None = None,
           connected: bool = False) -> dict:
    iid = _new_id()
    db.execute(
        "INSERT INTO integrations (id, project_id, name, category, status, usage, connected, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (iid, project_id, name, category, status, usage, 1 if connected else 0, _now()),
    )
    return get(iid)


def get(id: str) -> dict | None:
    rows = db.query("SELECT * FROM integrations WHERE id = ?", (id,))
    return dict(rows[0]) if rows else None


def list_for_project(project_id: str) -> list[dict]:
    """All integrations for a project, ordered by category then name."""
    rows = db.query(
        "SELECT * FROM integrations WHERE project_id = ? ORDER BY category ASC, name ASC, rowid ASC",
        (project_id,),
    )
    return [dict(r) for r in rows]


def set_connected(id: str, connected: bool) -> dict | None:
    """Toggle the connected flag (and reflect it in status). Returns the row."""
    db.execute(
        "UPDATE integrations SET connected = ?, status = ? WHERE id = ?",
        (1 if connected else 0, "connected" if connected else "off", id),
    )
    return get(id)
