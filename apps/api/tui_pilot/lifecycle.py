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


def run_by_session(session_id: str) -> dict | None:
    """The active run whose current phase agent is ``session_id`` (or None).

    Makes ``agent_session_id`` a read column: on server restart the reconcile
    step uses this to re-stamp a reattached lifecycle agent's ``_meta`` so its
    finished report still drives auto-advance (closing the durability gap)."""
    rows = db.query(
        "SELECT * FROM lifecycle_runs WHERE agent_session_id = ? AND active = 1 "
        "ORDER BY updated_at DESC, rowid DESC",
        (session_id,),
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

def advance(run_id: str, *, phase: str, report: str | None, spawn, git,
            session_id: str | None = None) -> None:
    """Consume a finished agent's handoff report and drive the state machine.

    ``phase`` is the phase the finished agent was working. ``session_id`` is the
    finishing agent's session; when given, a repeated delivery of the SAME
    session is a no-op (idempotent against a duplicate poll-loop drain — critical
    for pr_review, whose phase stays 'pr_review' after post_review so a phase-only
    guard wouldn't catch it). A legitimate building self-heal re-spawns a NEW
    agent (new session id), so its fresh finish is still processed. A vanished run
    is a silent no-op."""
    run = get(run_id)
    if run is None:
        return
    if session_id is not None and session_id == run.get("last_finished_session"):
        return  # already processed this exact agent finish
    if phase not in AGENT_PHASES:
        # Never silent: a finish for a non-agent phase (plan_review/blocked/
        # shipped) is unexpected — record it rather than fall through.
        tasks.add_comment(
            run["task_id"],
            body=f"advance() called for unexpected phase {phase!r}; ignoring.",
            author="system", kind="system",
        )
        return
    if session_id is not None:
        _set_run(run_id, last_finished_session=session_id)
        run = get(run_id)
    if phase == "shaping":
        _advance_shaping(run, report, spawn, git)
    elif phase == "building":
        _advance_building(run, report, spawn, git)
    elif phase == "pr_review":
        _advance_pr_review(run, report, spawn, git)


def retry(run_id: str, *, spawn, git) -> None:
    """Resume a blocked run: return to the phase it blocked from and re-spawn."""
    run = get(run_id)
    if run is None or run.get("phase") != "blocked":
        return
    phase = run.get("blocked_from_phase") or "shaping"
    _set_run(run_id, phase=phase, blocked_reason=None, blocked_from_phase=None)
    tasks.move(run["task_id"], phase, force=True)
    tasks.add_comment(run["task_id"], body=f"Retrying — resuming {phase}.",
                      author="system", kind="system")
    _spawn_phase(get(run_id), phase, spawn, resume_comment=run.get("blocked_reason"))


def _advance_building(run: dict, report: str | None, spawn, git) -> None:
    data = _parse_report(run, "building", report)
    if data is None:
        return
    tid = run["task_id"]
    if data.get("tests") == "green":
        artifacts.register(tid, run["id"], "test_guide", "Test guide",
                           data.get("test_guide_path"), run.get("branch_name"),
                           by="building")
        tasks.add_comment(tid, body="Tests green — manual test gate opened.",
                          author="building", kind="test_report")
        gates.open_gate(tid, run["id"], "manual_test")  # task stays 'building'
        tasks.add_comment(tid, body="Manual test gate opened — waiting on you.",
                          author="system", kind="gate")
        return
    # tests red → self-heal up to the cap, else block
    failing = data.get("failing") or []
    attempts = (run.get("self_heal_attempts") or 0) + 1
    _set_run(run["id"], self_heal_attempts=attempts)
    tasks.add_comment(
        tid,
        body=f"Tests red (attempt {attempts}/{_MAX_SELF_HEAL}). Failing: {failing}",
        author="building", kind="test_report",
    )
    if attempts < _MAX_SELF_HEAL:
        _spawn_phase(get(run["id"]), "building", spawn,
                     resume_comment=f"Tests failing: {failing}. Fix and re-run.")
    else:
        _block(get(run["id"]), "building",
               f"tests still red after {_MAX_SELF_HEAL} self-heal attempts",
               note=f"Tests still red after {_MAX_SELF_HEAL} attempts; blocking. "
                    f"Failing: {failing}")


def _advance_pr_review(run: dict, report: str | None, spawn, git) -> None:
    data = _parse_report(run, "pr_review", report)
    if data is None:
        return
    tid = run["task_id"]
    findings = data.get("findings") or []
    # PR is already open (from the manual_test-approve step) — post review only.
    git.post_review(run.get("pr_number"), findings)
    tasks.add_comment(
        tid,
        body=(data.get("summary") or "Review complete.")
             + (f"\n\n{len(findings)} finding(s) posted to the PR."),
        author="pr_review", kind="review",
    )
    artifacts.register(tid, run["id"], "review_report", "Review report",
                       data.get("review_report_path"), run.get("branch_name"),
                       by="pr_review")
    gates.open_gate(tid, run["id"], "merge")
    tasks.add_comment(tid, body="Review done — merge gate opened.",
                      author="system", kind="gate")


def _approve_manual_test(run: dict, spawn, git) -> None:
    """manual_test approve → open the PR, then spawn the reviewer against it."""
    tid = run["task_id"]
    cfg = project_git.get(run["project_id"]) or {}
    task = tasks.get(tid) or {}
    pr = git.open_pr(cfg, run.get("worktree_path"), run.get("branch_name"),
                     cfg.get("dev_branch", "development"),
                     task.get("title") or tid, "Opened by lifecycle engine.")
    _set_run(run["id"], pr_number=pr.get("pr_number"), pr_url=pr.get("pr_url"),
             phase="pr_review")
    tasks.move(tid, "pr_review")
    tasks.add_comment(
        tid, body=f"PR #{pr.get('pr_number')} opened: {pr.get('pr_url')}",
        author="system", kind="system",
    )
    _spawn_phase(get(run["id"]), "pr_review", spawn)


def _approve_merge(run: dict, git) -> None:
    """merge approve → merge the PR, stamp dev env, ship the task."""
    tid = run["task_id"]
    cfg = project_git.get(run["project_id"]) or {}
    dev_branch = cfg.get("dev_branch", "development")
    sha = git.merge(cfg, run.get("worktree_path"), run.get("branch_name"),
                    run.get("pr_number"))
    _set_run(run["id"], merge_commit=sha, env_dev_at=_now(), phase="shipped",
             active=0)
    artifacts.repoint_to_branch(tid, dev_branch)
    tasks.move(tid, "shipped")
    tasks.add_comment(
        tid,
        body=f"Merged ({sha}) to {dev_branch} — task shipped and live on dev.",
        author="system", kind="system",
    )


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


# -- environment watcher ------------------------------------------------------

def projects_with_pending_env() -> list[str]:
    """Distinct project_ids that have merged runs not yet observed in prod.

    These are the projects the poll-loop env watcher needs to reconcile."""
    rows = db.query(
        "SELECT DISTINCT project_id FROM lifecycle_runs "
        "WHERE merge_commit IS NOT NULL AND env_prod_at IS NULL"
    )
    return [r["project_id"] for r in rows]


def run_env_watch(project_id: str, git) -> None:
    """Reconcile deployed-env stamps for a project's merged runs.

    For each run whose merge commit has landed but not yet reached prod, check
    whether it has now reached staging (then prod) via ``git.commit_reached_branch``
    and stamp + note the transition. Idempotent: a run already stamped for an env
    is skipped."""
    cfg = project_git.get(project_id) or {}
    staging = cfg.get("staging_branch", "staging")
    prod = cfg.get("prod_branch", "main")
    rows = db.query(
        "SELECT * FROM lifecycle_runs "
        "WHERE project_id = ? AND merge_commit IS NOT NULL AND env_prod_at IS NULL",
        (project_id,),
    )
    for row in rows:
        run = dict(row)
        sha = run.get("merge_commit")
        if not run.get("env_staging_at") and git.commit_reached_branch(sha, staging):
            _set_run(run["id"], env_staging_at=_now())
            tasks.add_comment(run["task_id"],
                              body=f"Reached staging ({staging}).",
                              author="system", kind="system")
            run["env_staging_at"] = _now()
        if run.get("env_staging_at") and not run.get("env_prod_at") \
                and git.commit_reached_branch(sha, prod):
            _set_run(run["id"], env_prod_at=_now())
            tasks.add_comment(run["task_id"],
                              body=f"Reached production ({prod}).",
                              author="system", kind="system")


# -- gate decisions -----------------------------------------------------------

def decide_gate(run_id: str, gate: str, decision: str, *, comment: str | None = None,
                by: str | None = None, spawn, git) -> None:
    """Record a human gate decision and drive the resulting transition.

    ``decision`` is ``approved`` or ``changes_requested``. On approval each gate
    advances to its next phase (plan→building, manual_test→pr_review, merge→ship).
    On ``changes_requested`` the engine sets ``run['resume_comment']`` and
    re-spawns the producing agent.
    """
    run = get(run_id)
    if run is None:
        return
    # Idempotency: only act on a gate that is actually waiting. A double-click or
    # racing second decision (git.merge would fire twice, shipping twice) is a
    # no-op — record nothing, run no side-effects.
    g = gates.gate_for(run_id, gate)
    if g is None or g["status"] != "waiting":
        return
    gates.decide(g["id"], decision, comment=comment, by=by)
    tid = run["task_id"]
    tasks.add_comment(
        tid,
        body=f"{gate} gate: {decision}" + (f" — {comment}" if comment else ""),
        author=by or "human", kind="gate",
    )
    if decision == "approved":
        if gate == "plan":
            _set_run(run_id, phase="building")
            tasks.move(tid, "building")
            _spawn_phase(get(run_id), "building", spawn)
        elif gate == "manual_test":
            _approve_manual_test(get(run_id), spawn, git)
        elif gate == "merge":
            _approve_merge(get(run_id), git)
    elif decision == "changes_requested":
        if gate == "plan":
            _set_run(run_id, phase="shaping")
            tasks.move(tid, "shaping", force=True)
            _spawn_phase(get(run_id), "shaping", spawn, resume_comment=comment)
        elif gate in ("manual_test", "merge"):
            # Both send the run back to BUILDING for rework. For merge this is the
            # clean recovery path: human rejects the merge → builder addresses the
            # comment → tests → manual_test gate → pr_review → merge gate again.
            # (Without this, a rejected merge would strand the run in pr_review
            # with no gate and no agent, and retry() only resumes blocked runs.)
            _set_run(run_id, phase="building")
            tasks.move(tid, "building", force=True)
            _spawn_phase(get(run_id), "building", spawn, resume_comment=comment)
