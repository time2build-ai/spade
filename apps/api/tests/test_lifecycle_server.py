"""Lifecycle HTTP wiring tests: _phase_prompt rendering + endpoints.

Endpoint tests monkeypatch _lifecycle_spawn/_lifecycle_git so no tmux or real
git/gh runs.
"""
from fastapi.testclient import TestClient

from tui_pilot import project_git, projects, spade_server, tasks


# ---- fakes ----------------------------------------------------------------

class FakeGit:
    """Records calls; no real repo needed."""

    def __init__(self):
        self.calls = []

    def prepare_workspace(self, cfg=None, task_id=None, slug=None, kind="feat"):
        self.calls.append(("prepare", task_id))
        return {"branch_name": f"feat/{task_id}-{slug}",
                "worktree_path": f"/wt/{task_id}"}

    def open_pr(self, *a, **k):
        self.calls.append(("open_pr",))
        return {"pr_number": 7, "pr_url": "https://gh/pr/7"}

    def post_review(self, *a, **k):
        self.calls.append(("post_review",))

    def merge(self, *a, **k):
        self.calls.append(("merge",))
        return "sha123"

    def commit_reached_branch(self, commit, branch):
        self.calls.append(("reached", branch))
        return True

    def read_at_branch(self, repo_path, branch):
        return f"content of {repo_path}@{branch}"

    def promote(self, from_branch, to_branch, title, body):
        self.calls.append(("promote", from_branch, to_branch))
        return {"pr_number": 99, "pr_url": "https://gh/pr/99"}


def _fake_spawn(run):
    def spawn(run, phase):
        return (f"sess-{phase}-{run['id']}", "acct")
    return spawn


def _patch(monkeypatch, git=None):
    git = git or FakeGit()
    monkeypatch.setattr(spade_server, "_lifecycle_spawn", _fake_spawn)
    monkeypatch.setattr(spade_server, "_lifecycle_git", lambda pid: git)
    return git


def _project():
    projects.create(id="acme", name="Acme", path="/w")
    project_git.upsert("acme", repo_ssh_url="git@github.com:acme/app.git",
                       worktrees_root="/tmp/wt")


# ---- _phase_prompt smoke --------------------------------------------------

def test_phase_prompt_renders_shaping():
    _project()
    tid = tasks.create(project_id="acme", title="Build X")["id"]
    run = {"id": "r1", "task_id": tid, "project_id": "acme",
           "worktree_path": "/wt/x", "branch_name": "feat/x"}
    prompt = spade_server._phase_prompt(run, "shaping")
    assert prompt
    assert "brainstorming" in prompt
    assert "spec_path" in prompt and "plan_path" in prompt


def test_phase_prompt_includes_resume_comment():
    _project()
    tid = tasks.create(project_id="acme", title="Build X")["id"]
    run = {"id": "r1", "task_id": tid, "project_id": "acme",
           "worktree_path": "/wt/x", "branch_name": "feat/x",
           "resume_comment": "please tighten the plan"}
    prompt = spade_server._phase_prompt(run, "building")
    assert "please tighten the plan" in prompt
    assert "executing-plans" in prompt and "tests" in prompt


# ---- endpoint tests -------------------------------------------------------

def test_lifecycle_start_and_get(monkeypatch):
    git = _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "Build X"}).json()["id"]
    r = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid})
    assert r.status_code == 200
    run = r.json()
    assert run["phase"] == "shaping"
    assert ("prepare", tid) in git.calls
    # get + list
    assert c.get(f"/lifecycle/{run['id']}").json()["id"] == run["id"]
    assert c.get("/lifecycle?project_id=acme").json()["runs"][0]["id"] == run["id"]


def test_lifecycle_start_404_without_repo(monkeypatch):
    _patch(monkeypatch)
    projects.create(id="acme", name="Acme", path="/w")  # no project_git repo
    from tui_pilot.server import app
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    assert c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid}).status_code == 404


def test_gate_approve_advances_plan(monkeypatch):
    _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    from tui_pilot import lifecycle
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    run = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid}).json()
    # drive shaping -> plan_review so a plan gate exists
    lifecycle.advance(run["id"], phase="shaping",
                      report='{"spec_path":"docs/s.md","plan_path":"docs/p.md"}',
                      spawn=_fake_spawn(run), git=FakeGit(), session_id="sess-shaping")
    r = c.post(f"/tasks/{tid}/gates/plan/approve", json={"comment": "lgtm"})
    assert r.status_code == 200
    assert r.json()["phase"] == "building"


