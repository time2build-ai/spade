"""Pipelines domain module — the 4-stage agent execution state machine.

A pipeline run takes one task through four ordered stages
(developer → reviewer → integrator → documentor). Each stage spawns a real
`claude` worker, but the spawn is INJECTED as a callable so this module stays
testable without the server / tmux. The injected ``spawn`` has the signature
``spawn(stage_idx, report) -> (session_id, account_id)`` where ``report`` is the
prior stage's handoff report (None for stage 0).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from tui_pilot import db, tasks

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


def start_stage(run_id: str, idx: int, spawn, report: str | None = None) -> None:
    """Spawn stage ``idx`` and mark it running.

    ``spawn(idx, report)`` must return ``(session_id, account_id)``. On any
    exception the stage is marked 'failed' and the run 'paused' (swallowed —
    the caller is not interrupted).
    """
    try:
        session_id, account_id = spawn(idx, report)
    except Exception:  # noqa: BLE001 - a spawn failure pauses, never crashes
        _set_stage(run_id, idx, state="failed")
        _set_run(run_id, status="paused")
        return
    _set_stage(run_id, idx, state="running", session_id=session_id, account_id=account_id)
    _set_run(run_id, status="running", current_stage=idx)
    # Reflect execution on the board the moment an agent starts working the stage:
    # the Developer stage moves the task to in_progress; later stages to review.
    # (The final ship is handled in complete_stage.)
    run = get(run_id)
    if run is not None:
        target = "in_progress" if idx == 0 else "review"
        task = tasks.get(run["task_id"])
        if task is not None and task.get("status") != "shipped":
            tasks.move(run["task_id"], target)


def complete_stage(run_id: str, idx: int, report: str | None, spawn) -> None:
    """Mark stage ``idx`` done, then start the next stage (threading ``report``)
    or ship the run if this was the last stage.

    Re-entry-safe: if stage ``idx`` is already terminal (``done``/``failed``)
    this is an idempotent no-op, so a manual ``/advance`` racing the poll loop's
    auto-advance for the same finished worker cannot double-spawn the next stage.
    """
    rows = db.query(
        "SELECT state FROM pipeline_stages "
        "WHERE pipeline_run_id = ? AND stage_order = ?",
        (run_id, idx),
    )
    if rows and rows[0]["state"] in ("done", "failed"):
        return
    _set_stage(run_id, idx, state="done")
    run = get(run_id)
    # Record what this stage delivered onto the task's activity trail. The
    # report is the agent's `finished` handoff; persisting it here means the
    # ticket keeps a durable history even after the ephemeral agents are gone.
    # Guarded by the idempotency check above, so a racing re-entry won't
    # double-post.
    if run is not None and report:
        tasks.add_comment(
            run["task_id"], body=report, author=STAGES[idx], kind="stage_report"
        )
    if idx < len(STAGES) - 1:
        # Thread the finishing stage's report into the next stage's spawn.
        start_stage(run_id, idx + 1, spawn, report=report)
    else:
        _set_run(run_id, status="shipped", current_stage=idx)
        if run is not None:
            tasks.move(run["task_id"], "shipped")
            tasks.add_comment(
                run["task_id"],
                body="Pipeline complete — all 4 stages done; task moved to shipped.",
                author="system",
                kind="system",
            )
