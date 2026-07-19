"""Git / GitHub operations behind a thin, fakeable interface.

All `git` calls go through a `GitRunner` (real subprocess) that executes in a
given cwd; all `gh` (GitHub) calls go through a `GhClient` (protocol) so tests
can inject a fake and avoid the network. `RealGh` shells out to the `gh` CLI
via a module-level `subprocess` reference so tests can monkeypatch it.
"""

from __future__ import annotations

import json
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


def list_remote_branches(repo_ssh_url: str, *, runner_factory=GitRunner) -> list[str]:
    """List a remote's branch names via ``git ls-remote --heads`` — no clone, no
    working copy. Lets the settings UI offer a picklist for dev/staging/prod
    instead of free-text. Raises ``GitError`` on an empty URL or a git failure
    (bad URL / no access / git missing)."""
    url = (repo_ssh_url or "").strip()
    if not url:
        raise GitError("repo_ssh_url is empty")
    out = runner_factory(".").run("ls-remote", "--heads", url)
    branches = []
    for line in out.splitlines():
        ref = line.split("\t")[-1].strip()
        prefix = "refs/heads/"
        if ref.startswith(prefix):
            branches.append(ref[len(prefix):])
    return sorted(set(branches))


def create_remote_branches(repo_ssh_url: str, branch_names: list[str], *,
                           runner_factory=GitRunner) -> list[str]:
    """Create ``branch_names`` on a remote that has none yet (a fresh/empty repo).

    Clones into a temp dir; if the repo has no commit, makes a minimal initial
    commit; then creates each branch off that base and pushes it. Existing
    branches are left as-is. Returns the branch names now on the remote. Raises
    ``GitError`` on an empty URL / no names / any git failure. Side-effectful:
    this pushes to the user's remote (their explicit request)."""
    import os
    import shutil
    import tempfile

    url = (repo_ssh_url or "").strip()
    seen: set[str] = set()
    names = [n.strip() for n in branch_names if n and n.strip()]
    names = [n for n in names if not (n in seen or seen.add(n))]  # de-dup, keep order
    if not url:
        raise GitError("repo_ssh_url is empty")
    if not names:
        raise GitError("no branch names given")

    tmp = tempfile.mkdtemp(prefix="spade-branches-")
    try:
        runner_factory(tmp).run("clone", url, "repo")  # empty repo clones with a warning (rc 0)
        repo = os.path.join(tmp, "repo")
        r = runner_factory(repo)
        if r.run_code("rev-parse", "HEAD") != 0:
            # No commit yet — seed one so branches have something to point at.
            r.run("checkout", "-b", names[0])
            with open(os.path.join(repo, "README.md"), "w") as f:
                f.write("# Repository\n\nInitialized by Spade.\n")
            r.run("add", "README.md")
            r.run("-c", "user.email=spade@localhost", "-c", "user.name=Spade",
                  "commit", "-m", "Initial commit")
            r.run("push", "-u", "origin", names[0])
            base = names[0]
        else:
            base = r.run("rev-parse", "--abbrev-ref", "HEAD").strip()
        for n in names:
            if n == base:
                continue
            r.run_code("branch", n, base)  # create locally (no-op if it already exists)
            r.run("push", "-u", "origin", n)
        return names
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


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
    worktrees_root = cfg.get("worktrees_root")
    if not worktrees_root:
        raise GitError("prepare_workspace: cfg is missing required 'worktrees_root'")
    wt = os.path.join(worktrees_root, task_id)
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
    missing remote ref. Ends with a plain `fetch origin` so the clone's remote
    refs (including origin/<dev_branch>) reflect the just-landed commit.
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


def _pr_number_from_url(url: str) -> int:
    """Parse the numeric PR id from a `gh pr create` URL, ignoring any
    trailing query/fragment (e.g. '.../pull/7?foo#bar')."""
    tail = url.rstrip("/").rsplit("/", 1)[-1]
    m = re.search(r"\d+", tail)
    if not m:
        raise GitError(f"could not parse PR number from gh output: {url!r}")
    return int(m.group())


def commit_reached_branch(commit: str, branch: str, *, repo_dir: str,
                          runner_factory=GitRunner) -> bool:
    """True if `commit` is an ancestor of origin/<branch>."""
    runner = runner_factory(repo_dir)
    if runner.run_code("rev-parse", "--verify", f"origin/{branch}") != 0:
        return False
    return runner.run_code("merge-base", "--is-ancestor", commit, f"origin/{branch}") == 0


