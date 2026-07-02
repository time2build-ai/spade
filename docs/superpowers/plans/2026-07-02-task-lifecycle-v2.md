# Task Lifecycle V2 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the linear 4-stage pipeline with a durable per-task lifecycle state machine (brainstorm → plan → approve → build in a worktree → test → PR → review → fix → merge) that has real git/GitHub integration, code-enforced human gates, pinned artifacts, environment/Releases tracking, and a complete activity trail.

**Architecture:** A new `lifecycle.py` domain module implements a graph state machine (mirroring the injected-`spawn` testability of today's `pipelines.py`). A new `gitops.py` owns every `git`/`gh` call behind a thin, fakeable interface. Durable `lifecycle_runs`, `gates`, `artifacts`, and `project_git` tables back the machine. The existing tmux spawn + mailbox harness + ~1s poll loop drive phase transitions unchanged — only a new `_collect_lifecycle_advance` / `_drain_lifecycle_advance` pair routes finished agents into `lifecycle.advance()`. The Next.js client (SWR everywhere) gains lifecycle board columns, a task-view artifacts panel + gate action bar, a Releases page, lifecycle gates on the gate page, and a project Repository settings section.

**Tech Stack:** Python 3 / FastAPI / SQLite (WAL, singleton conn in `db.py`), tmux agent sessions, `gh` CLI + `git`, Next.js App Router + SWR + TypeScript, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-02-task-lifecycle-v2-design.md`

**Conventions (verified in-repo):**
- Tests: `apps/api/tests/test_*.py`, run with the venv pytest. `conftest.py` gives every test a fresh temp-home SQLite DB via `db.reset()` (autouse fixture). Run a file: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_lifecycle.py -v`. Full suite: `make test`.
- DB writes go through `db.tx()` / `db.execute()`; reads through `db.query()`. New tables go in `schema.sql` (CREATE TABLE IF NOT EXISTS); new columns on *existing* tables go in `db._ADDED_COLUMNS` (nullable, additive).
- Domain modules are thin functions over `db` (see `tasks.py`, `pipelines.py`), returning `dict`s. Timestamps via `_now()` = `datetime.now(timezone.utc).isoformat()`. Ids via `uuid.uuid4()`.
- Activity notes: `tasks.add_comment(task_id, body, author, kind)`.
- Client: add endpoints as methods on the `api` object in `lib/api.ts` (they prefix `/api`); fetch with `useSWR(key, () => api.x())`, poll via `refreshInterval`, write then `mutate(key)`. Types in `lib/types.ts`.

---

## Chunk 1: Data model, project_git, status rules

Builds the durable tables and the status-transition guard. No agents/git yet — pure DB + domain logic, fully unit-testable.

### File Structure
- Modify: `apps/api/tui_pilot/schema.sql` — add `project_git`, `lifecycle_runs`, `gates`, `artifacts` tables.
- Modify: `apps/api/tui_pilot/db.py` — add legacy-status migration note (no new columns on `tasks`; status values migrate in code).
- Create: `apps/api/tui_pilot/project_git.py` — per-project repo config CRUD.
- Modify: `apps/api/tui_pilot/tasks.py` — extend `STATUSES`, add `TRANSITIONS` + guarded `move()`.
- Test: `apps/api/tests/test_project_git.py`, extend `apps/api/tests/test_tasks.py`.

### Task 1.1: New tables in schema.sql

**Files:** Modify `apps/api/tui_pilot/schema.sql` (append after the `pipeline_stages` block, ~line 93).

- [ ] **Step 1: Add the four tables**

```sql
-- Per-project git/GitHub config. One row per project; created on demand.
CREATE TABLE IF NOT EXISTS project_git (
  project_id TEXT PRIMARY KEY,
  repo_ssh_url TEXT,
  dev_branch TEXT DEFAULT 'development',
  staging_branch TEXT DEFAULT 'staging',
  prod_branch TEXT DEFAULT 'main',
  worktrees_root TEXT,
  created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
-- One active lifecycle run per task (history retained). phase is the state-machine node.
CREATE TABLE IF NOT EXISTS lifecycle_runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
  phase TEXT DEFAULT 'shaping', active INTEGER DEFAULT 1,
  branch_name TEXT, worktree_path TEXT,
  pr_number INTEGER, pr_url TEXT, merge_commit TEXT,
  env_dev_at TEXT, env_staging_at TEXT, env_prod_at TEXT,
  agent_session_id TEXT, account_id TEXT,
  blocked_reason TEXT, blocked_from_phase TEXT,
  self_heal_attempts INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
-- Durable human gates. Survives restart (unlike in-memory brakes).
CREATE TABLE IF NOT EXISTS gates (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, run_id TEXT NOT NULL,
  gate TEXT NOT NULL, status TEXT DEFAULT 'waiting',
  comment TEXT, decided_by TEXT, decided_at TEXT, created_at TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES lifecycle_runs(id) ON DELETE CASCADE
);
-- Documents pinned to a task: spec | plan | test_guide | review_report.
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, run_id TEXT,
  kind TEXT NOT NULL, title TEXT,
  repo_path TEXT, branch TEXT, created_by TEXT, created_at TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Verify schema loads** — Run: `cd apps/api && ../../.venv/bin/python -c "from tui_pilot import db; db.reset(); db.get_conn(); print(db.query('SELECT name FROM sqlite_master WHERE type=\"table\" AND name IN (\"project_git\",\"lifecycle_runs\",\"gates\",\"artifacts\")'))"` Expected: all four table names printed.
- [ ] **Step 3: Commit** — `git add apps/api/tui_pilot/schema.sql && git commit -m "feat(lifecycle): add project_git, lifecycle_runs, gates, artifacts tables"`

### Task 1.2: project_git domain module

**Files:** Create `apps/api/tui_pilot/project_git.py`; Test `apps/api/tests/test_project_git.py`.

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_project_git.py
from tui_pilot import project_git, projects


def _proj():
    projects.create(id="acme", name="Acme", path="/w")


def test_get_returns_none_before_set():
    _proj()
    assert project_git.get("acme") is None


def test_upsert_creates_then_updates_with_branch_defaults():
    _proj()
    row = project_git.upsert("acme", repo_ssh_url="git@github.com:acme/app.git")
    assert row["repo_ssh_url"] == "git@github.com:acme/app.git"
    assert row["dev_branch"] == "development"
    assert row["staging_branch"] == "staging"
    assert row["prod_branch"] == "main"
    # second upsert updates in place (still one row)
    row2 = project_git.upsert("acme", staging_branch="stage")
    assert row2["staging_branch"] == "stage"
    assert row2["repo_ssh_url"] == "git@github.com:acme/app.git"  # preserved


def test_worktrees_root_defaults_under_home_when_unset():
    _proj()
    row = project_git.upsert("acme", repo_ssh_url="git@github.com:acme/app.git")
    assert row["worktrees_root"] and "acme" in row["worktrees_root"]
```

- [ ] **Step 2: Run, verify fail** — `cd apps/api && ../../.venv/bin/python -m pytest tests/test_project_git.py -v` Expected: FAIL (module not found).
- [ ] **Step 3: Implement `project_git.py`**

```python
"""Per-project git/GitHub config (repo url + promotion branch names)."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from tui_pilot import db

_WRITABLE = {"repo_ssh_url", "dev_branch", "staging_branch", "prod_branch", "worktrees_root"}
_DEFAULTS = {"dev_branch": "development", "staging_branch": "staging", "prod_branch": "main"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get(project_id: str) -> dict | None:
    rows = db.query("SELECT * FROM project_git WHERE project_id = ?", (project_id,))
    return dict(rows[0]) if rows else None


def upsert(project_id: str, **fields) -> dict:
    bad = set(fields) - _WRITABLE
    if bad:
        raise ValueError(f"non-writable columns: {sorted(bad)}")
    existing = get(project_id)
    with db.tx() as cx:
        if existing is None:
            root = fields.get("worktrees_root") or str(
                Path.home() / ".spade" / "worktrees" / project_id
            )
            cx.execute(
                "INSERT INTO project_git "
                "(project_id, repo_ssh_url, dev_branch, staging_branch, prod_branch, "
                " worktrees_root, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (project_id, fields.get("repo_ssh_url"),
                 fields.get("dev_branch", _DEFAULTS["dev_branch"]),
                 fields.get("staging_branch", _DEFAULTS["staging_branch"]),
                 fields.get("prod_branch", _DEFAULTS["prod_branch"]),
                 root, _now()),
            )
        elif fields:
            set_clause = ", ".join(f"{c} = ?" for c in fields)
            cx.execute(
                f"UPDATE project_git SET {set_clause} WHERE project_id = ?",
                tuple(fields.values()) + (project_id,),
            )
    return get(project_id)
```

- [ ] **Step 4: Run, verify pass** — `cd apps/api && ../../.venv/bin/python -m pytest tests/test_project_git.py -v` Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/project_git.py apps/api/tests/test_project_git.py && git commit -m "feat(lifecycle): project_git config module"`

### Task 1.3: Extend STATUSES + transition guard on tasks.move

**Files:** Modify `apps/api/tui_pilot/tasks.py:13` and `:116-121`; extend `apps/api/tests/test_tasks.py`.

Board statuses become: `ready · shaping · plan_review · building · pr_review · shipped · blocked`. Legacy `in_progress`/`review` are migrated (Task 1.4) and dropped from the enum. `move()` gains a transition table; illegal jumps raise `ValueError` unless `force=True`.

- [ ] **Step 1: Write failing tests** (append to `test_tasks.py`)

```python
def test_move_rejects_illegal_transition():
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]  # status 'ready'
    import pytest
    with pytest.raises(ValueError):
        tasks.move(tid, "shipped")  # ready -> shipped is not legal


