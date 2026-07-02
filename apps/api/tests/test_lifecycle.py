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
