"""End-to-end lifecycle integration: a task driven ready -> shipped across all
three human gates, exercising REAL git (workspace / merge / cleanup) against a
local bare-origin repo and a FAKE gh (PR number / merge, no network).

The engine consumes the ``lifecycle_git.for_project`` facade so the same code the
server runs (persistent ``.repo`` clone + worktrees off it) is what drives here.
The stub ``spawn`` writes + commits the phase docs into the worktree so there is
a real diff to PR and merge; the ``FakeGh`` performs the merge that GitHub would
(head -> base on the server), returning a real merge-commit sha.
"""
import subprocess
from pathlib import Path

import pytest

from tui_pilot import (artifacts, gates, lifecycle, lifecycle_git, project_git,
                       projects, tasks)


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True,
                   capture_output=True, text=True)


def _rev(cwd, ref="HEAD"):
    return subprocess.run(["git", "rev-parse", ref], cwd=cwd,
                          capture_output=True, text=True).stdout.strip()


@pytest.fixture
def origin(tmp_path):
    """A bare origin with a 'development' branch (seeded with an initial commit)."""
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "--bare", "-b", "development", str(origin)],
                   check=True, capture_output=True)
    seed = tmp_path / "seed"
    _git(tmp_path, "clone", str(origin), str(seed))
    _git(seed, "config", "user.email", "t@t.io")
    _git(seed, "config", "user.name", "T")
    (seed / "README.md").write_text("hi\n")
    _git(seed, "add", ".")
    _git(seed, "commit", "-m", "init")
    _git(seed, "push", "origin", "development")
    return str(origin)


class FakeGh:
    """Fake gh: no network. ``merge`` performs the real server-side merge (head
    into base) against the bare origin in a throwaway clone, returning the true
    merge-commit sha so the engine records a real commit on ``development``."""

    def __init__(self, origin, tmp_path):
        self.origin = origin
        self._tmp = tmp_path
        self.prs = {}
        self.comments = []
        self.merged = []
        self._n = 41

    def create_pr(self, cwd, base, head, title, body):
        self._n += 1
        self.prs[self._n] = {"base": base, "head": head, "title": title}
        return {"number": self._n, "url": f"https://gh/pr/{self._n}"}

    def comment(self, cwd, pr_number, path, line, body):
        self.comments.append((pr_number, path, line, body))

    def merge(self, cwd, pr_number, method="squash"):
        self.merged.append((pr_number, method))
        pr = self.prs[pr_number]
        clone = self._tmp / f"merge-{pr_number}"
        _git(self._tmp, "clone", self.origin, str(clone))
        _git(clone, "config", "user.email", "bot@t.io")
        _git(clone, "config", "user.name", "bot")
        _git(clone, "checkout", pr["base"])
        _git(clone, "merge", "--no-ff", f"origin/{pr['head']}",
             "-m", f"Merge PR #{pr_number}: {pr['title']}")
        sha = _rev(clone)
        _git(clone, "push", "origin", pr["base"])
        return sha


def _make_spawn():
    """A recording stub spawn. For agent phases that produce documents, it writes
    the docs into the run's worktree and commits them (real diff to PR/merge)."""
    seen = []

    _DOCS = {
        "shaping": {"docs/spec.md": "# Spec\n", "docs/plan.md": "# Plan\n"},
        "building": {"docs/test-guide.md": "# Test guide\n"},
    }

    def spawn(run, phase):
        seen.append((phase, run.get("resume_comment")))
        docs = _DOCS.get(phase)
        wt = Path(run["worktree_path"])
        if docs:
            for rel, content in docs.items():
                p = wt / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(content)
            _git(wt, "add", ".")
            _git(wt, "-c", "user.email=agent@t.io", "-c", "user.name=agent",
                 "commit", "-m", f"{phase} work")
        return (f"sess-{phase}-{len(seen)}", "acct-1")

    spawn.seen = seen
    return spawn