def test_move_allows_legal_transition_chain():
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]
    for nxt in ["shaping", "plan_review", "building", "pr_review", "shipped"]:
        tasks.move(tid, nxt)
    assert tasks.get(tid)["status"] == "shipped"


def test_move_force_bypasses_transition_rules():
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]
    tasks.move(tid, "shipped", force=True)
    assert tasks.get(tid)["status"] == "shipped"


def test_any_status_can_go_to_blocked_and_back_via_force():
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]
    tasks.move(tid, "shaping")
    tasks.move(tid, "blocked")  # any -> blocked is always legal
    assert tasks.get(tid)["status"] == "blocked"
```

- [ ] **Step 2: Run, verify fail** — `cd apps/api && ../../.venv/bin/python -m pytest tests/test_tasks.py -k "transition or blocked or force" -v` Expected: FAIL.
- [ ] **Step 3: Implement** — replace `STATUSES` and `move()` in `tasks.py`:

```python
STATUSES = ["ready", "shaping", "plan_review", "building", "pr_review", "shipped", "blocked"]

# Legal forward transitions of the lifecycle state machine. "any -> blocked" and
# "blocked -> <resume>" are handled specially (see move). Board reads tasks.status;
# the lifecycle engine is the sole writer during a run.
TRANSITIONS = {
    "ready": {"shaping"},
    "shaping": {"plan_review", "blocked"},
    "plan_review": {"building", "shaping", "blocked"},
    "building": {"pr_review", "building", "blocked"},
    "pr_review": {"shipped", "pr_review", "blocked"},
    "shipped": set(),
    "blocked": set(STATUSES),  # a blocked task may resume into any phase
}


