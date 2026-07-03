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

from tui_pilot import (
    artifacts, brain, db, fanout, gates, gitops, lifecycle_templates,
    project_git, tasks,
)

# The phase list, agent-phase set, and gate set now live in lifecycle_templates
# (the per-kind registry) — the engine reads them from there so there is a single
# source of truth. Do NOT reintroduce module-level copies here.

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


def has_run_for_task(task_id: str) -> bool:
    """True if the task has ANY lifecycle run — active OR terminal.

    Used by the kind-confirm endpoint to lock the kind once a run exists: spec §3
    locks kind at Start and it must stay locked through shipped/delivered, so this
    matches any row (not just the active one).
    """
    rows = db.query(
        "SELECT 1 FROM lifecycle_runs WHERE task_id = ? LIMIT 1", (task_id,)
    )
    return bool(rows)


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
    """Create a run at the kind's first phase, (optionally) prepare a workspace,
    and spawn the first-phase agent.

    The run's ``kind`` is read from the task (default ``code`` for V2 tasks with
    no kind). ``git.prepare_workspace`` is only called for kinds whose first phase
    needs a repo (``needs_workspace``); research/docs runs have a null workspace
    and fall back to a per-agent scratch cwd downstream.

    Raises ValueError if the task already has an active run (one active run per
    task; history is retained).
    """
    if active_run_for_task(task_id) is not None:
        raise ValueError(f"task {task_id} already has an active lifecycle run")
    cfg = project_git.get(project_id) or {}
    task = tasks.get(task_id) or {}
    kind = task.get("kind") or "code"
    first = lifecycle_templates.first_phase(kind)
    slug = _slugify(task.get("title", task_id))
    run_id = _new_id()
    ws = (git.prepare_workspace(cfg, task_id, slug, kind="feat")
          if lifecycle_templates.needs_workspace(kind) else {})
    db.execute(
        "INSERT INTO lifecycle_runs "
        "(id, project_id, task_id, phase, kind, active, branch_name, "
        " worktree_path, self_heal_attempts, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?)",
        (run_id, project_id, task_id, first, kind, ws.get("branch_name"),
         ws.get("worktree_path"), _now(), _now()),
    )
    run = get(run_id)
    _spawn_phase(run, first, spawn)
    tasks.move(task_id, first)
    tasks.add_comment(
        task_id,
        body=f"Lifecycle started — {first} on branch {ws.get('branch_name')}.",
        author="system", kind="system",
    )
    return get(run_id)


# -- fan-out ------------------------------------------------------------------
# A fan-out phase runs N agents in parallel (one per angle) and advances on an
# all-done barrier. The barrier advance is an atomic compare-and-swap on the run's
# phase (NOT read-then-act): drop/retry HTTP threads run concurrently with the
# poll-loop drainer, so several resolvers can observe `all_done` at once — only
# the ONE whose CAS UPDATE affected a row spawns synthesis. This is the N-resolver
# analogue of V2's phase-guarded once-only advance.

def _spawn_fanout(run: dict, phase: str, idx: int, spawn) -> None:
    """Spawn one fan-out agent for angle ``idx`` and mark its row ``running``.

    The per-idx angle is threaded via ``run['fanout_idx']`` (mirroring how
    ``_spawn_phase`` threads ``resume_comment``) so the real spawn closure can
    stamp the fan-out ``_meta`` keys and the prompt builder can read the angle.
    """
    run = dict(run)
    run["fanout_idx"] = idx
    session_id, account_id = spawn(run, phase)
    fanout.mark_running(run["id"], phase, idx, session_id, account_id)


def _cas_advance_phase(run_id: str, from_phase: str, to_phase: str) -> bool:
    """Atomic barrier advance: move the run to ``to_phase`` iff it is still at
    ``from_phase``. Returns True for the single resolver whose UPDATE won the
    race (rowcount == 1); all concurrent losers see rowcount 0 and get False."""
    with db.tx() as cx:
        cur = cx.execute(
            "UPDATE lifecycle_runs SET phase = ?, updated_at = ? "
            "WHERE id = ? AND phase = ?",
            (to_phase, _now(), run_id, from_phase),
        )
        return cur.rowcount == 1


