from tui_pilot import lifecycle, tasks, projects


class FakeGit:
    """Injected git facade — records calls, no real repo needed for engine tests.
    Note: artifact re-pointing is NOT here — it's an engine-owned DB update
    (artifacts.repoint_to_branch)."""
    def __init__(self): self.calls = []; self.merge_sha = "sha123"
    def prepare_workspace(self, cfg, task_id, slug, kind="feat"):
        self.calls.append(("prepare", task_id))
        return {"branch_name": f"feat/{task_id}-{slug}", "worktree_path": f"/wt/{task_id}"}
    def open_pr(self, *a, **k): self.calls.append(("open_pr",)); return {"pr_number": 7, "pr_url": "u/7"}
    def post_review(self, *a, **k): self.calls.append(("post_review",))
    def merge(self, *a, **k): self.calls.append(("merge",)); return self.merge_sha


def _setup():
    projects.create(id="acme", name="Acme", path="/w")
    from tui_pilot import project_git
    project_git.upsert("acme", repo_ssh_url="git@github.com:acme/app.git")
    return tasks.create(project_id="acme", title="Build X")["id"]


def _spawn(run, phase):
    return (f"sess-{phase}", "acct")


def test_start_run_creates_shaping_run_and_moves_task():
    tid = _setup()
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    assert run["phase"] == "shaping"
    assert run["branch_name"].startswith("feat/SPD-")
    assert tasks.get(tid)["status"] == "shaping"


def test_start_run_rejects_a_second_active_run():
    tid = _setup()
    lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    import pytest
    with pytest.raises(ValueError):
        lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())


# -- Task 3.2: advance() shaping -> plan gate ---------------------------------

