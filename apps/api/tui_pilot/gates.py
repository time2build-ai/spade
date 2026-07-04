"""Gates domain module — durable human approval gates on a lifecycle run.

A gate is a code-enforced human checkpoint (``plan`` / ``manual_test`` /
``merge``). Unlike the pipeline's in-memory brakes, gates survive restart: they
live in the ``gates`` table. The lifecycle engine opens a gate when it needs a
human decision and consumes ``decide`` when the human acts.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from tui_pilot import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict | None:
    return dict(row) if row is not None else None


def open_gate(task_id: str, run_id: str, gate: str) -> dict:
    """Create a ``waiting`` gate for ``run_id`` and return the row."""
    gid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO gates (id, task_id, run_id, gate, status, created_at) "
        "VALUES (?, ?, ?, ?, 'waiting', ?)",
        (gid, task_id, run_id, gate, _now()),
    )
    return get(gid)


def get(gate_id: str) -> dict | None:
    rows = db.query("SELECT * FROM gates WHERE id = ?", (gate_id,))
    return _row_to_dict(rows[0]) if rows else None


def decide(gate_id: str, status: str, comment: str | None = None,
           by: str | None = None) -> dict:
    """Record a human decision (``approved`` / ``changes_requested``) on a gate."""
    db.execute(
        "UPDATE gates SET status = ?, comment = ?, decided_by = ?, decided_at = ? "
        "WHERE id = ?",
        (status, comment, by, _now(), gate_id),
    )
    return get(gate_id)


def try_decide(gate_id: str, status: str, comment: str | None = None,
               by: str | None = None) -> bool:
    """CONDITIONAL decide: record the decision ONLY if the gate is still
    ``waiting``. Returns True iff THIS call won the row (rowcount == 1); a racing
    second decision gets False and must run no side-effects. This is the gate
    analogue of the fan-out per-row CAS, letting ``decide_gate`` deliver exactly
    once even when two approvals both pass the read-then-act guard."""
    with db.tx() as cx:
        cur = cx.execute(
            "UPDATE gates SET status = ?, comment = ?, decided_by = ?, decided_at = ? "
            "WHERE id = ? AND status = 'waiting'",
            (status, comment, by, _now(), gate_id),
        )
        return cur.rowcount == 1


def reopen(gate_id: str) -> None:
    """Revert a gate to ``waiting`` (clearing the recorded decision). Used when an
    approved gate's irreversible side-effect fails: the run is blocked and the gate
    must stay re-decidable after a retry, exactly as before the CAS-claim."""
    db.execute(
        "UPDATE gates SET status = 'waiting', comment = NULL, decided_by = NULL, "
        "decided_at = NULL WHERE id = ?",
        (gate_id,),
    )


def gate_for(run_id: str, gate: str) -> dict | None:
    """Return the most recent gate of a kind for a run, or None."""
    rows = db.query(
        "SELECT * FROM gates WHERE run_id = ? AND gate = ? "
        "ORDER BY created_at DESC, rowid DESC",
        (run_id, gate),
    )
    return _row_to_dict(rows[0]) if rows else None


def waiting_for_project(project_id: str) -> list[dict]:
    """Return all ``waiting`` gates in a project, joined to their task title."""
    rows = db.query(
        "SELECT g.*, t.title AS task_title, r.phase AS phase "
        "FROM gates g "
        "JOIN lifecycle_runs r ON g.run_id = r.id "
        "JOIN tasks t ON g.task_id = t.id "
        "WHERE r.project_id = ? AND g.status = 'waiting' "
        "ORDER BY g.created_at ASC, g.rowid ASC",
        (project_id,),
    )
    return [dict(r) for r in rows]