def move(id: str, status: str, force: bool = False) -> None:
    """Move a task to a new status, enforcing the transition table.

    Any status may go to 'blocked'. 'blocked' may resume into any status. Other
    jumps must appear in TRANSITIONS[current]. force=True bypasses the guard
    (admin override); callers should log a system note when forcing.
    """
    if status not in STATUSES:
        raise ValueError(f"invalid status {status!r}; must be one of {STATUSES}")
    cur = get(id)
    current = cur["status"] if cur else "ready"
    legal = status == "blocked" or status in TRANSITIONS.get(current, set())
    if not force and not legal:
        raise ValueError(f"illegal transition {current!r} -> {status!r}")
    with db.tx() as cx:
        cx.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, id))
```

- [ ] **Step 4: Run, verify pass** — same pytest `-k` command. Expected: PASS. Then run the whole `test_tasks.py` to catch regressions.
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/tasks.py apps/api/tests/test_tasks.py && git commit -m "feat(lifecycle): transition-guarded task.move + lifecycle statuses"`

### Task 1.4: Legacy status migration

Old DBs have tasks in `in_progress`/`review`. Migrate them at connect time so the board and transition guard stay consistent.

**Files:** Modify `apps/api/tui_pilot/db.py` `_migrate()`; Test `apps/api/tests/test_db.py`.

- [ ] **Step 1: Write failing test** (append to `test_db.py`)

```python
def test_migrate_maps_legacy_task_statuses():
    from tui_pilot import db, projects, tasks
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]
    # Force a legacy value directly (bypassing the new guard).
    db.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ?", (tid,))
    db.get_conn()  # _migrate runs inside get_conn on first open; call the migrator
    db._migrate(db.get_conn())
    assert tasks.get(tid)["status"] == "building"
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — at the end of `_migrate(conn)` in `db.py` add:

```python
    # Legacy lifecycle status remap (idempotent): the old linear pipeline used
    # in_progress/review; the lifecycle machine uses building/pr_review.
    conn.execute("UPDATE tasks SET status = 'building' WHERE status = 'in_progress'")
    conn.execute("UPDATE tasks SET status = 'pr_review' WHERE status = 'review'")
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/db.py apps/api/tests/test_db.py && git commit -m "feat(lifecycle): migrate legacy in_progress/review statuses"`

### Chunk 1 review
Dispatch plan-document-reviewer on Chunk 1 with the spec path. Fix and re-dispatch until approved.

---

## Chunk 2: Git service (gitops.py)

All `git`/`gh` interaction behind one fakeable interface. Tests use a REAL local git repo in a tmp dir (bare "origin" + working clone); `gh` calls go through an injectable client so tests fake GitHub without network.

### File Structure
- Create: `apps/api/tui_pilot/gitops.py` — `GitRunner` (real subprocess) + `GhClient` protocol; `prepare_workspace`, `open_pr`, `post_review`, `merge`, `promote`, `commit_reached_branch`.
- Test: `apps/api/tests/test_gitops.py`.

### Design
`gitops` functions take an injected `runner` (runs `git` in a cwd) and `gh` (opens/merges PRs). Real implementations shell out; tests pass fakes. This mirrors how `pipelines.start_stage` injects `spawn`.

```python
# Signatures (in apps/api/tui_pilot/gitops.py)
class GitRunner:
    def __init__(self, cwd: str): ...
    def run(self, *args: str) -> str:  # returns stdout, raises GitError(stderr) on nonzero

class GhClient(Protocol):
    def create_pr(self, cwd: str, base: str, head: str, title: str, body: str) -> dict: ...   # {number, url}
    def comment(self, cwd: str, pr_number: int, path: str, line: int, body: str) -> None: ...
    def merge(self, cwd: str, pr_number: int, method: str = "squash") -> str: ...              # merge commit sha

def prepare_workspace(cfg: dict, task_id: str, slug: str, kind: str = "feat",
                      runner_factory=GitRunner) -> dict:  # {branch_name, worktree_path}
def open_pr(cfg: dict, worktree: str, branch: str, base: str, title: str, body: str,
            gh: GhClient) -> dict:  # {pr_number, pr_url}