def test_shaping_advance_opens_plan_gate_and_registers_artifacts():
    from tui_pilot import gates, artifacts
    tid = _setup()
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    lifecycle.advance(run["id"], phase="shaping",
                      report='{"spec_path":"docs/s.md","plan_path":"docs/p.md","summary":"ok"}',
                      spawn=_spawn, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "plan_review"
    assert tasks.get(tid)["status"] == "plan_review"
    g = gates.gate_for(run["id"], "plan")
    assert g is not None and g["status"] == "waiting"
    kinds = {a["kind"] for a in artifacts.for_task(tid)}
    assert "spec" in kinds and "plan" in kinds


def test_shaping_advance_bad_json_blocks():
    tid = _setup()
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    lifecycle.advance(run["id"], phase="shaping", report="not json",
                      spawn=_spawn, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "blocked"
    assert tasks.get(tid)["status"] == "blocked"
    bodies = [c["kind"] for c in tasks.comments(tid)]
    assert "system" in bodies


# -- Task 3.3: gate decisions (plan approve / request_changes) ----------------

def _shape(tid):
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    lifecycle.advance(run["id"], phase="shaping",
                      report='{"spec_path":"docs/s.md","plan_path":"docs/p.md","summary":"ok"}',
                      spawn=_spawn, git=FakeGit())
    return run


def test_plan_approve_spawns_builder():
    from tui_pilot import gates
    tid = _setup()
    run = _shape(tid)
    lifecycle.decide_gate(run["id"], "plan", "approved", spawn=_spawn, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "building"
    assert tasks.get(tid)["status"] == "building"
    g = gates.gate_for(run["id"], "plan")
    assert g["status"] == "approved" and g["decided_at"]


def test_plan_request_changes_threads_comment_into_respawn():
    tid = _setup()
    run = _shape(tid)
    seen = {}
    def rec(run, phase): seen["comment"] = run.get("resume_comment"); return ("s", "a")
    lifecycle.decide_gate(run["id"], "plan", "changes_requested",
                          comment="tighten scope", spawn=rec, git=FakeGit())
    assert seen["comment"] == "tighten scope"
    assert lifecycle.get(run["id"])["phase"] == "shaping"


# -- Task 3.4: building -> manual_test gate / self-heal / blocked -------------

def _build(tid):
    run = _shape(tid)
    lifecycle.decide_gate(run["id"], "plan", "approved", spawn=_spawn, git=FakeGit())
    return run


def test_building_green_opens_manual_test_gate():
    from tui_pilot import gates, artifacts
    tid = _setup()
    run = _build(tid)
    lifecycle.advance(run["id"], phase="building",
                      report='{"tests":"green","test_guide_path":"docs/tg.md"}',
                      spawn=_spawn, git=FakeGit())
    g = gates.gate_for(run["id"], "manual_test")
    assert g is not None and g["status"] == "waiting"
    assert tasks.get(tid)["status"] == "building"  # stays building (amber via gate)
    assert any(a["kind"] == "test_guide" for a in artifacts.for_task(tid))


def test_building_red_self_heals_then_blocks():
    tid = _setup()
    run = _build(tid)
    lifecycle.advance(run["id"], phase="building",
                      report='{"tests":"red","failing":["t1"]}',
                      spawn=_spawn, git=FakeGit())
    assert lifecycle.get(run["id"])["self_heal_attempts"] == 1
    assert lifecycle.get(run["id"])["phase"] == "building"
    # two more red reports -> cap of 3 -> blocked
    lifecycle.advance(run["id"], phase="building",
                      report='{"tests":"red","failing":["t1"]}', spawn=_spawn, git=FakeGit())
    lifecycle.advance(run["id"], phase="building",
                      report='{"tests":"red","failing":["t1"]}', spawn=_spawn, git=FakeGit())
    r = lifecycle.get(run["id"])
    assert r["phase"] == "blocked"
    assert r["blocked_from_phase"] == "building"
    assert tasks.get(tid)["status"] == "blocked"
    assert any(c["kind"] == "test_report" for c in tasks.comments(tid))


# -- Task 3.5: pr_review -> merge gate -> shipped -----------------------------

def _to_pr_review(tid, git):
    run = _build(tid)
    lifecycle.advance(run["id"], phase="building",
                      report='{"tests":"green","test_guide_path":"docs/tg.md"}',
                      spawn=_spawn, git=git)
    lifecycle.decide_gate(run["id"], "manual_test", "approved", spawn=_spawn, git=git)
    return run


def test_manual_test_approve_opens_pr_and_spawns_reviewer():
    tid = _setup()
    git = FakeGit()
    run = _to_pr_review(tid, git)
    assert ("open_pr",) in git.calls
    r = lifecycle.get(run["id"])
    assert r["phase"] == "pr_review"
    assert r["pr_number"] == 7


def test_pr_review_advance_posts_review_and_opens_merge_gate():
    from tui_pilot import gates, artifacts
    tid = _setup()
    git = FakeGit()
    run = _to_pr_review(tid, git)
    git2 = FakeGit()
    lifecycle.advance(run["id"], phase="pr_review",
                      report='{"findings":[{"path":"a.py","line":1,"body":"x"}],"summary":"ok"}',
                      spawn=_spawn, git=git2)
    assert ("post_review",) in git2.calls
    assert any(c["kind"] == "review" for c in tasks.comments(tid))
    assert any(a["kind"] == "review_report" for a in artifacts.for_task(tid))
    g = gates.gate_for(run["id"], "merge")
    assert g is not None and g["status"] == "waiting"


def test_merge_approve_ships():
    from tui_pilot import artifacts
    tid = _setup()
    git = FakeGit()
    run = _to_pr_review(tid, git)
    lifecycle.advance(run["id"], phase="pr_review",
                      report='{"findings":[],"summary":"ok"}', spawn=_spawn, git=git)
    merge_git = FakeGit()
    lifecycle.decide_gate(run["id"], "merge", "approved", spawn=_spawn, git=merge_git)
    assert ("merge",) in merge_git.calls
    r = lifecycle.get(run["id"])
    assert r["merge_commit"] == merge_git.merge_sha
    assert r["env_dev_at"]
    assert r["phase"] == "shipped"
    assert r["active"] == 0
    assert tasks.get(tid)["status"] == "shipped"
    # artifacts re-pointed to the project's dev_branch (development)
    assert all(a["branch"] == "development" for a in artifacts.for_task(tid))


def test_run_by_session_finds_active_run_by_agent_session():
    tid = _setup()
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    # start_run spawned shaping with _spawn -> ("sess-shaping", "acct")
    found = lifecycle.run_by_session("sess-shaping")
    assert found is not None
    assert found["id"] == run["id"] and found["phase"] == "shaping"
    assert lifecycle.run_by_session("no-such-session") is None


def test_merge_request_changes_sends_back_to_building_not_stranded():
    tid = _setup()
    git = FakeGit()
    run = _to_pr_review(tid, git)
    lifecycle.advance(run["id"], phase="pr_review",
                      report='{"findings":[],"summary":"ok"}', spawn=_spawn, git=git)
    # merge gate is waiting; human requests changes instead of merging
    seen = {}

    def rec(run, phase):
        seen["comment"] = run.get("resume_comment")
        seen["phase"] = phase
        return ("s-rework", "a")

    lifecycle.decide_gate(run["id"], "merge", "changes_requested",
                          comment="fix the flaky test", spawn=rec, git=git)
    r = lifecycle.get(run["id"])
    # NOT stranded: back in building, active, with a fresh builder addressing the note
    assert r["phase"] == "building"
    assert r["active"] == 1
    assert tasks.get(tid)["status"] == "building"
    assert seen["phase"] == "building"
    assert seen["comment"] == "fix the flaky test"
    # merge never fired
    assert ("merge",) not in git.calls


# -- Robustness: gate git side-effect failure blocks (not strands) ------------

class _OpenPRRaisesGit(FakeGit):
    def open_pr(self, *a, **k):
        from tui_pilot import gitops
        self.calls.append(("open_pr_attempt",))
        raise gitops.GitError("gh pr create failed")


class _MergeRaisesGit(FakeGit):
    def merge(self, *a, **k):
        from tui_pilot import gitops
        self.calls.append(("merge_attempt",))
        raise gitops.GitError("gh pr merge failed")


def test_manual_test_approve_git_error_blocks_and_leaves_gate_waiting():
    from tui_pilot import gates
    tid = _setup()
    git = _OpenPRRaisesGit()
    # drive to a waiting manual_test gate
    run = _build(tid)
    lifecycle.advance(run["id"], phase="building",
                      report='{"tests":"green","test_guide_path":"docs/tg.md"}',
                      spawn=_spawn, git=git)
    lifecycle.decide_gate(run["id"], "manual_test", "approved", spawn=_spawn, git=git)
    r = lifecycle.get(run["id"])
    # run blocked (recoverable), NOT stranded in a consumed-gate dead-end
    assert r["phase"] == "blocked"
    assert r["blocked_from_phase"] == "building"
    assert r["active"] == 1
    assert tasks.get(tid)["status"] == "blocked"
    # the gate is NOT consumed — it can be re-decided after a retry re-opens things
    g = gates.gate_for(run["id"], "manual_test")
    assert g["status"] == "waiting"
    # retry re-spawns the producing (building) agent
    seen = {}
    def rec(run, phase): seen["phase"] = phase; return ("s2", "a")
    lifecycle.retry(run["id"], spawn=rec, git=FakeGit())
    assert seen["phase"] == "building"
    assert lifecycle.get(run["id"])["phase"] == "building"


def test_merge_approve_git_error_blocks_and_leaves_gate_waiting():
    from tui_pilot import gates
    tid = _setup()
    git = _MergeRaisesGit()
    run = _to_pr_review(tid, git)
    lifecycle.advance(run["id"], phase="pr_review",
                      report='{"findings":[],"summary":"ok"}', spawn=_spawn, git=git)
    lifecycle.decide_gate(run["id"], "merge", "approved", spawn=_spawn, git=git)
    r = lifecycle.get(run["id"])
    assert r["phase"] == "blocked"
    assert r["blocked_from_phase"] == "pr_review"
    assert r["active"] == 1  # not shipped
    assert not r["merge_commit"]
    g = gates.gate_for(run["id"], "merge")
    assert g["status"] == "waiting"  # gate not consumed
    seen = {}
    def rec(run, phase): seen["phase"] = phase; return ("s2", "a")
    lifecycle.retry(run["id"], spawn=rec, git=FakeGit())
    assert seen["phase"] == "pr_review"
    assert lifecycle.get(run["id"])["phase"] == "pr_review"


def test_merge_changes_requested_second_lap_does_not_reopen_pr():
    from tui_pilot import gates
    tid = _setup()
    git = FakeGit()
    # lap 1: reach the merge gate (opens the PR once)
    run = _to_pr_review(tid, git)
    assert git.calls.count(("open_pr",)) == 1
    lifecycle.advance(run["id"], phase="pr_review",
                      report='{"findings":[],"summary":"ok"}', spawn=_spawn, git=git)
    # human requests changes at the merge gate -> back to building
    lifecycle.decide_gate(run["id"], "merge", "changes_requested",
                          comment="fix flaky test", spawn=_spawn, git=git)
    assert lifecycle.get(run["id"])["phase"] == "building"
    # lap 2: builder fixes, tests green -> manual_test gate again
    lifecycle.advance(run["id"], phase="building",
                      report='{"tests":"green","test_guide_path":"docs/tg.md"}',
                      spawn=_spawn, git=git)
    g = gates.gate_for(run["id"], "manual_test")
    assert g["status"] == "waiting"
    # approve manual_test AGAIN — must NOT re-open the (still-open) PR
    lifecycle.decide_gate(run["id"], "manual_test", "approved", spawn=_spawn, git=git)
    r = lifecycle.get(run["id"])
    assert r["phase"] == "pr_review"
    assert r["pr_number"] == 7  # same PR from lap 1
    # open_pr fired exactly ONCE across both laps
    assert git.calls.count(("open_pr",)) == 1


# -- Task 3.6: retry from blocked + shaping no_changes -> blocked -------------

def test_retry_from_blocked_resumes_producing_phase():
    tid = _setup()
    run = _build(tid)
    # drive building to blocked via 3 red reports
    for _ in range(3):
        lifecycle.advance(run["id"], phase="building",
                          report='{"tests":"red","failing":["t1"]}',
                          spawn=_spawn, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "blocked"
    seen = {}
    def rec(run, phase): seen["phase"] = phase; return ("s", "a")
    lifecycle.retry(run["id"], spawn=rec, git=FakeGit())
    assert seen["phase"] == "building"
    assert lifecycle.get(run["id"])["phase"] == "building"
    assert tasks.get(tid)["status"] == "building"


def test_shaping_no_changes_blocks_with_note():
    tid = _setup()
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    lifecycle.advance(run["id"], phase="shaping", report='{"no_changes": true}',
                      spawn=_spawn, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "blocked"
    assert tasks.get(tid)["status"] == "blocked"
    assert any("no changes" in c["body"].lower() for c in tasks.comments(tid))


# -- Idempotency guards (reviewer follow-ups) ---------------------------------

def test_double_merge_approve_ships_once():
    tid = _setup()
    git = FakeGit()
    run = _to_pr_review(tid, git)
    lifecycle.advance(run["id"], phase="pr_review",
                      report='{"findings":[],"summary":"ok"}', spawn=_spawn, git=git)
    merge_git = FakeGit()
    lifecycle.decide_gate(run["id"], "merge", "approved", spawn=_spawn, git=merge_git)
    # a second (racing / double-click) approve must not merge or ship again
    lifecycle.decide_gate(run["id"], "merge", "approved", spawn=_spawn, git=merge_git)
    assert merge_git.calls.count(("merge",)) == 1
    ship_notes = [c for c in tasks.comments(tid)
                  if c["kind"] == "system" and "shipped" in c["body"].lower()]
    assert len(ship_notes) == 1


def test_duplicate_shaping_finish_is_idempotent():
    from tui_pilot import gates, artifacts
    tid = _setup()
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    rpt = '{"spec_path":"docs/s.md","plan_path":"docs/p.md","summary":"ok"}'
    lifecycle.advance(run["id"], phase="shaping", report=rpt,
                      spawn=_spawn, git=FakeGit(), session_id="sess-A")
    lifecycle.advance(run["id"], phase="shaping", report=rpt,
                      spawn=_spawn, git=FakeGit(), session_id="sess-A")
    assert len(artifacts.for_task(tid)) == 2  # spec + plan once, not doubled
    assert len([g for g in gates.waiting_for_project("acme") if g["gate"] == "plan"]) == 1


def test_duplicate_pr_review_finish_is_idempotent():
    from tui_pilot import gates
    tid = _setup()
    git = FakeGit()
    run = _to_pr_review(tid, git)
    rev = FakeGit()
    lifecycle.advance(run["id"], phase="pr_review",
                      report='{"findings":[{"path":"a.py","line":1,"body":"x"}],"summary":"ok"}',
                      spawn=_spawn, git=rev, session_id="sess-R")
    lifecycle.advance(run["id"], phase="pr_review",
                      report='{"findings":[{"path":"a.py","line":1,"body":"x"}],"summary":"ok"}',
                      spawn=_spawn, git=rev, session_id="sess-R")
    assert rev.calls.count(("post_review",)) == 1
    merge_gates = [g for g in gates.waiting_for_project("acme") if g["gate"] == "merge"]
    assert len(merge_gates) == 1


def test_building_self_heal_new_session_not_deduped():
    # each self-heal spawns a NEW agent (new session id) — a fresh session_id is
    # correctly processed even though the phase stays 'building'.
    tid = _setup()
    run = _build(tid)
    lifecycle.advance(run["id"], phase="building",
                      report='{"tests":"red","failing":["t1"]}',
                      spawn=_spawn, git=FakeGit(), session_id="sess-1")
    lifecycle.advance(run["id"], phase="building",
                      report='{"tests":"red","failing":["t1"]}',
                      spawn=_spawn, git=FakeGit(), session_id="sess-2")
    assert lifecycle.get(run["id"])["self_heal_attempts"] == 2


def test_advance_unexpected_phase_posts_defensive_note():
    tid = _setup()
    run = _shape(tid)  # phase is now plan_review
    lifecycle.advance(run["id"], phase="plan_review", report="{}",
                      spawn=_spawn, git=FakeGit())
    assert any(c["kind"] == "system" and "unexpected" in c["body"].lower()
               for c in tasks.comments(tid))


# ---- env watcher ----------------------------------------------------------

class _EnvGit:
    """Records commit_reached_branch calls; returns True only for named branches."""
    def __init__(self, reached):
        self.reached = set(reached)
        self.calls = []
    def commit_reached_branch(self, commit, branch):
        self.calls.append((commit, branch))
        return branch in self.reached


def _shipped_run(tid):
    from tui_pilot import db, lifecycle
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    db.execute("UPDATE lifecycle_runs SET merge_commit='sha', env_dev_at='t', "
               "phase='shipped', active=0 WHERE id=?", (run["id"],))
    return run["id"]


def test_run_env_watch_stamps_staging_and_is_idempotent():
    from tui_pilot import lifecycle, tasks
    tid = _setup()
    run_id = _shipped_run(tid)
    git = _EnvGit(reached={"staging"})  # reaches staging, not prod
    lifecycle.run_env_watch("acme", git)
    run = lifecycle.get(run_id)
    assert run["env_staging_at"] and not run["env_prod_at"]
    notes = [c for c in tasks.comments(tid) if "staging" in (c["body"] or "")]
    assert len(notes) == 1
    # second call: already stamped → no new note, no re-stamp churn
    lifecycle.run_env_watch("acme", git)
    notes2 = [c for c in tasks.comments(tid) if "staging" in (c["body"] or "")]
    assert len(notes2) == 1


def test_run_env_watch_stamps_prod_when_reached():
    from tui_pilot import lifecycle
    tid = _setup()
    run_id = _shipped_run(tid)
    git = _EnvGit(reached={"staging", "main"})  # main is the default prod branch
    lifecycle.run_env_watch("acme", git)
    run = lifecycle.get(run_id)
    assert run["env_staging_at"] and run["env_prod_at"]


def test_projects_with_pending_env():
    from tui_pilot import lifecycle
    tid = _setup()
    assert lifecycle.projects_with_pending_env() == []
    _shipped_run(tid)
    assert lifecycle.projects_with_pending_env() == ["acme"]


def test_start_run_stamps_kind_code_by_default():
    tid = _setup()
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    assert run["kind"] == "code"
    assert run["phase"] == "shaping"


# -- Task 3.2: has_run_for_task (any row, active OR terminal) ------------------

def test_has_run_for_task_matches_any_row():
    tid = _setup()
    assert lifecycle.has_run_for_task(tid) is False
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    assert lifecycle.has_run_for_task(tid) is True
    # still true after the run goes inactive (terminal) — kind stays locked.
    lifecycle._set_run(run["id"], active=0)
    assert lifecycle.active_run_for_task(tid) is None
    assert lifecycle.has_run_for_task(tid) is True
