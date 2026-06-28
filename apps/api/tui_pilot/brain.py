"""Brain domain module.

brain_nodes and brain_edges form the product knowledge graph.
Each node belongs to one project and has a type (feature, decision, etc.).
Edges link two nodes with an optional relationship label.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from tui_pilot import db

NODE_TYPES = ["feature", "decision", "convention", "feedback", "bug", "metric"]

_WRITABLE_NODE_COLS = {"type", "label", "detail", "x", "y", "status", "owner"}


# -- helpers ------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict | None:
    return dict(row) if row is not None else None


def _new_id() -> str:
    return str(uuid.uuid4())


# -- nodes --------------------------------------------------------------------

def create_node(
    project_id: str,
    type: str,
    label: str,
    detail: str | None = None,
    x: float | None = None,
    y: float | None = None,
    status: str | None = None,
    owner: str | None = None,
) -> dict:
    """Insert a new brain node and return the created row as a dict."""
    if type not in NODE_TYPES:
        raise ValueError(f"invalid node type {type!r}; must be one of {NODE_TYPES}")
    nid = _new_id()
    with db.tx() as cx:
        cx.execute(
            "INSERT INTO brain_nodes (id, project_id, type, label, detail, x, y, status, owner, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (nid, project_id, type, label, detail, x, y, status, owner, _now()),
        )
    return get_node(nid)


def get_node(id: str) -> dict | None:
    """Return one brain node by id, or None if not found."""
    rows = db.query("SELECT * FROM brain_nodes WHERE id = ?", (id,))
    return _row_to_dict(rows[0]) if rows else None


def list_nodes(project_id: str) -> list[dict]:
    """Return all brain nodes for a project ordered by created_at ascending."""
    rows = db.query(
        "SELECT * FROM brain_nodes WHERE project_id = ? ORDER BY created_at ASC, rowid ASC",
        (project_id,),
    )
    return [dict(r) for r in rows]


def update_node(id: str, **fields) -> None:
    """Update whitelisted columns on a brain node."""
    bad = set(fields) - _WRITABLE_NODE_COLS
    if bad:
        raise ValueError(f"non-writable columns: {sorted(bad)}")
    if not fields:
        return
    if "type" in fields and fields["type"] not in NODE_TYPES:
        raise ValueError(f"invalid node type {fields['type']!r}; must be one of {NODE_TYPES}")
    set_clause = ", ".join(f"{col} = ?" for col in fields)
    params = tuple(fields.values()) + (id,)
    with db.tx() as cx:
        cx.execute(f"UPDATE brain_nodes SET {set_clause} WHERE id = ?", params)


def delete_node(id: str) -> None:
    """Delete a brain node (FK CASCADE removes its brain_edges rows)."""
    db.execute("DELETE FROM brain_nodes WHERE id = ?", (id,))


# -- edges --------------------------------------------------------------------

def get_edge(id: str) -> dict | None:
    """Return one brain edge by id, or None if not found."""
    rows = db.query("SELECT * FROM brain_edges WHERE id = ?", (id,))
    return _row_to_dict(rows[0]) if rows else None


def add_edge(
    project_id: str,
    from_id: str,
    to_id: str,
    rel: str | None = None,
) -> dict:
    """Insert a new brain edge and return the created row as a dict.

    Raises ValueError if either endpoint node does not exist, so the server
    layer surfaces a clean 400 instead of a FK IntegrityError → 500.
    """
    for nid, name in ((from_id, "from_id"), (to_id, "to_id")):
        if get_node(nid) is None:
            raise ValueError(f"brain node {nid!r} not found ({name})")
    eid = _new_id()
    with db.tx() as cx:
        cx.execute(
            "INSERT INTO brain_edges (id, project_id, from_id, to_id, rel) "
            "VALUES (?, ?, ?, ?, ?)",
            (eid, project_id, from_id, to_id, rel),
        )
    return get_edge(eid)


def list_edges(project_id: str) -> list[dict]:
    """Return all brain edges for a project."""
    rows = db.query(
        "SELECT * FROM brain_edges WHERE project_id = ? ORDER BY rowid ASC",
        (project_id,),
    )
    return [dict(r) for r in rows]


def delete_edge(id: str) -> None:
    """Delete a brain edge by id."""
    db.execute("DELETE FROM brain_edges WHERE id = ?", (id,))