def post_review(worktree: str, pr_number: int, findings: list[dict], gh: GhClient) -> None
def merge(cfg: dict, worktree: str, branch: str, pr_number: int, gh: GhClient,
          method: str = "squash") -> str  # merge_commit sha; removes worktree + deletes branch
def commit_reached_branch(worktree: str, commit: str, branch: str,
                          runner_factory=GitRunner) -> bool  # git merge-base --is-ancestor
def promote(cfg: dict, worktree: str, from_branch: str, to_branch: str, title: str,
            body: str, gh: GhClient) -> dict  # {pr_number, pr_url}
```

### Task 2.1: GitRunner + prepare_workspace against a real local repo

**Files:** Create `gitops.py`; Test `test_gitops.py`.

- [ ] **Step 1: Write failing test** — build a real repo in tmp and assert a branch+worktree is created.

```python
# apps/api/tests/test_gitops.py
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
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `GitRunner`, `GitError`, `_slugify`, `prepare_workspace`** — fetch dev branch, `git worktree add -b <branch> <path> origin/<dev>`. (Full code: a `GitRunner.run` wrapping `subprocess.run(["git", *args], cwd=..., capture_output=True, text=True)` raising `GitError(result.stderr)` on nonzero; `prepare_workspace` uses `repo_dir` to run `git fetch origin <dev_branch>` then `git worktree add -b <branch> <worktrees_root>/<task_id> origin/<dev_branch>`.)
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 2.2: open_pr, post_review, merge with a fake GhClient

- [ ] **Step 1: Write failing tests** — a `FakeGh` recording calls; assert `open_pr` returns the fake's `{number,url}`, `post_review` forwards each finding, and `merge` returns a sha, removes the worktree dir, and the branch is gone.

```python
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
    gitops.post_review("/w", 42, findings, gh=gh)
    assert len(gh.comments) == 2 and gh.comments[0][0] == 42


def test_merge_returns_sha_and_cleans_up(origin_and_clone, tmp_path):
    cfg = {"worktrees_root": str(tmp_path/"wt"), "dev_branch": "development"}
    ws = gitops.prepare_workspace(cfg, "SPD-2", "y", repo_dir=origin_and_clone["work"])
    gh = FakeGh()
    sha = gitops.merge(cfg, ws["worktree_path"], ws["branch_name"], 42, gh=gh,
                       repo_dir=origin_and_clone["work"])
    assert sha == "deadbeef"
    assert not Path(ws["worktree_path"]).exists()  # worktree removed
```

- [ ] **Step 2-4: Implement `open_pr` (push branch via runner, `gh.create_pr`), `post_review` (loop `gh.comment`), `merge` (`gh.merge`, then `git worktree remove --force` + `git branch -D` + `git push origin --delete`), verify pass.**
- [ ] **Step 5: Commit.**

### Task 2.3: commit_reached_branch (env watcher primitive)

- [ ] **Step 1: Write failing test** — commit on development, assert `commit_reached_branch` is True for development and False for an unrelated branch.
- [ ] **Step 2-4: Implement** using `git merge-base --is-ancestor <commit> origin/<branch>` (exit 0 = ancestor → True, exit 1 = False; other = GitError). Verify pass.
- [ ] **Step 5: Commit.**

### Task 2.4: Real GhClient (subprocess `gh`) — thin, integration-guarded

- [ ] **Step 1: Implement `RealGh`** using `gh pr create --base <b> --head <h> --title --body`, `gh api` for review comments, `gh pr merge --squash`. Parse `gh pr create` stdout for the URL/number.
- [ ] **Step 2: Add a smoke test** marked `@pytest.mark.skipif(no gh or no network)` that only checks command construction via a fake `subprocess` — do NOT hit GitHub in CI.
- [ ] **Step 3: Commit.**

### Chunk 2 review
Dispatch plan-document-reviewer on Chunk 2. Fix + re-dispatch until approved.

---

## Chunk 3: Lifecycle engine (lifecycle.py)

The state machine, gates, artifacts, and phase advancement — with `spawn` and `git` injected so it's unit-testable with a fake agent (no tmux) and a local repo (no GitHub), exactly like `test_pipelines.py`'s `fake_spawn`.

### File Structure
- Create: `apps/api/tui_pilot/lifecycle.py` — run CRUD, `PHASES`, `advance()`, gate open/decide, artifact register, `gates.py`/`artifacts.py` helpers folded in (or split if it grows > ~400 lines).
- Test: `apps/api/tests/test_lifecycle.py`.

### Model
```python
PHASES = ["shaping", "plan_review", "building", "pr_review", "shipped", "blocked"]
AGENT_PHASES = {"shaping", "building", "pr_review"}   # phases that spawn an agent
GATES = {"plan", "manual_test", "merge"}

# spawn signature (injected): spawn(run, phase) -> (session_id, account_id)
# git ops injected as a small facade so tests pass a local-repo-backed fake.
```