def test_gate_request_changes(monkeypatch):
    _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    from tui_pilot import lifecycle
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    run = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid}).json()
    lifecycle.advance(run["id"], phase="shaping",
                      report='{"spec_path":"s","plan_path":"p"}',
                      spawn=_fake_spawn(run), git=FakeGit(), session_id="sess-shaping")
    r = c.post(f"/tasks/{tid}/gates/plan/request-changes", json={"comment": "redo"})
    assert r.status_code == 200
    assert r.json()["phase"] == "shaping"


def test_gate_no_active_run_404(monkeypatch):
    _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    assert c.post(f"/tasks/{tid}/gates/plan/approve", json={}).status_code == 404


def test_artifacts_list_and_content(monkeypatch):
    _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    from tui_pilot import artifacts, lifecycle
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    run = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid}).json()
    art = artifacts.register(tid, run["id"], "spec", "Spec", "docs/s.md",
                             "feat/x", by="shaping")
    listed = c.get(f"/tasks/{tid}/artifacts").json()["artifacts"]
    assert any(a["id"] == art["id"] for a in listed)
    content = c.get(f"/tasks/{tid}/artifacts/{art['id']}/content").json()["content"]
    assert "docs/s.md" in content  # FakeGit.read_at_branch echoes the path


def test_project_git_get_put(monkeypatch):
    _patch(monkeypatch)
    projects.create(id="acme", name="Acme", path="/w")
    from tui_pilot.server import app
    c = TestClient(app)
    r = c.put("/projects/acme/git", json={"repo_ssh_url": "git@github.com:a/b.git"})
    assert r.status_code == 200 and r.json()["repo_ssh_url"] == "git@github.com:a/b.git"
    assert c.get("/projects/acme/git").json()["dev_branch"] == "development"


def test_retry_endpoint(monkeypatch):
    _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    from tui_pilot import lifecycle
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    run = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid}).json()
    # block it via an unparseable shaping report
    lifecycle.advance(run["id"], phase="shaping", report="not json",
                      spawn=_fake_spawn(run), git=FakeGit(), session_id="sess-shaping")
    assert lifecycle.get(run["id"])["phase"] == "blocked"
    r = c.post(f"/lifecycle/{run['id']}/retry")
    assert r.status_code == 200 and r.json()["phase"] == "shaping"


def test_fanout_retry_and_drop_endpoints(monkeypatch):
    _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    from tui_pilot import db, fanout, lifecycle, tasks
    from tui_pilot import lifecycle_templates as LT
    c = TestClient(app)
    # register a synthetic fan-out kind for this test
    LT.LIFECYCLE_TEMPLATES["_srv"] = {
        "terminal_status": "delivered", "needs_workspace": False,
        "phases": [
            {"name": "scoping", "agent": True, "fanout": False, "gate": None, "column": "Planning"},
            {"name": "investigating", "agent": True, "fanout": True, "gate": None, "column": "In progress"},
            {"name": "synthesis", "agent": True, "fanout": False, "gate": None, "column": "Review"},
            {"name": "delivered", "agent": False, "fanout": False, "gate": None, "column": "Done"},
        ],
        "gate_advances": {},
    }
    LT.transition_pairs.cache_clear()
    try:
        tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
        db.execute("UPDATE tasks SET kind='_srv' WHERE id=?", (tid,))
        run = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid}).json()
        rid = run["id"]
        lifecycle.enter_fanout(lifecycle.get(rid), "investigating",
                               angles=["a", "b"], spawn=_fake_spawn(run), git=FakeGit())
        # block angle 0, then retry it via the endpoint (re-spawn)
        fanout.block(rid, "investigating", 0)
        r = c.post(f"/lifecycle/{rid}/fanout/0/retry")
        assert r.status_code == 200
        assert fanout.get_row(rid, "investigating", 0)["status"] == "running"
        # finish angle 0, drop angle 1 → barrier releases to synthesis
        lifecycle.advance_fanout(rid, "investigating", 0, report='{}',
                                 spawn=_fake_spawn(run), git=FakeGit())
        r = c.post(f"/lifecycle/{rid}/fanout/1/drop")
        assert r.status_code == 200 and r.json()["phase"] == "synthesis"
    finally:
        LT.LIFECYCLE_TEMPLATES.pop("_srv", None)
        LT.transition_pairs.cache_clear()