def read_at_branch(repo_path: str, branch: str, *, repo_dir: str,
                   runner_factory=GitRunner) -> str:
    """Return the contents of `repo_path` at `branch`.

    Tries the LOCAL branch ref first: a feature branch at the plan gate is
    committed to the worktree's local branch but not pushed to origin yet, so
    ``origin/<branch>`` doesn't exist. Falls back to ``origin/<branch>`` for
    pushed / env branches. Raises the origin error if neither resolves."""
    r = runner_factory(repo_dir)
    for ref in (branch, f"origin/{branch}"):
        try:
            return r.run("show", f"{ref}:{repo_path}")
        except GitError:
            continue
    return r.run("show", f"origin/{branch}:{repo_path}")  # surface the origin error


def promote(cfg: dict, from_branch: str, to_branch: str, title: str, body: str, *,
            repo_dir: str, gh: GhClient, auto_merge: bool = True) -> dict:
    """Open a PR promoting from_branch -> to_branch and (auto_merge) merge it so the
    promotion actually lands. Returns {pr_number, pr_url, merged, merge_commit?,
    merge_error?}.

    Merges with `--merge` (a merge commit, not squash) so the promoted commits stay
    ancestors of the target env branch, and the gh-level merge does NOT delete the
    head branch — env branches like 'development'/'staging' must survive. If the
    merge fails (branch protection, required checks pending, conflicts), the PR is
    left open and we return merged=False with the error, so the caller can tell the
    user "PR opened — merge it to finish"."""
    res = gh.create_pr(repo_dir, to_branch, from_branch, title, body)
    out: dict = {"pr_number": res["number"], "pr_url": res["url"], "merged": False}
    if auto_merge:
        try:
            sha = gh.merge(repo_dir, res["number"], method="merge")
            out["merged"] = True
            out["merge_commit"] = sha
        except GitError as e:
            out["merge_error"] = str(e)
    return out


class RealGh:
    """Real GitHub client shelling out to the `gh` CLI.

    Inline anchoring is deferred: `comment` uses `gh pr comment {n} --body`,
    embedding the path:line prefix in the body.

    Bound to a `repo_dir` so callers that pass `cwd=None` (e.g.
    `post_review` -> `gh.comment(None, ...)`) still run against the right repo:
    every method resolves `cwd = cwd or self.repo_dir`.
    """

    def __init__(self, repo_dir: str | None = None):
        self.repo_dir = repo_dir

    def create_pr(self, cwd: str, base: str, head: str, title: str, body: str) -> dict:
        result = subprocess.run(
            ["gh", "pr", "create", "--base", base, "--head", head,
             "--title", title, "--body", body],
            cwd=cwd or self.repo_dir, capture_output=True, text=True,
        )
        if result.returncode != 0:
            # Idempotent: if a PR for this head→base already exists, gh prints
            # its URL in the error ("...already exists: https://…/pull/N"). Treat
            # that as success and return the existing PR instead of failing, so a
            # re-clicked Promote just re-surfaces the open promotion PR.
            combined = (result.stderr or "") + (result.stdout or "")
            if "already exists" in combined.lower():
                m = re.search(r"https?://\S+/pull/\d+", combined)
                if m:
                    url = m.group().rstrip(".,)\"'")
                    return {"number": _pr_number_from_url(url), "url": url}
            raise GitError(result.stderr)
        lines = [ln.strip() for ln in (result.stdout or "").splitlines() if ln.strip()]
        if not lines:
            raise GitError(f"gh pr create produced no PR url (stdout={result.stdout!r})")
        url = lines[-1]
        return {"number": _pr_number_from_url(url), "url": url}

    def comment(self, cwd: str, pr_number: int, path: str, line: int, body: str) -> None:
        text = f"`{path}:{line}` — {body}"
        result = subprocess.run(
            ["gh", "pr", "comment", str(pr_number), "--body", text],
            cwd=cwd or self.repo_dir, capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise GitError(result.stderr)

    def merge(self, cwd: str, pr_number: int, method: str = "squash") -> str:
        run_cwd = cwd or self.repo_dir
        # No `--delete-branch`: it makes gh switch the worktree to the base branch
        # after merging, which collides with the base branch already being checked
        # out in the main clone ("'development' is already used by worktree").
        # gitops.merge() removes the worktree + local/remote branch itself.
        merge_result = subprocess.run(
            ["gh", "pr", "merge", str(pr_number), f"--{method}"],
            cwd=run_cwd, capture_output=True, text=True,
        )
        if merge_result.returncode != 0:
            # Idempotent: an already-merged PR is not a failure — fall through and
            # read the merge commit so a retry after a partial failure completes.
            combined = (merge_result.stderr or "") + (merge_result.stdout or "")
            if "already merged" not in combined.lower():
                raise GitError(merge_result.stderr)
        view = subprocess.run(
            ["gh", "pr", "view", str(pr_number), "--json", "mergeCommit"],
            cwd=run_cwd, capture_output=True, text=True,
        )
        if view.returncode != 0:
            raise GitError(view.stderr)
        data = json.loads(view.stdout or "{}")
        return (data.get("mergeCommit") or {}).get("oid", "")