def test_task_driven_ready_to_shipped_across_all_gates(origin, tmp_path):
    projects.create(id="acme", name="Acme", path="/w")
    project_git.upsert(
        "acme",
        repo_ssh_url=origin,                       # local bare origin path
        worktrees_root=str(tmp_path / "wt"),
        dev_branch="development",
    )
    tid = tasks.create(project_id="acme", title="Build a thing")["id"]

    spawn = _make_spawn()
    git = lifecycle_git.for_project("acme", gh=FakeGh(origin, tmp_path))

    # ready -> shaping
    run = lifecycle.start_run("acme", tid, spawn=spawn, git=git)
    run_id = run["id"]
    assert lifecycle.get(run_id)["phase"] == "shaping"
    branch = lifecycle.get(run_id)["branch_name"]

    # shaping agent finishes -> plan gate
    lifecycle.advance(
        run_id, phase="shaping",
        report='{"spec_path":"docs/spec.md","plan_path":"docs/plan.md","summary":"Shaped."}',
        spawn=spawn, git=git,
    )
    assert lifecycle.get(run_id)["phase"] == "plan_review"

    # plan gate approved -> building
    lifecycle.decide_gate(run_id, "plan", "approved", by="thiago",
                          spawn=spawn, git=git)
    assert lifecycle.get(run_id)["phase"] == "building"

    # building agent finishes green -> manual_test gate
    lifecycle.advance(
        run_id, phase="building",
        report='{"tests":"green","test_guide_path":"docs/test-guide.md"}',
        spawn=spawn, git=git,
    )
    g_mt = gates.gate_for(run_id, "manual_test")
    assert g_mt is not None and g_mt["status"] == "waiting"

    # manual_test approved -> PR opened, pr_review agent spawned
    lifecycle.decide_gate(run_id, "manual_test", "approved", by="thiago",
                          spawn=spawn, git=git)
    assert lifecycle.get(run_id)["phase"] == "pr_review"
    assert lifecycle.get(run_id)["pr_number"] is not None

    # pr_review agent finishes -> merge gate
    lifecycle.advance(
        run_id, phase="pr_review",
        report='{"findings":[{"path":"docs/spec.md","line":1,"body":"nit"}],'
               '"summary":"Reviewed.","review_report_path":"docs/review.md"}',
        spawn=spawn, git=git,
    )
    g_merge = gates.gate_for(run_id, "merge")
    assert g_merge is not None and g_merge["status"] == "waiting"

    # merge approved -> merged, shipped
    lifecycle.decide_gate(run_id, "merge", "approved", by="thiago",
                          spawn=spawn, git=git)

    final = lifecycle.get(run_id)

    # -- task shipped, run closed --------------------------------------------
    assert final["phase"] == "shipped"
    assert final["active"] == 0
    assert tasks.get(tid)["status"] == "shipped"

    # -- all three gates approved --------------------------------------------
    for gate in ("plan", "manual_test", "merge"):
        assert gates.gate_for(run_id, gate)["status"] == "approved"

    # -- artifacts registered + re-pointed to development --------------------
    arts = artifacts.for_task(tid)
    kinds = {a["kind"] for a in arts}
    assert {"spec", "plan", "test_guide", "review_report"} <= kinds
    assert arts and all(a["branch"] == "development" for a in arts)

    # -- a real branch was created, merged (merge commit on development),
    #    and the worktree was removed --------------------------------------
    repo_dir = str(tmp_path / "wt" / ".repo")
    sha = final["merge_commit"]
    assert sha
    _git(repo_dir, "fetch", "origin")
    # the recorded sha is the tip of origin/development and is a real merge commit
    assert _rev(repo_dir, "origin/development") == sha
    parents = subprocess.run(["git", "rev-list", "--parents", "-n", "1", sha],
                             cwd=repo_dir, capture_output=True, text=True).stdout.split()
    assert len(parents) == 3, "merge commit should have two parents"
    # the feature branch's worktree is gone
    assert not (tmp_path / "wt" / tid).exists()
    # local feature branch cleaned up
    branches = subprocess.run(["git", "branch", "--list", branch], cwd=repo_dir,
                              capture_output=True, text=True).stdout
    assert branch not in branches

    # -- a task_comments note exists for each event kind ---------------------
    comment_kinds = {c["kind"] for c in tasks.comments(tid)}
    assert {"system", "progress", "gate", "test_report", "review"} <= comment_kinds