def _release_barrier(run_id: str, phase: str, spawn, git) -> None:
    """If every angle is resolved, CAS-advance to the next phase and (only for the
    CAS winner) move the task + spawn the synthesis agent with the findings as
    context. Safe to call from any resolver (finish / drop / all-dropped edge)."""
    if not fanout.all_done(run_id, phase):
        return
    run = get(run_id)
    if run is None:
        return
    kind = run.get("kind") or "code"
    nxt = lifecycle_templates.phase_after(kind, phase)
    if nxt is None:
        return
    if not _cas_advance_phase(run_id, phase, nxt):
        return  # another resolver already advanced the barrier
    tid = run["task_id"]
    tasks.move(tid, nxt)
    n = len(fanout.rows_for(run_id, phase))
    done = sum(1 for r in fanout.rows_for(run_id, phase) if r["status"] == "done")
    tasks.add_comment(
        tid,
        body=f"Fan-out {phase} complete — {done}/{n} angle(s) delivered findings; "
             f"advancing to {nxt}.",
        author="system", kind="system",
    )
    if nxt in lifecycle_templates.agent_phases(kind):
        _spawn_phase(get(run_id), nxt, spawn)


def enter_fanout(run: dict, phase: str, angles: list, spawn, git) -> None:
    """Enter a fan-out ``phase``: create N rows and spawn N agents.

    Idempotent — if any ``fanout_agents`` rows already exist for ``(run_id,
    phase)`` this is a no-op (guards a double scope-approve from double-spawning N
    agents). Sets the run's phase to ``phase`` and moves the task there."""
    run_id = run["id"]
    if fanout.rows_for(run_id, phase):
        return
    fanout.create_rows(run_id, phase, angles)
    _set_run(run_id, phase=phase)
    tasks.move(run["task_id"], phase)
    for idx in range(len(angles)):
        _spawn_fanout(get(run_id), phase, idx, spawn)


def advance_fanout(run_id: str, phase: str, idx: int, *, report: str | None,
                   spawn, git, session_id: str | None = None) -> None:
    """Consume one fan-out angle's finished handoff.

    Per-row idempotency is atomic: the row is CLAIMED (unresolved → done) before
    the finding is registered, so a late finish for an already ``dropped`` angle
    (or a duplicate delivery of a ``done`` one) is a no-op — it neither flips the
    row nor registers a finding after synthesis started. After a successful claim,
    the report is stored as an inline ``finding`` artifact and the barrier is
    (maybe) released via the once-only CAS advance.

    The claim + finding-registration + report link run in a SINGLE ``db.tx()`` so
    a concurrent ``drop_angle`` on another angle can never observe this row as
    ``done`` (and win the barrier CAS, spawning synthesis) BEFORE its finding
    artifact is committed — otherwise a completed angle's findings would be
    silently dropped from the synthesis context (db.tx is re-entrant, so the
    nested mark_done/register/set_report calls join this one outer transaction)."""
    run = get(run_id)
    if run is None:
        return
    row = fanout.get_row(run_id, phase, idx)
    if row is None or row["status"] in ("done", "dropped"):
        return  # fast-path: already resolved
    with db.tx():
        if not fanout.mark_done(run_id, phase, idx):
            return  # lost the claim race to a concurrent drop / finish
        art = artifacts.register(run["task_id"], run_id, "finding",
                                 f"Finding — angle {idx}", content=report, by=phase)
        fanout.set_report(run_id, phase, idx, art["id"])
    _release_barrier(run_id, phase, spawn, git)


