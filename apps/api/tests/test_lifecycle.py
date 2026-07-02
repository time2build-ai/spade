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