def test_gates_and_releases_and_promote(monkeypatch):
    git = _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    from tui_pilot import lifecycle, db
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    run = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid}).json()
    lifecycle.advance(run["id"], phase="shaping",
                      report='{"spec_path":"s","plan_path":"p"}',
                      spawn=_fake_spawn(run), git=FakeGit(), session_id="sess-shaping")
    # a waiting plan gate now exists
    assert c.get("/projects/acme/gates").json()["gates"][0]["gate"] == "plan"
    # simulate a shipped run sitting on dev
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    db.execute("UPDATE lifecycle_runs SET merge_commit='sha', env_dev_at=? WHERE id=?",
               (now, run["id"]))
    lanes = c.get("/projects/acme/releases").json()["releases"]
    assert any(r["run_id"] == run["id"] for r in lanes["dev"])
    pr = c.post("/projects/acme/promote", json={"from_env": "dev", "to_env": "staging"})
    assert pr.status_code == 200 and pr.json()["pr_number"] == 99
    assert ("promote", "development", "staging") in git.calls


def test_promote_git_error_returns_409(monkeypatch):
    git = _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    from tui_pilot import lifecycle, db, gitops
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "X"}).json()["id"]
    run = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid}).json()
    # a shipped run sitting on dev so there is something to promote
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    db.execute("UPDATE lifecycle_runs SET merge_commit='sha', env_dev_at=? WHERE id=?",
               (now, run["id"]))

    def _boom(*a, **k):
        raise gitops.GitError("gh pr create: branch protection")
    monkeypatch.setattr(git, "promote", _boom)
    r = c.post("/projects/acme/promote", json={"from_env": "dev", "to_env": "staging"})
    assert r.status_code == 409
    assert "branch protection" in r.json()["detail"]


def test_promote_empty_returns_409(monkeypatch):
    git = _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    c = TestClient(app)
    # no shipped runs → nothing sits in dev awaiting staging
    r = c.post("/projects/acme/promote", json={"from_env": "dev", "to_env": "staging"})
    assert r.status_code == 409
    assert not any(call and call[0] == "promote" for call in git.calls)


# ---- Task 3.2: routing / kind endpoints -----------------------------------

def test_create_task_populates_kind_suggestion():
    projects.create(id="acme", name="Acme", path="/w")
    from tui_pilot.server import app
    c = TestClient(app)
    t = c.post("/tasks", json={"project_id": "acme",
                               "title": "Investigate auth perf"}).json()
    assert t["kind"] is None
    assert t["kind_suggested"] == "research"
    assert isinstance(t["kind_reason"], str) and t["kind_reason"]


def test_route_untyped_tags_all_null_kind_tasks():
    projects.create(id="acme", name="Acme", path="/w")
    from tui_pilot.server import app
    c = TestClient(app)
    a = c.post("/tasks", json={"project_id": "acme", "title": "Write the SOW"}).json()
    b = c.post("/tasks", json={"project_id": "acme", "title": "Add a toggle"}).json()
    # confirm one so it already has a kind and is skipped by the batch
    c.post(f"/tasks/{b['id']}/kind", json={"kind": "code"})
    r = c.post("/projects/acme/route-untyped")
    assert r.status_code == 200
    body = r.json()
    assert body["routed"] >= 1
    assert c.get(f"/tasks/{a['id']}").json()["kind_suggested"] == "docs"


def test_confirm_kind_sets_kind_then_409_after_run(monkeypatch):
    _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "Add a toggle"}).json()["id"]
    # code is a REGISTERED (runnable) kind → confirm succeeds
    r = c.post(f"/tasks/{tid}/kind", json={"kind": "code"})
    assert r.status_code == 200
    assert c.get(f"/tasks/{tid}").json()["kind"] == "code"
    c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid})
    # now kind is locked → 409 (lock takes precedence over the runnable guard)
    r2 = c.post(f"/tasks/{tid}/kind", json={"kind": "research"})
    assert r2.status_code == 409 and "detail" in r2.json()


def test_confirm_kind_unknown_task_404():
    from tui_pilot.server import app
    c = TestClient(app)
    assert c.post("/tasks/SPD-999/kind", json={"kind": "code"}).status_code == 404


def test_confirm_unregistered_kind_400_not_500(monkeypatch):
    # A valid KIND with no registered template must confirm as a clean 400 ("not
    # yet runnable"), never a 500 (a KeyError from template_for()). All real kinds
    # (code/research/docs) now run, so we inject a SYNTHETIC kind into KINDS with
    # NO template registered to prove the guard in isolation (do NOT weaken it).
    _patch(monkeypatch)
    _project()
    monkeypatch.setattr(tasks, "KINDS", tasks.KINDS + ["_ghost"])
    from tui_pilot.server import app
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "Add a toggle"}).json()["id"]
    r = c.post(f"/tasks/{tid}/kind", json={"kind": "_ghost"})
    assert r.status_code == 400 and "runnable" in r.json()["detail"]