### Key behaviors (from spec §2)
- `start_run(project_id, task_id, spawn, git)` → creates a `lifecycle_runs` row (`phase=shaping`, `active=1`), calls `git.prepare_workspace`, stores branch/worktree, spawns the shaping agent, moves task → `shaping`, posts a `system` note.
- On shaping `finished`: register spec+plan artifacts (paths come in the agent report payload), phase → `plan_review`, open the **plan** gate, move task → `plan_review`.
- Gate decide `plan` approve → phase → `building`, spawn builder; `request_changes` → phase → `shaping`, re-spawn with the comment.
- On building `finished` with tests green: register `test_guide` artifact, open **manual_test** gate (task stays `building`; board shows amber via gate). Tests red: increment `self_heal_attempts`; if < 3 re-spawn builder, else phase → `blocked`.
- Gate decide `manual_test` approve → phase → `pr_review`, spawn reviewer (which opens PR); `request_changes` → re-spawn builder.
- On pr_review `finished`: `open_pr` + `post_review` + record findings note/artifact, open **merge** gate.
- Gate decide `merge` approve → `git.merge`, record `merge_commit`, stamp `env_dev_at`, re-point artifacts to `dev_branch`, phase → `shipped`, `active=0`, move task → `shipped`, post system note.
- `retry(run)` from blocked → phase = `blocked_from_phase`, re-spawn.
- Every transition posts a `task_comments` row (kinds: `artifact`, `gate`, `test_report`, `review`, `progress`, `system`).

### Task 3.1: Run CRUD + start_run

- [ ] **Step 1: Write failing tests** (mirror `test_pipelines.py` `_setup` + `fake_spawn`):

```python
# apps/api/tests/test_lifecycle.py
from tui_pilot import lifecycle, tasks, projects


class FakeGit:
    """Injected git facade — records calls, no real repo needed for engine tests."""
    def __init__(self): self.calls = []; self.merge_sha = "sha123"
    def prepare_workspace(self, cfg, task_id, slug, kind="feat"):
        self.calls.append(("prepare", task_id))
        return {"branch_name": f"feat/{task_id}-{slug}", "worktree_path": f"/wt/{task_id}"}
    def open_pr(self, *a, **k): self.calls.append(("open_pr",)); return {"pr_number": 7, "pr_url": "u/7"}
    def post_review(self, *a, **k): self.calls.append(("post_review",))
    def merge(self, *a, **k): self.calls.append(("merge",)); return self.merge_sha
    def repoint_artifacts(self, *a, **k): pass


def _setup():
    projects.create(id="acme", name="Acme", path="/w")
    from tui_pilot import project_git
    project_git.upsert("acme", repo_ssh_url="git@github.com:acme/app.git")
    return tasks.create(project_id="acme", title="Build X")["id"]


def _spawn(run, phase):
    return (f"sess-{phase}", "acct")


def test_start_run_creates_shaping_run_and_moves_task():
    tid = _setup()
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    assert run["phase"] == "shaping"
    assert run["branch_name"].startswith("feat/SPD-")
    assert tasks.get(tid)["status"] == "shaping"
```

- [ ] **Step 2: Run, verify fail. Step 3: Implement `start_run` + `get`/`active_run_for_task`/`_set_run`. Step 4: pass. Step 5: commit.**

### Task 3.2: advance() through shaping → plan gate

- [ ] **Step 1: Failing test** — after `start_run`, call `lifecycle.advance(run_id, phase="shaping", report=<json with spec/plan paths>, spawn, git)`; assert phase == `plan_review`, task == `plan_review`, a `plan` gate row is `waiting`, and two artifacts (`spec`,`plan`) exist.
- [ ] **Step 2-4: Implement `advance()` shaping branch + `open_gate` + `register_artifact` + artifact-report parsing.** Report payload contract: the shaping agent's `finished` report is JSON `{"spec_path": "...", "plan_path": "...", "summary": "..."}`; parse defensively (fall back to a `progress` note if unparseable).
- [ ] **Step 5: Commit.**

### Task 3.3: Gate decisions (plan approve/reject)

- [ ] **Step 1: Failing tests** — `decide_gate(run_id, "plan", "approved", spawn, git)` → phase `building`, task `building`, builder spawned, gate row `approved` with `decided_at`. `request_changes` → phase `shaping`, gate `changes_requested`, comment stored + threaded into re-spawn (assert the spawn saw the comment via a recording spawn).
- [ ] **Step 2-4: Implement `decide_gate` + gate CRUD (`open_gate`, `waiting_gates`, `gate_for`).**
- [ ] **Step 5: Commit.**

### Task 3.4: building → manual_test gate, self-heal, blocked

- [ ] **Step 1: Failing tests** — advance building with `report={"tests":"green","test_guide_path":"..."}` → `test_guide` artifact + `manual_test` gate waiting, task still `building`. With `{"tests":"red","failing":["t1"]}` → self_heal re-spawn and `self_heal_attempts==1`; after 3 red advances → phase `blocked`, `blocked_from_phase=="building"`, a `test_report` note lists failing tests.
- [ ] **Step 2-4: Implement building branch of `advance()` with the self-heal counter (cap 3).**
- [ ] **Step 5: Commit.**

### Task 3.5: pr_review → merge gate → shipped

- [ ] **Step 1: Failing tests** — approve `manual_test` → phase `pr_review`, `git.open_pr` called, `pr_number` stored. advance pr_review with `report={"findings":[...],"summary":"..."}` → findings note + `review_report` artifact + `merge` gate waiting. approve `merge` → `git.merge` called, `merge_commit` + `env_dev_at` set, artifacts re-pointed, phase `shipped`, task `shipped`, run `active=0`, system note posted.
- [ ] **Step 2-4: Implement pr_review branch + merge-gate branch + `_repoint_artifacts_to_dev`.**
- [ ] **Step 5: Commit.**

