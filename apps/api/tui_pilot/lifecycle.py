"""Lifecycle engine — the durable per-task state machine.

Takes a task through shaping → plan_review → building → pr_review → shipped,
with code-enforced human gates between phases. Mirrors ``pipelines.py``: the
agent ``spawn`` and the ``git`` facade are INJECTED so the whole machine is
unit-testable with a fake agent (no tmux) and a fake/real repo (no GitHub).

Injected contracts:
- ``spawn(run, phase) -> (session_id, account_id)`` — the engine writes the
  latest changes-requested comment onto ``run["resume_comment"]`` (None when not
  resuming) BEFORE calling spawn, so both the real prompt builder and a recording
  test spawn read it from the run dict (no separate report argument).
- ``git`` — a facade exposing ``prepare_workspace`` / ``open_pr`` / ``post_review``
  / ``merge`` / ``commit_reached_branch`` / ``read_at_branch``. Artifact
  re-pointing is an engine-owned DB update (``artifacts.repoint_to_branch``), NOT
  a git-facade method.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from tui_pilot import artifacts, db, gates, project_git, tasks

PHASES = ["shaping", "plan_review", "building", "pr_review", "shipped", "blocked"]
AGENT_PHASES = {"shaping", "building", "pr_review"}   # phases that spawn an agent
GATES = {"plan", "manual_test", "merge"}

_MAX_SELF_HEAL = 3


# -- helpers ------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug or "task"


# -- reads --------------------------------------------------------------------

def get(run_id: str) -> dict | None:
    rows = db.query("SELECT * FROM lifecycle_runs WHERE id = ?", (run_id,))
    return dict(rows[0]) if rows else None


def active_run_for_task(task_id: str) -> dict | None:
    rows = db.query(
        "SELECT * FROM lifecycle_runs WHERE task_id = ? AND active = 1 "
        "ORDER BY created_at DESC, rowid DESC",
        (task_id,),
    )
    return dict(rows[0]) if rows else None


def list_for_project(project_id: str) -> list[dict]:
    rows = db.query(
        "SELECT * FROM lifecycle_runs WHERE project_id = ? "
        "ORDER BY created_at DESC, rowid DESC",
        (project_id,),
    )
    return [dict(r) for r in rows]


# -- writes -------------------------------------------------------------------

def _set_run(run_id: str, **fields) -> None:
    fields["updated_at"] = _now()
    set_clause = ", ".join(f"{c} = ?" for c in fields)
    params = tuple(fields.values()) + (run_id,)
    db.execute(f"UPDATE lifecycle_runs SET {set_clause} WHERE id = ?", params)


def _spawn_phase(run: dict, phase: str, spawn, resume_comment: str | None = None) -> None:
    """Spawn a phase agent, threading resume context via ``run['resume_comment']``.

    The engine sets ``resume_comment`` on the run dict BEFORE calling spawn so the
    prompt builder (and recording test spawns) can read it; then stamps the
    returned session/account onto the run row.
    """
    run["resume_comment"] = resume_comment
    session_id, account_id = spawn(run, phase)
    _set_run(run["id"], agent_session_id=session_id, account_id=account_id)


# -- start --------------------------------------------------------------------

def start_run(project_id: str, task_id: str, *, spawn, git) -> dict:
    """Create a shaping run, prepare its workspace, spawn the shaping agent.

    Raises ValueError if the task already has an active run (one active run per
    task; history is retained).
    """
    if active_run_for_task(task_id) is not None:
        raise ValueError(f"task {task_id} already has an active lifecycle run")
    cfg = project_git.get(project_id) or {}
    task = tasks.get(task_id) or {}
    slug = _slugify(task.get("title", task_id))
    run_id = _new_id()
    ws = git.prepare_workspace(cfg, task_id, slug, kind="feat")
    db.execute(
        "INSERT INTO lifecycle_runs "
        "(id, project_id, task_id, phase, active, branch_name, worktree_path, "
        " self_heal_attempts, created_at, updated_at) "
        "VALUES (?, ?, ?, 'shaping', 1, ?, ?, 0, ?, ?)",
        (run_id, project_id, task_id, ws.get("branch_name"),
         ws.get("worktree_path"), _now(), _now()),
    )
    run = get(run_id)
    _spawn_phase(run, "shaping", spawn)
    tasks.move(task_id, "shaping")
    tasks.add_comment(
        task_id,
        body=f"Lifecycle started — shaping on branch {ws.get('branch_name')}.",
        author="system", kind="system",
    )
    return get(run_id)


# -- blocking -----------------------------------------------------------------

def _block(run: dict, from_phase: str, reason: str, *, note: str | None = None) -> None:
    """Move a run + its task to blocked (board-honest), posting a system note."""
    _set_run(run["id"], phase="blocked", blocked_from_phase=from_phase,
             blocked_reason=reason)
    tasks.add_comment(run["task_id"], body=note or reason, author="system",
                      kind="system")
    tasks.move(run["task_id"], "blocked", force=True)


def _parse_report(run: dict, phase: str, report: str | None):
    """Parse an agent handoff report as JSON. On failure, block the run+task and
    return None (never silently swallow — spec §5)."""
    try:
        return json.loads(report or "")
    except (json.JSONDecodeError, TypeError):
        _block(
            run, phase,
            "agent report was not valid JSON",
            note=f"{phase} agent returned an unparseable report; blocking.\n\n"
                 f"Raw report:\n{report!r}",
        )
        return None


# -- advance ------------------------------------------------------------------

def advance(run_id: str, *, phase: str, report: str | None, spawn, git) -> None:
    """Consume a finished agent's handoff report and drive the state machine.

    ``phase`` is the phase the finished agent was working. Dispatches to the
    per-phase handler. A vanished run is a silent no-op (the poll-loop collector
    already guards this, but be defensive)."""
    run = get(run_id)
    if run is None:
        return
    if phase == "shaping":
        _advance_shaping(run, report, spawn, git)
    elif phase == "building":
        _advance_building(run, report, spawn, git)
    elif phase == "pr_review":
        _advance_pr_review(run, report, spawn, git)


def _advance_shaping(run: dict, report: str | None, spawn, git) -> None:
    data = _parse_report(run, "shaping", report)
    if data is None:
        return
    if data.get("no_changes"):
        _block(run, "shaping", "shaping produced no changes",
               note="Shaping agent reported no changes produced; blocking.")
        return
    tid = run["task_id"]
    branch = run.get("branch_name")
    artifacts.register(tid, run["id"], "spec", "Spec",
                       data.get("spec_path"), branch, by="shaping")
    artifacts.register(tid, run["id"], "plan", "Plan",
                       data.get("plan_path"), branch, by="shaping")
    tasks.add_comment(tid, body=data.get("summary") or "Shaping complete.",
                      author="shaping", kind="progress")
    _set_run(run["id"], phase="plan_review")
    tasks.move(tid, "plan_review")
    gates.open_gate(tid, run["id"], "plan")
    tasks.add_comment(tid, body="Plan ready for review — plan gate opened.",
                      author="system", kind="gate")
