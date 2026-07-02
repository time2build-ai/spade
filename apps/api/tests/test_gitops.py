import subprocess
from pathlib import Path
import pytest
from tui_pilot import gitops


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True,
                   capture_output=True, text=True)


@pytest.fixture
def origin_and_clone(tmp_path):
    """A bare origin with a 'development' branch + a working clone."""
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "--bare", "-b", "development", str(origin)], check=True)
    work = tmp_path / "work"
    _git(tmp_path, "clone", str(origin), str(work))
    _git(work, "config", "user.email", "t@t.io")
    _git(work, "config", "user.name", "T")
    (work / "README.md").write_text("hi\n")
    _git(work, "add", "."); _git(work, "commit", "-m", "init")
    _git(work, "push", "origin", "development")
    return {"origin": str(origin), "work": str(work), "root": str(tmp_path)}


def test_prepare_workspace_creates_branch_and_worktree(origin_and_clone, tmp_path):
    cfg = {
        "worktrees_root": str(tmp_path / "wt"),
        "dev_branch": "development",
    }
    ws = gitops.prepare_workspace(
        cfg, task_id="SPD-014", slug="crear-tarea", kind="feat",
        repo_dir=origin_and_clone["work"],
    )
    assert ws["branch_name"] == "feat/SPD-014-crear-tarea"
    assert Path(ws["worktree_path"]).is_dir()
    # the new branch is checked out in the worktree
    head = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                          cwd=ws["worktree_path"], capture_output=True, text=True).stdout.strip()
    assert head == "feat/SPD-014-crear-tarea"


class FakeGh:
    def __init__(self): self.prs = []; self.comments = []; self.merged = []
    def create_pr(self, cwd, base, head, title, body):
        n = len(self.prs) + 42; self.prs.append((base, head, title))
        return {"number": n, "url": f"https://gh/pr/{n}"}
    def comment(self, cwd, pr_number, path, line, body):
        self.comments.append((pr_number, path, line, body))
    def merge(self, cwd, pr_number, method="squash"):
        self.merged.append((pr_number, method)); return "deadbeef"


def test_open_pr_returns_number_and_url(origin_and_clone, tmp_path):
    cfg = {"worktrees_root": str(tmp_path/"wt"), "dev_branch": "development"}
    ws = gitops.prepare_workspace(cfg, "SPD-1", "x", repo_dir=origin_and_clone["work"])
    # make a commit on the branch so there's something to PR
    (Path(ws["worktree_path"])/"f.txt").write_text("x")
    _git(ws["worktree_path"], "add", "."); _git(ws["worktree_path"], "commit", "-m", "w")
    gh = FakeGh()
    pr = gitops.open_pr(cfg, ws["worktree_path"], ws["branch_name"], "development",
                        "Title", "Body", gh=gh)
    assert pr["pr_number"] == 42 and pr["pr_url"].endswith("/42")


def test_post_review_forwards_each_finding(tmp_path):
    gh = FakeGh()
    findings = [{"path": "a.py", "line": 3, "body": "nit"},
                {"path": "b.py", "line": 9, "body": "bug"}]
    gitops.post_review(42, findings, gh=gh)
    assert len(gh.comments) == 2 and gh.comments[0][0] == 42


def test_merge_returns_sha_and_cleans_up(origin_and_clone, tmp_path):
    cfg = {"worktrees_root": str(tmp_path/"wt"), "dev_branch": "development"}
    ws = gitops.prepare_workspace(cfg, "SPD-2", "y", repo_dir=origin_and_clone["work"])
    gh = FakeGh()
    # NOTE: the feature branch was never pushed to origin in this test, so merge's
    # remote-branch delete must tolerate a missing remote ref (see Step 3).
    sha = gitops.merge(cfg, ws["worktree_path"], ws["branch_name"], 42, gh=gh,
                       repo_dir=origin_and_clone["work"])
    assert sha == "deadbeef"
    assert not Path(ws["worktree_path"]).exists()  # worktree removed


def test_commit_reached_branch_true_after_push(origin_and_clone):
    work = origin_and_clone["work"]
    (Path(work)/"g.txt").write_text("g"); _git(work, "add", "."); _git(work, "commit", "-m", "g")
    sha = subprocess.run(["git","rev-parse","HEAD"], cwd=work, capture_output=True, text=True).stdout.strip()
    _git(work, "push", "origin", "development")
    _git(work, "fetch", "origin")
    assert gitops.commit_reached_branch(sha, "development", repo_dir=work) is True


def test_commit_reached_branch_false_for_unknown_ref(origin_and_clone):
    work = origin_and_clone["work"]
    sha = subprocess.run(["git","rev-parse","HEAD"], cwd=work, capture_output=True, text=True).stdout.strip()
    assert gitops.commit_reached_branch(sha, "nonexistent", repo_dir=work) is False


def test_read_at_branch_returns_file_contents(origin_and_clone):
    work = origin_and_clone["work"]
    (Path(work)/"docs").mkdir(exist_ok=True); (Path(work)/"docs"/"x.md").write_text("hello guide")
    _git(work, "add", "."); _git(work, "commit", "-m", "doc"); _git(work, "push", "origin", "development")
    _git(work, "fetch", "origin")
    assert "hello guide" in gitops.read_at_branch("docs/x.md", "development", repo_dir=work)


def test_promote_returns_pr_from_gh(tmp_path):
    gh = FakeGh()
    cfg = {"dev_branch": "development"}
    pr = gitops.promote(cfg, "feat/x", "development", "T", "B",
                        repo_dir=str(tmp_path), gh=gh)
    assert pr["pr_number"] == 42 and pr["pr_url"].endswith("/42")
    assert gh.prs[0] == ("development", "feat/x", "T")


def test_realgh_create_pr_builds_expected_argv(monkeypatch):
    calls = []
    class R: returncode = 0; stdout = "https://github.com/o/r/pull/7\n"; stderr = ""
    monkeypatch.setattr(gitops.subprocess, "run", lambda *a, **k: calls.append(a[0]) or R())
    gitops.RealGh().create_pr("/w", "development", "feat/x", "T", "B")
    argv = calls[-1]
    assert argv[:3] == ["gh", "pr", "create"] and "--base" in argv and "development" in argv