### Task 3.6: retry from blocked + empty-change edge

- [ ] **Step 1: Failing tests** — a blocked run (blocked_from_phase="building") → `lifecycle.retry(run_id, spawn, git)` sets phase back to `building` and re-spawns. Empty-change: if shaping reports `{"no_changes": true}` → phase `blocked` with a "no changes produced" note (per spec §3).
- [ ] **Step 2-4: Implement `retry` + the no-changes guard.**
- [ ] **Step 5: Commit.**

### Chunk 3 review
Dispatch plan-document-reviewer on Chunk 3. Fix + re-dispatch until approved.

---

## Chunk 4: Server wiring (endpoints + poll-loop advance + real spawn)

Wire the engine to HTTP and to the tmux/mailbox poll loop, mirroring the pipeline glue exactly.

### File Structure
- Modify: `apps/api/tui_pilot/spade_server.py` — lifecycle request models, `_lifecycle_spawn` (real spawn + `_meta` stamp), `_lifecycle_git()` (RealGh-backed facade), endpoints.
- Modify: `apps/api/tui_pilot/server.py` — `_collect_lifecycle_advance`, `_drain_lifecycle_advance`, hook both into `_poll_loop`.
- Modify: `apps/api/tui_pilot/roles_seed.py` — add lifecycle phase roles (planner/builder/reviewer) if role rows are needed for spawn labels.
- Test: `apps/api/tests/test_spade_server.py` (endpoints), `apps/api/tests/test_server.py` (collector).

### Task 4.1: `_lifecycle_spawn` + phase prompts

**Files:** Modify `spade_server.py` (near `_pipeline_spawn` at :351-384).

