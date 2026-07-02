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
