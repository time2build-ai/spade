"""Per-project git facade for the lifecycle engine.

Binds a persistent working clone (``repo_dir``) + a ``gh`` client to the
``gitops`` free functions, producing the object ``lifecycle.py`` calls
(``prepare_workspace`` / ``open_pr`` / ``post_review`` / ``merge`` /
``commit_reached_branch`` / ``read_at_branch`` / ``promote``).

The persistent clone lives at ``<worktrees_root>/.repo`` and is created on first
use. It is the ``repo_dir`` for every ``gitops`` call: ``prepare_workspace`` adds
worktrees off it, and ``merge`` / ``commit_reached_branch`` / ``read_at_branch``
run in it after worktrees are gone.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import threading

from tui_pilot import gitops, project_git

# Fail-fast, non-interactive SSH for clones: never prompt for a host key or
# passphrase (which would wedge a FastAPI threadpool worker), just error out.
_CLONE_TIMEOUT = 120  # seconds
_GIT_SSH_COMMAND = "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

# One lock per repo_dir so two concurrent first-uses (env-watch tick + a request
# thread) can't both clone the same target.
_clone_locks: dict[str, threading.Lock] = {}
_clone_locks_guard = threading.Lock()


def _lock_for(repo_dir: str) -> threading.Lock:
    with _clone_locks_guard:
        lock = _clone_locks.get(repo_dir)
        if lock is None:
            lock = _clone_locks[repo_dir] = threading.Lock()
        return lock


class _ProjectGit:
    """The object ``spade_server._lifecycle_git(project_id)`` returns."""

    def __init__(self, cfg: dict, *, gh=None):
        self.cfg = cfg
        self.repo_dir = os.path.join(cfg["worktrees_root"], ".repo")
        self._gh = gh or gitops.RealGh(repo_dir=self.repo_dir)

    def _ensure_clone(self) -> None:
        if os.path.isdir(os.path.join(self.repo_dir, ".git")):
            return
        url = self.cfg.get("repo_ssh_url")
        if not url:
            raise gitops.GitError("project_git config is missing repo_ssh_url")
        parent = os.path.dirname(self.repo_dir)
        if parent:
            os.makedirs(parent, exist_ok=True)
        # Serialize concurrent first-uses of the same clone (env-watch tick +
        # request thread) so we neither double-clone nor wedge the target.
        with _lock_for(self.repo_dir):
            if os.path.isdir(os.path.join(self.repo_dir, ".git")):
                return  # another thread cloned it while we waited
            # Clone into a temp dir, then atomically move into place: an
            # interrupted clone never leaves a non-empty target that would
            # permanently fail future clones.
            tmp = tempfile.mkdtemp(prefix=".repo-clone-", dir=parent or None)
            dest = os.path.join(tmp, "repo")
            env = {**os.environ, "GIT_SSH_COMMAND": _GIT_SSH_COMMAND}
            try:
                subprocess.run(
                    ["git", "clone", url, dest],
                    check=True, capture_output=True, text=True,
                    timeout=_CLONE_TIMEOUT, env=env,
                )
                os.replace(dest, self.repo_dir)
            except subprocess.TimeoutExpired as e:
                raise gitops.GitError(
                    f"git clone of {url!r} timed out after {_CLONE_TIMEOUT}s")
            except subprocess.CalledProcessError as e:
                raise gitops.GitError(
                    f"git clone of {url!r} failed: {e.stderr or e}")
            finally:
                shutil.rmtree(tmp, ignore_errors=True)

    # -- engine methods (signatures match lifecycle.py's git.* calls) ---------

    def prepare_workspace(self, cfg=None, task_id=None, slug=None, kind="feat") -> dict:
        self._ensure_clone()
        return gitops.prepare_workspace(
            cfg or self.cfg, task_id, slug, kind=kind, repo_dir=self.repo_dir,
        )

    def open_pr(self, cfg=None, worktree=None, branch=None, base=None,
                title=None, body=None) -> dict:
        self._ensure_clone()
        return gitops.open_pr(
            cfg or self.cfg, worktree, branch, base, title, body, gh=self._gh,
        )

    def post_review(self, pr_number, findings) -> None:
        gitops.post_review(pr_number, findings, gh=self._gh)

    def merge(self, cfg=None, worktree=None, branch=None, pr_number=None,
              method="squash") -> str:
        self._ensure_clone()
        return gitops.merge(
            cfg or self.cfg, worktree, branch, pr_number, gh=self._gh,
            repo_dir=self.repo_dir, method=method,
        )

    def commit_reached_branch(self, commit, branch) -> bool:
        self._ensure_clone()
        return gitops.commit_reached_branch(commit, branch, repo_dir=self.repo_dir)

    def read_at_branch(self, repo_path, branch) -> str:
        self._ensure_clone()
        return gitops.read_at_branch(repo_path, branch, repo_dir=self.repo_dir)

    def promote(self, from_branch, to_branch, title, body) -> dict:
        self._ensure_clone()
        return gitops.promote(
            self.cfg, from_branch, to_branch, title, body,
            repo_dir=self.repo_dir, gh=self._gh,
        )


def for_project(project_id: str, *, gh=None) -> _ProjectGit:
    """Resolve the per-project git facade. Raises if no repo is configured."""
    cfg = project_git.get(project_id)
    if cfg is None:
        raise ValueError(f"no project_git config for {project_id!r}")
    return _ProjectGit(cfg, gh=gh)
