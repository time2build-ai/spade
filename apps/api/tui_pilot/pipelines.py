"""Pipelines domain module — the legacy 4-stage run model (READ-ONLY).

A pipeline run records one task's four ordered stages
(developer → reviewer → integrator → documentor). The WRITE state machine
(stage spawning + board moves + auto-advance) was retired in Chunk 6 in favor of
the lifecycle engine, so only ``create_run`` plus the read helpers
(``get`` / ``list_for_project`` / ``stage_by_session`` / ``_attach_progress``)
remain — they back the read-only ``GET /pipelines`` endpoints for one release of
client coexistence. The tables are slated for removal next release (schema.sql).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from tui_pilot import db

STAGES = ["developer", "reviewer", "integrator", "documentor"]


# -- helpers ------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


# -- creation -----------------------------------------------------------------

def create_run(project_id: str, task_id: str) -> dict:
    """Create a pipeline run plus its 4 queued stages; return the full run."""
    run_id = _new_id()
    with db.tx() as cx:
        cx.execute(
            "INSERT INTO pipeline_runs "
            "(id, project_id, task_id, status, current_stage, created_at) "
            "VALUES (?, ?, ?, 'queued', 0, ?)",
            (run_id, project_id, task_id, _now()),
        )
        for i, role in enumerate(STAGES):
            cx.execute(
                "INSERT INTO pipeline_stages "
                "(id, pipeline_run_id, role, stage_order, state, created_at) "
                "VALUES (?, ?, ?, ?, 'queued', ?)",
                (_new_id(), run_id, role, i, _now()),
            )
    return get(run_id)


# -- reads --------------------------------------------------------------------

def get(run_id: str) -> dict | None:
    """Return one run with its stages (ordered by stage_order), or None."""
    rows = db.query("SELECT * FROM pipeline_runs WHERE id = ?", (run_id,))
    if not rows:
        return None
    run = dict(rows[0])
    stage_rows = db.query(
        "SELECT * FROM pipeline_stages WHERE pipeline_run_id = ? ORDER BY stage_order ASC",
        (run_id,),
    )
    run["stages"] = [dict(r) for r in stage_rows]
    _attach_progress(run)
    return run


def _attach_progress(run: dict) -> None:
    """Derive real run progress from stage states (no extra storage).

    progress is an integer 0..100: a shipped run is 100; otherwise it's the
    share of done stages, plus a half-step credit for the one currently running
    (so a run mid-stage-2 of 4 reads ~38%, not 25%). cost/eta/tokens/files are
    NOT tracked by the pipeline model — those remain client-seeded.
    """
    stages = run.get("stages") or []
    total = len(stages) or len(STAGES)
    done = sum(1 for s in stages if s.get("state") == "done")
    running = sum(1 for s in stages if s.get("state") == "running")
    run["stages_total"] = total
    run["stages_done"] = done
    if run.get("status") == "shipped":
        run["progress"] = 100
    else:
        run["progress"] = round((done + 0.5 * running) / total * 100) if total else 0


def stage_by_session(session_id: str) -> dict | None:
    """Return ``{pipeline_run_id, stage_order}`` for the stage whose
    ``session_id`` matches, or None. Used to restore in-memory pipeline linkage
    on reconnect from already-persisted data."""
    rows = db.query(
        "SELECT pipeline_run_id, stage_order FROM pipeline_stages "
        "WHERE session_id = ?",
        (session_id,),
    )
    if not rows:
        return None
    r = rows[0]
    return {
        "pipeline_run_id": r["pipeline_run_id"],
        "stage_order": r["stage_order"],
    }


def list_for_project(project_id: str) -> list[dict]:
    """Return all runs (with stages) for a project, newest first."""
    rows = db.query(
        "SELECT id FROM pipeline_runs WHERE project_id = ? "
        "ORDER BY created_at DESC, rowid DESC",
        (project_id,),
    )
    return [get(r["id"]) for r in rows]


# -- state machine ------------------------------------------------------------

def _set_stage(run_id: str, idx: int, **fields) -> None:
    set_clause = ", ".join(f"{c} = ?" for c in fields)
    params = tuple(fields.values()) + (run_id, idx)
    db.execute(
        f"UPDATE pipeline_stages SET {set_clause} "
        "WHERE pipeline_run_id = ? AND stage_order = ?",
        params,
    )


def _set_run(run_id: str, **fields) -> None:
    set_clause = ", ".join(f"{c} = ?" for c in fields)
    params = tuple(fields.values()) + (run_id,)
    db.execute(f"UPDATE pipeline_runs SET {set_clause} WHERE id = ?", params)


# NOTE: The pipeline WRITE state machine (start_stage/complete_stage — stage
# spawning, board moves, auto-advance) was retired in Chunk 6 in favor of the
# lifecycle engine. Those functions were removed (they moved tasks to the
# now-dropped 'in_progress'/'review' statuses). This module remains for the
# read-only GET /pipelines endpoints (create_run + the reads above); the tables
# are slated for removal next release (see schema.sql).
