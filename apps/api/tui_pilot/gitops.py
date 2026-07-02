"""Git / GitHub operations behind a thin, fakeable interface.

All `git` calls go through a `GitRunner` (real subprocess) that executes in a
given cwd; all `gh` (GitHub) calls go through a `GhClient` (protocol) so tests
can inject a fake and avoid the network. `RealGh` shells out to the `gh` CLI
via a module-level `subprocess` reference so tests can monkeypatch it.
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Protocol


class GitError(Exception):
    """Raised when a git command exits nonzero; carries stderr."""


class GitRunner:
    """Runs `git` in a fixed cwd."""

    def __init__(self, cwd: str):
        self.cwd = cwd

    def run(self, *args: str) -> str:
        """Run `git <args>`; return stdout. Raise GitError(stderr) on nonzero."""
        result = subprocess.run(
            ["git", *args], cwd=self.cwd, capture_output=True, text=True
        )
        if result.returncode != 0:
            raise GitError(result.stderr)
        return result.stdout

    def run_code(self, *args: str) -> int:
        """Run `git <args>`; return the exit code without raising."""
        result = subprocess.run(
            ["git", *args], cwd=self.cwd, capture_output=True, text=True
        )
        return result.returncode


class GhClient(Protocol):
    def create_pr(self, cwd: str, base: str, head: str, title: str, body: str) -> dict: ...
    def comment(self, cwd: str, pr_number: int, path: str, line: int, body: str) -> None: ...
    def merge(self, cwd: str, pr_number: int, method: str = "squash") -> str: ...


def _slugify(text: str) -> str:
    """Lowercase, ascii-ish, dash-separated slug."""
    text = (text or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def prepare_workspace(cfg: dict, task_id: str, slug: str, kind: str = "feat", *,
                      repo_dir: str, runner_factory=GitRunner) -> dict:
    """Create a feature branch + worktree off origin/<dev_branch>.

    Returns {"branch_name", "worktree_path"}.
    """
    runner = runner_factory(repo_dir)
    dev = cfg.get("dev_branch", "development")
    branch = f"{kind}/{task_id}-{_slugify(slug)}"
    wt = os.path.join(cfg.get("worktrees_root"), task_id)
    runner.run("fetch", "origin", dev)
    runner.run("worktree", "add", "-b", branch, wt, f"origin/{dev}")
    return {"branch_name": branch, "worktree_path": wt}


def open_pr(cfg: dict, worktree: str, branch: str, base: str, title: str, body: str, *,
            gh: GhClient, runner_factory=GitRunner) -> dict:
    """Push the branch, open a PR via gh. Returns {"pr_number", "pr_url"}."""
    runner_factory(worktree).run("push", "-u", "origin", branch)
    res = gh.create_pr(worktree, base, branch, title, body)
    return {"pr_number": res["number"], "pr_url": res["url"]}


def post_review(pr_number: int, findings: list[dict], *, gh: GhClient) -> None:
    """Forward each finding as an inline PR comment."""
    for f in findings:
        gh.comment(None, pr_number, f["path"], f["line"], f["body"])


def merge(cfg: dict, worktree: str, branch: str, pr_number: int, *, gh: GhClient,
          repo_dir: str, method: str = "squash", runner_factory=GitRunner) -> str:
    """Merge the PR (via gh), then clean up worktree + local/remote branch.

    Returns the merge-commit sha. Cleanup runs from the MAIN clone (repo_dir)
    because the worktree is removed here. The remote-branch delete tolerates a
    missing remote ref. Ends with a `fetch origin` so origin/<dev_branch>
    reflects the just-landed commit.
    """
    sha = gh.merge(worktree, pr_number, method)
    runner = runner_factory(repo_dir)
    runner.run("worktree", "remove", "--force", worktree)
    runner.run("branch", "-D", branch)
    # remote ref may not exist (fake path never pushed it; real path relies on
    # gh pr merge --delete-branch) — tolerate a nonzero exit.
    runner.run_code("push", "origin", "--delete", branch)
    runner.run_code("fetch", "origin")
    return sha


def commit_reached_branch(commit: str, branch: str, *, repo_dir: str,
                          runner_factory=GitRunner) -> bool:
    """True if `commit` is an ancestor of origin/<branch>."""
    runner = runner_factory(repo_dir)
    if runner.run_code("rev-parse", "--verify", f"origin/{branch}") != 0:
        return False
    return runner.run_code("merge-base", "--is-ancestor", commit, f"origin/{branch}") == 0


def read_at_branch(repo_path: str, branch: str, *, repo_dir: str,
                   runner_factory=GitRunner) -> str:
    """Return the contents of `repo_path` at origin/<branch>."""
    return runner_factory(repo_dir).run("show", f"origin/{branch}:{repo_path}")


def promote(cfg: dict, from_branch: str, to_branch: str, title: str, body: str, *,
            repo_dir: str, gh: GhClient) -> dict:
    """Open a PR promoting from_branch -> to_branch. Returns {pr_number, pr_url}."""
    res = gh.create_pr(repo_dir, to_branch, from_branch, title, body)
    return {"pr_number": res["number"], "pr_url": res["url"]}


class RealGh:
    """Real GitHub client shelling out to the `gh` CLI.

    Inline anchoring is deferred: `comment` uses `gh pr comment {n} --body`,
    embedding the path:line prefix in the body.
    """

    def create_pr(self, cwd: str, base: str, head: str, title: str, body: str) -> dict:
        result = subprocess.run(
            ["gh", "pr", "create", "--base", base, "--head", head,
             "--title", title, "--body", body],
            cwd=cwd, capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise GitError(result.stderr)
        url = result.stdout.strip().splitlines()[-1].strip()
        number = int(url.rstrip("/").rsplit("/", 1)[-1])
        return {"number": number, "url": url}

    def comment(self, cwd: str, pr_number: int, path: str, line: int, body: str) -> None:
        text = f"`{path}:{line}` — {body}"
        result = subprocess.run(
            ["gh", "pr", "comment", str(pr_number), "--body", text],
            cwd=cwd, capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise GitError(result.stderr)

    def merge(self, cwd: str, pr_number: int, method: str = "squash") -> str:
        merge_result = subprocess.run(
            ["gh", "pr", "merge", str(pr_number), f"--{method}", "--delete-branch"],
            cwd=cwd, capture_output=True, text=True,
        )
        if merge_result.returncode != 0:
            raise GitError(merge_result.stderr)
        view = subprocess.run(
            ["gh", "pr", "view", str(pr_number), "--json", "mergeCommit"],
            cwd=cwd, capture_output=True, text=True,
        )
        if view.returncode != 0:
            raise GitError(view.stderr)
        import json
        data = json.loads(view.stdout or "{}")
        return (data.get("mergeCommit") or {}).get("oid", "")
