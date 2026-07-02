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