def retry_angle(run_id: str, phase: str, idx: int, *, spawn, git) -> None:
    """Re-spawn one fan-out angle. Only a ``blocked`` row (a dead/failed agent) is
    re-spawnable — a ``done``/``dropped`` row is already resolved, and a
    ``queued``/``running`` one still has a live agent (re-spawning it would leave
    two live agents racing the same idx). Any non-``blocked`` status is a no-op
    with a system note."""
    run = get(run_id)
    if run is None:
        return
    row = fanout.get_row(run_id, phase, idx)
    if row is None:
        return
    if row["status"] != "blocked":
        tasks.add_comment(
            run["task_id"],
            body=f"Retry ignored — fan-out angle [{phase} #{idx}] is "
                 f"{row['status']}, not blocked.",
            author="system", kind="system",
        )
        return
    tasks.add_comment(run["task_id"],
                      body=f"Retrying fan-out angle [{phase} #{idx}].",
                      author="system", kind="system")
    _spawn_fanout(run, phase, idx, spawn)


def drop_angle(run_id: str, phase: str, idx: int, *, spawn, git) -> None:
    """Give up on one fan-out angle: mark it ``dropped`` + note. If that resolves
    the last outstanding row, run the SAME CAS barrier advance (so dropping every
    angle spawns synthesis with zero findings)."""
    run = get(run_id)
    if run is None:
        return
    if not fanout.drop(run_id, phase, idx):
        return  # already resolved (done/dropped) — no-op
    tasks.add_comment(run["task_id"],
                      body=f"Dropped fan-out angle [{phase} #{idx}].",
                      author="system", kind="system")
    _release_barrier(run_id, phase, spawn, git)


def fanout_agent_died(run_id: str, phase: str, idx: int) -> None:
    """A fan-out agent whose harness exited without a ``done`` handoff → move its
    row to ``blocked`` and surface it, so the barrier never stalls in ``running``.
    The blocked row holds the barrier until a ``retry_angle``/``drop_angle``."""
    run = get(run_id)
    if run is None:
        return
    if fanout.block(run_id, phase, idx):
        tasks.add_comment(
            run["task_id"],
            body=f"Fan-out agent [{phase} #{idx}] exited without finishing — "
                 f"blocked. Retry or drop it to release the barrier.",
            author="system", kind="system",
        )


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
    kind = run.get("kind") or "code"
    if phase not in lifecycle_templates.agent_phases(kind):
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
    handler = _ADVANCE_HANDLERS.get(kind, {}).get(phase)
    if handler is not None:
        handler(run, report, spawn, git)


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
    """manual_test approve → open the PR, then spawn the reviewer against it.

    Second-lap recovery: after a merge ``changes_requested`` the run loops back
    through building → manual_test. The PR from lap 1 is still open (its branch is
    already pushed and the builder committed fixes onto it), so re-opening it would
    make a real ``gh pr create`` fail. When ``pr_number`` is already set, skip
    ``open_pr`` and go straight to re-reviewing the existing PR.
    """
    tid = run["task_id"]
    if run.get("pr_number"):
        _set_run(run["id"], phase="pr_review")
        tasks.move(tid, "pr_review")
        tasks.add_comment(
            tid, body=f"PR #{run.get('pr_number')} updated with fixes — re-reviewing.",
            author="system", kind="system",
        )
        _spawn_phase(get(run["id"]), "pr_review", spawn)
        return
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


# -- research handlers --------------------------------------------------------
# Research has no workspace: scoping proposes angles → scope gate; the scope-gate
# approve fans out (via investigating's `fanout` flag in decide_gate); the barrier
# spawns synthesis (generic _spawn_phase, NOT a research entry handler); synthesis
# finishes → review gate; review-approve delivers (creates followups + brain nodes).

def _research_angles(run: dict) -> list:
    """The angles the scoping agent proposed, read back from the latest inline
    ``plan`` artifact (its content is the JSON scoping handoff). Used by the
    scope-gate approve path to seed the fan-out."""
    plans = [a for a in artifacts.for_task(run["task_id"]) if a["kind"] == "plan"]
    if not plans:
        return []
    try:
        data = json.loads(plans[-1].get("content") or "{}")
    except (json.JSONDecodeError, TypeError):
        return []
    return data.get("angles") or []


