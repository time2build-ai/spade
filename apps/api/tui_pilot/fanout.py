"""Fan-out agents domain module — the parallel workers of a fan-out phase.

A fan-out phase runs N agents in parallel (one per *angle*) and advances on an
all-done barrier: the phase is complete once no row is still ``queued``,
``running`` or ``blocked``. A ``dropped`` row counts as resolved (a human gave
up on that angle); a ``done`` row carries its finding artifact.

Every state-changing helper is a CONDITIONAL update guarded on the source
status, so per-row resolution is atomic: a late ``mark_done`` for an already
``dropped`` row is a no-op (returns False), and vice-versa. This is what lets the
engine's compare-and-swap barrier (``lifecycle.advance_fanout``) stay correct
under concurrent drop / finish / death resolvers.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from tui_pilot import db

# A row is unresolved (holds the barrier) while in one of these statuses.
_UNRESOLVED = ("queued", "running", "blocked")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict | None:
    return dict(row) if row is not None else None


def create_rows(run_id: str, phase: str, angles: list) -> list[dict]:
    """Insert N ``queued`` rows (one per angle) for ``(run_id, phase)``.

    Each angle may be a plain string or a dict; a dict's ``mode`` (if any) is
    stored on its own column and the whole angle is JSON-serialized into
    ``angle`` so the per-idx prompt builder can read it back.
    """
    with db.tx() as cx:
        for idx, angle in enumerate(angles):
            if isinstance(angle, dict):
                angle_text = json.dumps(angle)
                mode = angle.get("mode")
            else:
                angle_text = str(angle)
                mode = None
            cx.execute(
                "INSERT INTO fanout_agents "
                "(id, run_id, phase, idx, angle, mode, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
                (str(uuid.uuid4()), run_id, phase, idx, angle_text, mode,
                 _now(), _now()),
            )
    return rows_for(run_id, phase)


def rows_for(run_id: str, phase: str) -> list[dict]:
    """All rows for ``(run_id, phase)``, ordered by idx."""
    rows = db.query(
        "SELECT * FROM fanout_agents WHERE run_id = ? AND phase = ? ORDER BY idx ASC",
        (run_id, phase),
    )
    return [dict(r) for r in rows]


def get_row(run_id: str, phase: str, idx: int) -> dict | None:
    rows = db.query(
        "SELECT * FROM fanout_agents WHERE run_id = ? AND phase = ? AND idx = ?",
        (run_id, phase, idx),
    )
    return _row_to_dict(rows[0]) if rows else None


def row_by_session(session_id: str) -> dict | None:
    """The still-``running`` fan-out row whose ``session_id`` matches (or None).

    Makes ``session_id`` a read column — the fan-out analogue of
    ``lifecycle.run_by_session``. On server restart the reconcile step uses this to
    re-stamp a reattached investigator agent's ``_meta`` (fan-out run_id/idx/phase),
    since a fan-out session id lives ONLY here and never in
    ``lifecycle_runs.agent_session_id``. Without it a finding that completes during
    downtime is invisible to both the fan-out collector and the death detector."""
    rows = db.query(
        "SELECT * FROM fanout_agents WHERE session_id = ? AND status = 'running' "
        "ORDER BY updated_at DESC, rowid DESC",
        (session_id,),
    )
    return _row_to_dict(rows[0]) if rows else None


def pending(run_id: str, phase: str) -> list[dict]:
    """Unresolved rows (queued/running/blocked) — those still holding the barrier."""
    rows = db.query(
        "SELECT * FROM fanout_agents "
        "WHERE run_id = ? AND phase = ? AND status IN ('queued','running','blocked') "
        "ORDER BY idx ASC",
        (run_id, phase),
    )
    return [dict(r) for r in rows]


def all_done(run_id: str, phase: str) -> bool:
    """True iff at least one row exists AND none is still unresolved.

    ``dropped`` counts as resolved. Returns False when no rows exist so a phase
    that never entered fan-out is never mistaken for a released barrier.
    """
    rows = db.query(
        "SELECT status FROM fanout_agents WHERE run_id = ? AND phase = ?",
        (run_id, phase),
    )
    if not rows:
        return False
    return all(r["status"] not in _UNRESOLVED for r in rows)


def mark_running(run_id: str, phase: str, idx: int,
                 session_id: str | None, account_id: str | None) -> None:
    """Stamp a row's spawned session/account and move it to ``running``."""
    db.execute(
        "UPDATE fanout_agents SET status = 'running', session_id = ?, "
        "account_id = ?, updated_at = ? WHERE run_id = ? AND phase = ? AND idx = ?",
        (session_id, account_id, _now(), run_id, phase, idx),
    )


def _resolve(run_id: str, phase: str, idx: int, status: str,
             report_artifact_id: str | None = None) -> bool:
    """Conditionally transition an UNRESOLVED row to ``status``; return True iff
    this call is the one that resolved it (rowcount == 1). Idempotent: a row
    already done/dropped yields False, so a racing second resolver no-ops."""
    with db.tx() as cx:
        cur = cx.execute(
            "UPDATE fanout_agents SET status = ?, report_artifact_id = "
            "COALESCE(?, report_artifact_id), updated_at = ? "
            "WHERE run_id = ? AND phase = ? AND idx = ? "
            "AND status IN ('queued','running','blocked')",
            (status, report_artifact_id, _now(), run_id, phase, idx),
        )
        return cur.rowcount == 1


def mark_done(run_id: str, phase: str, idx: int,
              report_artifact_id: str | None = None) -> bool:
    """Resolve a row as ``done`` (attaching its finding artifact). Conditional on
    the row still being unresolved — returns False for an already-resolved row."""
    return _resolve(run_id, phase, idx, "done", report_artifact_id)


def set_report(run_id: str, phase: str, idx: int, report_artifact_id: str) -> None:
    """Attach a finding artifact id to a row (unconditional — used after a claim)."""
    db.execute(
        "UPDATE fanout_agents SET report_artifact_id = ?, updated_at = ? "
        "WHERE run_id = ? AND phase = ? AND idx = ?",
        (report_artifact_id, _now(), run_id, phase, idx),
    )


def block(run_id: str, phase: str, idx: int) -> bool:
    """Resolve an agent's death: move an unresolved row to ``blocked`` (holds the
    barrier until a retry/drop). Returns False for an already-resolved row."""
    return _resolve(run_id, phase, idx, "blocked")


def drop(run_id: str, phase: str, idx: int) -> bool:
    """Mark an unresolved row ``dropped`` (a human gave up). Returns False for an
    already ``done``/``dropped`` row (so a drop never overrides a finish)."""
    return _resolve(run_id, phase, idx, "dropped")
