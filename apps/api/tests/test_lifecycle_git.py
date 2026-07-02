"""Tests for the _lifecycle_git facade (offline: a local bare repo stands in as
the 'ssh url', a FakeGh replaces the network gh client)."""
import subprocess
from pathlib import Path

from tui_pilot import lifecycle_git, project_git, projects


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


class FakeGh:
    def __init__(self):
        self.prs = []
        self.comments = []
        self.merged = []

    def create_pr(self, cwd, base, head, title, body):
        n = len(self.prs) + 42
        self.prs.append((base, head, title))
        return {"number": n, "url": f"https://gh/pr/{n}"}

    def comment(self, cwd, pr_number, path, line, body):
        self.comments.append((pr_number, path, line, body))

    def merge(self, cwd, pr_number, method="squash"):
        self.merged.append((pr_number, method))
        return "deadbeef"


def _origin(tmp_path) -> str:
    """A bare origin with a 'development' branch containing one commit."""
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "--bare", "-b", "development", str(origin)], check=True)
    work = tmp_path / "seed"
    _git(tmp_path, "clone", str(origin), str(work))
    _git(work, "config", "user.email", "t@t.io")
    _git(work, "config", "user.name", "T")
    (work / "README.md").write_text("hi\n")
    _git(work, "add", ".")
    _git(work, "commit", "-m", "init")
    _git(work, "push", "origin", "development")
    return str(origin)


def _project(tmp_path):
    projects.create(id="acme", name="Acme", path="/w")
    project_git.upsert(
        "acme",
        repo_ssh_url=_origin(tmp_path),
        worktrees_root=str(tmp_path / "wt"),
    )


def test_for_project_prepares_workspace_and_clones_persistent_repo(tmp_path):
    _project(tmp_path)
    git = lifecycle_git.for_project("acme", gh=FakeGh())
    ws = git.prepare_workspace(task_id="SPD-9", slug="x")
    assert ws["branch_name"] == "feat/SPD-9-x"
    assert Path(ws["worktree_path"]).is_dir()
    # the persistent clone now exists at <worktrees_root>/.repo
    assert (Path(tmp_path) / "wt" / ".repo" / ".git").is_dir()


def test_for_project_engine_positional_signature(tmp_path):
    """The engine calls prepare_workspace(cfg, task_id, slug, kind=...) positionally."""
    _project(tmp_path)
    cfg = project_git.get("acme")
    git = lifecycle_git.for_project("acme", gh=FakeGh())
    ws = git.prepare_workspace(cfg, "SPD-10", "y", kind="feat")
    assert ws["branch_name"] == "feat/SPD-10-y"


def test_open_pr_and_read_at_branch(tmp_path):
    _project(tmp_path)
    gh = FakeGh()
    git = lifecycle_git.for_project("acme", gh=gh)
    ws = git.prepare_workspace(task_id="SPD-11", slug="z")
    wt = Path(ws["worktree_path"])
    (wt / "docs").mkdir()
    (wt / "docs" / "spec.md").write_text("the spec body")
    _git(wt, "config", "user.email", "t@t.io")
    _git(wt, "config", "user.name", "T")
    _git(wt, "add", ".")
    _git(wt, "commit", "-m", "spec")
    pr = git.open_pr(None, ws["worktree_path"], ws["branch_name"], "development",
                     "T", "B")
    assert pr["pr_number"] == 42
    # branch is now pushed; reading the file at the branch works from the clone
    assert "the spec body" in git.read_at_branch("docs/spec.md", ws["branch_name"])


def test_for_project_unknown_project_raises():
    import pytest
    with pytest.raises(ValueError):
        lifecycle_git.for_project("nope")