def _advance_scoping(run: dict, report: str | None, spawn, git) -> None:
    """scoping finish → register the plan (inline angles) + open the scope gate.

    The run stays at ``scoping`` while the gate waits; scope-approve fans out."""
    data = _parse_report(run, "scoping", report)
    if data is None:
        return
    tid = run["task_id"]
    angles = data.get("angles") or []
    if not angles:
        # Zero angles → block (recoverable via retry), never open the scope gate.
        # An empty fan-out would move to investigating with 0 rows, and
        # `fanout.all_done` is False when no rows exist, so the barrier would never
        # release and there'd be no retry/drop target — an unrecoverable stall. A
        # research task with no angles is a scoping failure the human should see.
        _block(run, "scoping", "scoping produced no angles",
               note="Scoping agent proposed no research angles; blocking so it can "
                    "be retried. Raw report:\n" + (report or ""))
        return
    # Inline plan artifact: content is the full scoping JSON so the scope-approve
    # path (and the human) can read the proposed angles/modes back.
    artifacts.register(tid, run["id"], "plan", "Research plan",
                       content=json.dumps(data), by="scoping")
    tasks.add_comment(tid, body=data.get("summary") or f"Scoped {len(angles)} angle(s).",
                      author="scoping", kind="progress")
    gates.open_gate(tid, run["id"], "scope")
    tasks.add_comment(tid, body="Angles proposed — scope gate opened.",
                      author="system", kind="gate")


def _advance_synthesis(run: dict, report: str | None, spawn, git) -> None:
    """synthesis finish → register the report (inline), persist the full parsed
    synthesis JSON (so deliver can read the followups/brain nodes), open review."""
    data = _parse_report(run, "synthesis", report)
    if data is None:
        return
    tid = run["task_id"]
    artifacts.register(tid, run["id"], "report", "Research report",
                       content=data.get("report") or "", by="synthesis")
    _set_run(run["id"], synthesis_json=json.dumps(data))
    gates.open_gate(tid, run["id"], "review")
    tasks.add_comment(tid, body="Synthesis complete — review gate opened.",
                      author="system", kind="gate")


def _deliver_research(run: dict, git) -> None:
    """review-approve → terminal ``delivered``: create every proposed followup task
    and brain node from the persisted synthesis JSON.

    Brain-node types are validated against ``brain.NODE_TYPES`` — an invalid type
    is skipped (never a crash) and valid nodes get ``source='research:<task_id>'``.
    """
    tid = run["task_id"]
    _set_run(run["id"], phase="delivered", active=0)
    tasks.move(tid, "delivered")
    try:
        data = json.loads(run.get("synthesis_json") or "{}")
    except (json.JSONDecodeError, TypeError):
        data = {}
    followups = data.get("followups") or []
    created_tasks = 0
    for f in followups:
        title = f.get("title") if isinstance(f, dict) else str(f)
        if not title:
            continue
        desc = f.get("description") if isinstance(f, dict) else None
        tasks.create(project_id=run["project_id"], title=title, description=desc)
        created_tasks += 1
    nodes = data.get("brain_nodes") or []
    created_nodes = skipped = 0
    for n in nodes:
        ntype = n.get("type") if isinstance(n, dict) else None
        if ntype not in brain.NODE_TYPES:
            skipped += 1     # invalid/unknown type → skip, don't crash create_node
            continue
        label = n.get("label") or n.get("title") or "Research finding"
        brain.create_node(run["project_id"], type=ntype, label=label,
                          detail=n.get("detail"), source=f"research:{tid}")
        created_nodes += 1
    tasks.add_comment(
        tid,
        body=f"Delivered — {created_tasks} followup task(s), {created_nodes} brain "
             f"node(s) created" + (f" ({skipped} skipped)" if skipped else "") + ".",
        author="system", kind="system",
    )


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
    tid = run["task_id"]

    def _consume_gate() -> None:
        gates.decide(g["id"], decision, comment=comment, by=by)
        tasks.add_comment(
            tid,
            body=f"{gate} gate: {decision}" + (f" — {comment}" if comment else ""),
            author=by or "human", kind="gate",
        )

    kind = run.get("kind") or "code"
    adv = lifecycle_templates.gate_advances(kind).get(gate, {})

    if decision == "approved":
        approve = _APPROVE_HANDLERS.get(kind, {}).get(gate)
        if approve is not None:
            # A gate with an irreversible git side-effect (code manual_test→open_pr,
            # merge→git.merge). Run the side-effect FIRST: only consume the gate
            # once it succeeds. On GitError we _block() the run (recoverable via
            # retry()) and RETURN with the gate still 'waiting' — never a consumed
            # dead-end that a retried approve would no-op on. retry() resumes the
            # producing phase (the phase whose agent opened this gate), which
            # re-spawns the agent and, on success, opens a fresh gate.
            try:
                approve(get(run_id), spawn, git)
            except gitops.GitError as e:
                producing = _producing_phase(kind, gate)
                _block(
                    get(run_id), producing,
                    f"{gate} approve failed on a git operation",
                    note=f"{gate} gate approve failed on a git operation; blocking "
                         f"so it can be retried after fixing the cause.\n\n{e}",
                )
                return
            _consume_gate()
        else:
            # Plain phase move (code plan gate): advance to approve_next and spawn
            # its agent (if that phase spawns one). An unregistered gate (no
            # approve_next) is a no-op, matching V2's implicit else.
            nxt = adv.get("approve_next")
            if nxt is None:
                return
            _consume_gate()
            if nxt in lifecycle_templates.fanout_phases(kind):
                # Fan-out phase (research scope→investigating): spawn N angle
                # agents via the Chunk 2 barrier primitive, NOT a single agent.
                enter_fanout(get(run_id), nxt, _research_angles(get(run_id)),
                             spawn, git)
            else:
                _set_run(run_id, phase=nxt)
                tasks.move(tid, nxt)
                if nxt in lifecycle_templates.agent_phases(kind):
                    _spawn_phase(get(run_id), nxt, spawn)
    elif decision == "changes_requested":
        # Rework: return to the gate's changes_target and re-spawn it with the
        # reviewer's comment (code: plan→shaping, manual_test/merge→building). An
        # unregistered gate (no changes_target) is a no-op.
        target = adv.get("changes_target")
        if target is None:
            return
        _consume_gate()
        _set_run(run_id, phase=target)
        tasks.move(tid, target, force=True)
        _spawn_phase(get(run_id), target, spawn, resume_comment=comment)


