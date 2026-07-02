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


def test_promote_empty_returns_409(monkeypatch):
    git = _patch(monkeypatch)
    _project()
    from tui_pilot.server import app
    c = TestClient(app)
    # no shipped runs → nothing sits in dev awaiting staging
    r = c.post("/projects/acme/promote", json={"from_env": "dev", "to_env": "staging"})
    assert r.status_code == 409
    assert not any(call and call[0] == "promote" for call in git.calls)