- [ ] **Step 1: Implement `_phase_prompt(run, phase)`** returning the phase instructions that invoke superpowers skills by name (shaping → brainstorming+writing-plans, building → executing-plans+TDD, pr_review → requesting-code-review + the project's PR review). Each prompt instructs the agent to end with a `finished` handoff whose report is the JSON payload the engine parses (spec/plan paths; tests+test_guide; findings).
- [ ] **Step 2: Implement `_lifecycle_spawn(run)`** returning a `spawn(run, phase)` closure that calls `server._spawn_agent(name=f"{phase}-{run['id']}", role=phase, project_id=run['project_id'], cwd=run['worktree_path'], task=_phase_prompt(run, phase), parent=None, report_context=...)`, then stamps `_meta[sid]["lifecycle_phase"]=phase` and `_meta[sid]["lifecycle_run_id"]=run["id"]` (run_id written LAST, matching the pipeline gate-key ordering), returns `(sid, info.get("account_id"))`.
- [ ] **Step 3: Commit.**

Note: `cwd` is the **worktree_path** (not the project path), so each lifecycle agent works in isolation. `prepare_workspace` must have run before the first spawn (it does — `start_run` calls it).

### Task 4.2: Poll-loop lifecycle collector/drainer

**Files:** Modify `server.py` — add beside `_collect_pipeline_advance` (:243) and `_drain_pipeline_advance` (:271).

- [ ] **Step 1: Write failing test** (`test_server.py`) — construct a `_meta` entry with `lifecycle_run_id`, feed a fake `HarnessState(kind="done", report=...)`, assert `_collect_lifecycle_advance` returns `(run_id, phase, report)` once and is `None` on the second call (once-guard).
- [ ] **Step 2-3: Implement**:

```python
def _collect_lifecycle_advance(aid, harness_state):
    m = _meta.get(aid)
    if not m or m.get("parent") or m.get("is_orchestrator"):
        return None
    run_id = m.get("lifecycle_run_id")
    if not run_id:
        return None
    if harness_state is None or harness_state.kind != "done":
        return None
    if m.get("lifecycle_advanced"):
        return None
    m["lifecycle_advanced"] = True
    report = (harness_state.report or "").strip()
    return (run_id, m.get("lifecycle_phase"), report)


def _drain_lifecycle_advance(run_id, phase, report):
    from tui_pilot import lifecycle, spade_server
    run = lifecycle.get(run_id)
    if run is None:
        return
    lifecycle.advance(run_id, phase=phase, report=report,
                      spawn=spade_server._lifecycle_spawn(run),
                      git=spade_server._lifecycle_git(run["project_id"]))
```

- [ ] **Step 4: Hook into `_poll_loop`** — in the COLLECT phase (~:221) also append `_collect_lifecycle_advance(aid, st)` to a `lifecycle_advances` list; in DRAIN (~:232) call `_drain_lifecycle_advance(*item)` for each. Keep both mechanisms during the transition (pipeline advance stays until pipelines.py is retired in Chunk 6).
- [ ] **Step 5: Run tests, commit.**

### Task 4.3: HTTP endpoints

**Files:** Modify `spade_server.py`; Test `test_spade_server.py`.

- [ ] **Step 1: Write failing endpoint tests** using FastAPI `TestClient` (mirror existing `test_spade_server.py`), monkeypatching `_lifecycle_spawn`/`_lifecycle_git` to fakes so no tmux/git runs.
- [ ] **Step 2-3: Implement endpoints:**
  - `POST /lifecycle/start` `{project_id, task_id}` → `lifecycle.start_run(...)` (404 if `project_git.get` has no `repo_ssh_url`).
  - `GET /lifecycle/{run_id}` and `GET /lifecycle?project_id=` (list active + recent).
  - `POST /tasks/{id}/gates/{gate}/approve` `{comment?}` and `/request-changes` `{comment}` → `lifecycle.decide_gate(...)`.
  - `POST /lifecycle/{run_id}/retry` → `lifecycle.retry(...)`.
  - `GET /tasks/{id}/artifacts` → artifact rows; `GET /tasks/{id}/artifacts/{artifact_id}/content` → reads the file from the artifact's branch (via `git show <branch>:<repo_path>` through gitops) for the drawer.
  - `GET /projects/{id}/git` + `PUT /projects/{id}/git` → `project_git.get/upsert`.
  - `GET /projects/{id}/releases` → env lanes: tasks grouped by furthest env reached (from `lifecycle_runs.env_*_at`).
  - `POST /projects/{id}/promote` `{from_env, to_env}` → `gitops.promote(...)`.
  - `GET /projects/{id}/gates` → all `waiting` lifecycle gates for the gate page.
- [ ] **Step 4: Run tests, commit.**

### Task 4.4: Env watcher on the poll loop

- [ ] **Step 1: Failing test** — a shipped run with `merge_commit` set and `commit_reached_branch` faked True for staging → after `run_env_watch(project_id, git)` the run's `env_staging_at` is stamped and a "reached staging" note is posted; idempotent (second call posts nothing).
- [ ] **Step 2-3: Implement `lifecycle.run_env_watch(project_id, git)`** iterating shipped-but-not-prod runs; call from `_poll_loop` on a throttled cadence (e.g. every 60th tick — track a counter, since the loop is ~1s).
- [ ] **Step 4: Commit.**

### Chunk 4 review
Dispatch plan-document-reviewer on Chunk 4. Fix + re-dispatch until approved.

---

## Chunk 5: Client UI

SWR throughout. Add endpoints to `lib/api.ts`, types to `lib/types.ts`, then the five UI surfaces. Every new interactive element gets a `data-testid`.

### Task 5.1: API + types

**Files:** Modify `apps/client/lib/api.ts`, `apps/client/lib/types.ts`.

- [ ] **Step 1:** Add `Status` values `shaping|plan_review|building|pr_review` to the `Status` union + `STATUSES` (`types.ts:1-9`); add `LifecycleRun`, `Gate`, `Artifact`, `ProjectGit`, `ReleaseLanes` interfaces.
- [ ] **Step 2:** Add `api` methods: `startLifecycle`, `lifecycle(runId)`, `lifecycleList(projectId)`, `approveGate(taskId, gate, comment?)`, `requestGateChanges(taskId, gate, comment)`, `retryLifecycle(runId)`, `artifacts(taskId)`, `artifactContent(taskId, artifactId)`, `projectGit(projectId)`, `updateProjectGit(projectId, body)`, `releases(projectId)`, `promote(projectId, from, to)`, `lifecycleGates(projectId)` — each following the `http<T>("/path", {...})` pattern.
- [ ] **Step 3: Commit.**

### Task 5.2: Board columns + gate-amber cards

**Files:** `apps/client/components/backlog/Board.tsx:10-15`, `lib/adapters.ts:86-94`, `components/backlog/TaskCard.tsx`, task page `STATUS_COLOR`.

- [ ] **Step 1:** Extend `COLUMNS` to `ready · shaping · plan_review · building · pr_review · shipped` with colors; ensure `tasksByStatus` buckets the new statuses.
- [ ] **Step 2:** In `TaskCard`, when the task has a `waiting` gate (pass a `gatedTaskIds` set from the page, fed by `api.lifecycleGates`), render amber "waiting on you" styling + an inline **Review →** link to `/task/{id}`. This is what gives the `manual_test` gate (task still `building`) a visible home.
- [ ] **Step 3:** Add env badges (`dev/staging/prod`) on shipped cards from the run's `env_*_at`.
- [ ] **Step 4: e2e** `e2e/backlog.spec.ts` — mock `/api/tasks` with lifecycle statuses + `/api/projects/*/gates`; assert six columns and an amber gated card. Commit.

### Task 5.3: Task view — artifacts panel + gate action bar + timeline

**Files:** `apps/client/app/task/[id]/page.tsx`.

- [ ] **Step 1:** Add `useSWR` for `artifacts(taskId)` and the task's lifecycle run/gate. Render an **Artifacts panel** (Spec, Plan, Test guide, Review report) above the existing "Pipeline history" (after :297); each opens a drawer rendering `artifactContent` markdown. Test guide gets the kid-simple treatment (big numbered steps, tickable checkboxes, print button).
- [ ] **Step 2:** Add a **Gate action bar** (mirror `headerActions` :114-127) shown when a gate is `waiting`: label + Approve / Request changes + comment box → `api.approveGate` / `api.requestGateChanges` then `mutate`.
- [ ] **Step 3:** Replace the "Start/Resume pipeline" button (`runPipeline` :97-112) with **Start lifecycle** → `api.startLifecycle` then stay on the task (SWR polls the run).
- [ ] **Step 4:** Upgrade the timeline to render the new comment kinds with icons (gate, test_report, review, artifact, progress).
- [ ] **Step 5: e2e** `e2e/task-detail.spec.ts` — mock artifacts + a waiting gate; assert the gate bar and artifact drawer. Commit.

### Task 5.4: Releases page

**Files:** Create `apps/client/app/releases/page.tsx`; modify `components/shell/Sidebar.tsx` (nav), `lib/useShell.ts` (optional count), `components/Icon.tsx` (reuse `bolt`/`orch`).

- [ ] **Step 1:** Add the `{ label: "Releases", icon: "bolt", href: "/releases" }` nav item under Execution (`Sidebar.tsx:51`).
- [ ] **Step 2:** Build the page: three lanes (Development / Staging / Production) from `api.releases(projectId)`, each listing tasks; **Promote** buttons between lanes → `api.promote` (open the env PR) showing the auto-generated release note; header shows the open promotion PR if any.
- [ ] **Step 3: e2e** `e2e/releases.spec.ts` — mock `/api/projects/*/releases`; assert three lanes + a promote button. Commit.

### Task 5.5: Gate page — lifecycle gates alongside brakes

**Files:** `apps/client/app/gate/page.tsx`, reuse `components/gate/GateCard.tsx`.

- [ ] **Step 1:** Add `useSWR("lifecycle-gates", () => api.lifecycleGates(projectId), {refreshInterval:4000})`; render a list of `<GateCard>` for lifecycle gates (approve → `api.approveGate`, reject → `api.requestGateChanges`) above/below the existing brake banner. Keep the honest empty state when nothing waits.
- [ ] **Step 2: e2e** `e2e/gate.spec.ts` — mock lifecycle gates; assert a gate card renders and Approve calls the endpoint. Commit.

### Task 5.6: Project Repository settings

**Files:** `apps/client/app/settings/page.tsx`, `lib/types.ts` (Project), `lib/api.ts`.

- [ ] **Step 1:** Add a bespoke **Repository** `<section className="set-group">` (before Danger zone ~:88) with controlled inputs for `repo_ssh_url`, `dev_branch`, `staging_branch`, `prod_branch`, persisting via `api.updateProjectGit(projectId, ...)` (mirror the autopilot toggle persistence at :48-56). Load current values via `useSWR(project ? ["project-git", project.id] : null, ...)`.
- [ ] **Step 2: e2e** `e2e/settings.spec.ts` — mock `/api/projects/*/git`; assert inputs render and save calls PUT. Commit.

### Chunk 5 review
Dispatch plan-document-reviewer on Chunk 5. Fix + re-dispatch until approved.

---

## Chunk 6: Retire pipelines + full-suite integration

### Task 6.1: End-to-end lifecycle integration test (fake agent, real local repo)

**Files:** `apps/api/tests/test_lifecycle_integration.py`.

- [ ] **Step 1:** Drive a task `ready → shipped` across all three gates using a stub `spawn` that immediately writes a `finished` mailbox report (or calls `lifecycle.advance` directly with canned reports) and the REAL `gitops` against a local bare-origin repo (the `origin_and_clone` fixture from Chunk 2). Assert: artifacts registered + re-pointed to `development`, all gate rows `approved`, real branch created + merged + worktree removed, task `shipped`, activity notes present for each event. Commit.

### Task 6.2: Retire the pipeline engine

**Files:** `spade_server.py` (remove `/pipelines*` endpoints + `_pipeline_spawn`/`_stage_prompt`), `server.py` (remove `_collect_pipeline_advance`/`_drain_pipeline_advance` hooks), keep `pipeline_runs`/`pipeline_stages` tables read-only for one release.

- [ ] **Step 1:** Delete pipeline endpoints + the poll-loop pipeline hooks; delete `test_pipelines.py` or mark it legacy. Keep `pipelines.py` module + tables (no writes). Update the client to remove `createPipeline`/`startPipeline`/`advancePipeline` usage (already replaced by lifecycle in 5.3).
- [ ] **Step 2:** Add a backlog task (in the app's own tracker or a `# TODO(cleanup)` note in `schema.sql`) to drop `pipeline_runs`/`pipeline_stages` in a later release.
- [ ] **Step 3: Run full suite** `make test` + `cd apps/client && npx playwright test`. Fix regressions. Commit.

### Task 6.3: Verification before completion

- [ ] Use superpowers:verification-before-completion. Run `make test` (backend green), `npx playwright test` (e2e green), and manually drive one task through the lifecycle against a scratch GitHub repo (or the local-origin fixture) to confirm the happy path + one gate rejection loop. Record evidence before claiming done.

### Chunk 6 review
Dispatch plan-document-reviewer on Chunk 6. Fix + re-dispatch until approved.

---

## Execution notes
- Each chunk is independently testable and leaves the app working (the old pipeline stays until Chunk 6).
- Implement in a dedicated worktree per superpowers:using-git-worktrees; the lifecycle engine itself is exercised only with fakes until Chunk 6's integration test.
- Skills to invoke during execution: superpowers:test-driven-development (every task), superpowers:systematic-debugging (on failures), superpowers:verification-before-completion (before "done").