# -- registry-driven dispatch -------------------------------------------------
# The engine is generalized over a per-kind template (lifecycle_templates): the
# code handlers below are UNCHANGED from V2 — only which handler runs for a given
# (kind, phase)/gate is now resolved from these maps instead of hardcoded
# if/elif branches. New kinds (research/docs) register their handlers here in
# later chunks.

def _producing_phase(kind: str, gate: str) -> str | None:
    """The phase whose agent opens ``gate`` — the block target when the gate's
    approve side-effect fails (code: manual_test→building, merge→pr_review)."""
    for p in lifecycle_templates.phases(kind):
        if p.get("gate") == gate:
            return p["name"]
    return None


# advance() dispatch: (kind → phase → finished-agent handler(run, report, spawn, git)).
_ADVANCE_HANDLERS: dict[str, dict] = {
    "code": {
        "shaping": _advance_shaping,
        "building": _advance_building,
        "pr_review": _advance_pr_review,
    },
    "research": {
        "scoping": _advance_scoping,
        # investigating is a fan-out phase — each angle's finish is consumed by
        # advance_fanout, not advance(); no per-phase finish handler here.
        "synthesis": _advance_synthesis,
    },
}

# decide_gate() approve dispatch: (kind → gate → approve handler(run, spawn, git)).
# Only gates with an irreversible side-effect register here; a gate with no entry
# is a plain phase move to its gate_advances[gate]["approve_next"].
_APPROVE_HANDLERS: dict[str, dict] = {
    "code": {
        "manual_test": _approve_manual_test,
        "merge": lambda run, spawn, git: _approve_merge(run, git),
    },
    # review-approve delivers the research run (terminal + followups + brain
    # nodes). No git side-effect, so it never raises GitError; registering it here
    # (rather than the plain phase-move branch) is what runs the deliver side-effects.
    "research": {
        "review": lambda run, spawn, git: _deliver_research(run, git),
    },
}