def test_start_unregistered_kind_400_not_500(monkeypatch):
    # The 500 repro path: a task whose kind_suggested is a valid KIND with no
    # registered template → start resolves that kind → the template lookup must NOT
    # surface a KeyError as a 500. All real kinds now run, so we inject a SYNTHETIC
    # kind (in KINDS, no template) as the suggestion to prove the guard in isolation.
    _patch(monkeypatch)
    _project()
    monkeypatch.setattr(tasks, "KINDS", tasks.KINDS + ["_ghost"])
    from tui_pilot.server import app
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme",
                                 "title": "Add a toggle"}).json()["id"]
    tasks.set_suggestion(tid, "_ghost", "synthetic unregistered kind")
    assert c.get(f"/tasks/{tid}").json()["kind_suggested"] == "_ghost"
    r = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid})
    assert r.status_code == 400 and "runnable" in r.json()["detail"]
    # code still starts fine
    tid2 = c.post("/tasks", json={"project_id": "acme", "title": "Add a toggle"}).json()["id"]
    assert c.post("/lifecycle/start",
                  json={"project_id": "acme", "task_id": tid2}).status_code == 200


def test_confirm_rejects_bad_doc_template(monkeypatch):
    _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "Add a toggle"}).json()["id"]
    # doc_template on a non-docs kind → 400
    r = c.post(f"/tasks/{tid}/kind", json={"kind": "code", "doc_template": "sow"})
    assert r.status_code == 400 and "doc_template" in r.json()["detail"]
    # invalid doc_template value (even with kind=docs) → 400 (fires before the
    # not-yet-runnable guard, so we see the doc_template message)
    r2 = c.post(f"/tasks/{tid}/kind", json={"kind": "docs", "doc_template": "bogus"})
    assert r2.status_code == 400 and "doc_template" in r2.json()["detail"]


def test_start_no_workspace_kind_does_not_require_repo(monkeypatch):
    # The repo hard-requirement is KIND-CONDITIONAL: a kind whose template says
    # needs_workspace=False must NOT require a configured repo. The REAL research/
    # docs templates land in Chunks 4/5; here we inject a SYNTHETIC no-workspace
    # kind (mirroring Chunk 2's fan-out test) to prove the conditional in isolation
    # — then clean it up so it never persists.
    from tui_pilot import lifecycle_templates
    git = _patch(monkeypatch)
    projects.create(id="acme", name="Acme", path="/w")  # NO repo configured
    from tui_pilot.server import app
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "Look into caching"}).json()["id"]
    # confirm the task onto the synthetic kind (reuse the real 'research' KIND slot,
    # whose template we inject below). scoping is already a valid task STATUS.
    lifecycle_templates.LIFECYCLE_TEMPLATES["research"] = {
        "terminal_status": "delivered",
        "needs_workspace": False,
        "phases": [{"name": "scoping", "agent": True, "fanout": False,
                    "gate": None, "column": "Planning"}],
        "gate_advances": {},
    }
    lifecycle_templates.transition_pairs.cache_clear()
    try:
        c.post(f"/tasks/{tid}/kind", json={"kind": "research"})
        r = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid})
        assert r.status_code == 200, r.text
        run = r.json()
        assert run["kind"] == "research" and run["phase"] == "scoping"
        assert c.get(f"/tasks/{tid}").json()["kind"] == "research"
        # needs_workspace False → git.prepare_workspace is NOT called
        assert not any(call[0] == "prepare" for call in git.calls)
    finally:
        del lifecycle_templates.LIFECYCLE_TEMPLATES["research"]
        lifecycle_templates.transition_pairs.cache_clear()


def test_start_code_kind_still_requires_repo(monkeypatch):
    # The other half of the conditional: code needs_workspace=True → still 404s
    # without a configured repo.
    _patch(monkeypatch)
    projects.create(id="acme", name="Acme", path="/w")  # NO repo
    from tui_pilot.server import app
    c = TestClient(app)
    tid = c.post("/tasks", json={"project_id": "acme", "title": "Add a toggle"}).json()["id"]
    r = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid})
    assert r.status_code == 404


def test_start_writes_resolved_kind_default_code(monkeypatch):
    _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    c = TestClient(app)
    # a plain code title with kind_suggested=code
    tid = c.post("/tasks", json={"project_id": "acme", "title": "Add a toggle"}).json()["id"]
    r = c.post("/lifecycle/start", json={"project_id": "acme", "task_id": tid})
    assert r.status_code == 200
    assert r.json()["kind"] == "code"
    assert c.get(f"/tasks/{tid}").json()["kind"] == "code"
