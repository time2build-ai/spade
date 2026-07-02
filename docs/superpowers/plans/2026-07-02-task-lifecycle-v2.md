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
- Create: `apps/api/tui_pilot/project_git.py` — per-project repo config CRUD.
- Modify: `apps/api/tui_pilot/tasks.py` — extend `STATUSES`, add `TRANSITIONS` + guarded `move()`.
- Modify: `apps/api/tui_pilot/pipelines.py` — make the two board-reflection `move()` calls use `force=True` so the still-live pipeline keeps working under the new guard.
- Modify: `apps/api/tui_pilot/spade_server.py` — make the `POST /tasks/{id}/move` endpoint pass `force=True` (manual board drag stays unguarded during coexistence).
- Test: `apps/api/tests/test_project_git.py`, extend `apps/api/tests/test_tasks.py`.

**Coexistence rule (critical):** the old pipeline engine stays live until Chunk 6. It calls `tasks.move(task_id, "in_progress"|"review")` at runtime, so those two legacy values MUST remain in `STATUSES` through Chunks 1–5, and the pipeline's move calls must bypass the new transition guard. The destructive legacy-status remap (`in_progress→building`, `review→pr_review`) is therefore deferred to Chunk 6 (after the pipeline is retired), NOT done here — doing it in Chunk 1 would fight the running pipeline.

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

from tui_pilot import db

_WRITABLE = {"repo_ssh_url", "dev_branch", "staging_branch", "prod_branch", "worktrees_root"}
_DEFAULTS = {"dev_branch": "development", "staging_branch": "staging", "prod_branch": "main"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_worktrees_root(project_id: str) -> str:
    # Honor TUI_PILOT_HOME like the rest of the codebase (db.home()).
    return str(db.home() / "worktrees" / project_id)


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
            root = fields.get("worktrees_root") or _default_worktrees_root(project_id)
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

**Files:** Modify `apps/api/tui_pilot/tasks.py:13` and `:116-121`; `apps/api/tui_pilot/pipelines.py:156-159`; `apps/api/tui_pilot/spade_server.py` (`move_task` endpoint ~:120-126); extend `apps/api/tests/test_tasks.py`.

Board statuses become: `ready · shaping · plan_review · building · pr_review · shipped · blocked`, and legacy `in_progress`/`review` are RETAINED in the enum during coexistence (the live pipeline still writes them). `move()` gains a transition table; illegal jumps raise `ValueError` unless `force=True`.

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
# Lifecycle statuses first, then the two LEGACY values the live pipeline still
# writes (in_progress/review). Legacy values are dropped in Chunk 6 once the
# pipeline is retired; keeping them here means pipeline board moves stay valid.
STATUSES = ["ready", "shaping", "plan_review", "building", "pr_review",
            "shipped", "blocked", "in_progress", "review"]

# Legal forward transitions of the lifecycle state machine. "any -> blocked" and
# "blocked -> <resume>" are handled specially (see move). Board reads tasks.status;
# the lifecycle engine is the sole writer during a lifecycle run. Legacy statuses
# are intentionally absent — the pipeline moves them with force=True.
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
    (admin override + legacy pipeline moves); callers should log a system note
    when forcing an admin override.
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

- [ ] **Step 4: Keep the live pipeline + board-drag working under the guard** — the pipeline's board-reflection moves and the manual `/move` endpoint must bypass the transition table:
  - In `pipelines.py` `start_stage` (~:159), change `tasks.move(run["task_id"], target)` → `tasks.move(run["task_id"], target, force=True)`.
  - In `pipelines.py` `complete_stage` (~:194), change `tasks.move(run["task_id"], "shipped")` → `tasks.move(run["task_id"], "shipped", force=True)`.
  - In `spade_server.py` `move_task` (~:120-126), change the `tasks.move(task_id, req.status)` call → `tasks.move(task_id, req.status, force=True)` (board drag-drop stays unguarded during coexistence; the lifecycle engine is the guarded writer). Leave its existing test asserting 200 for `{"status":"review"}` untouched — it still passes.
- [ ] **Step 5: Run the FULL suite, verify pass** — `cd apps/api && make test` (or `../../.venv/bin/python -m pytest`). Expected: PASS, including `test_pipelines.py` and `test_spade_server.py` (the regressions this change could cause live there, not in `test_tasks.py`).
- [ ] **Step 6: Commit** — `git add apps/api/tui_pilot/tasks.py apps/api/tui_pilot/pipelines.py apps/api/tui_pilot/spade_server.py apps/api/tests/test_tasks.py && git commit -m "feat(lifecycle): transition-guarded task.move (+ force legacy pipeline moves)"`

> **Note — legacy status migration deferred:** the destructive remap of existing `in_progress→building` / `review→pr_review` rows is intentionally NOT in Chunk 1 (it would fight the still-running pipeline, which keeps writing those values). It lives in **Chunk 6 Task 6.2** after the pipeline is retired. There is no Task 1.4.

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

All functions take an explicit `repo_dir` (the main clone the runner executes `git` in) and build their `GitRunner` via `runner = runner_factory(repo_dir)`. `repo_dir` is required because after `git worktree remove` the worktree is gone, so cleanup, ancestry checks, and reads-at-branch must run from the persistent clone, not the worktree.

```python
# Signatures (in apps/api/tui_pilot/gitops.py)
class GitError(Exception): ...  # carries stderr

class GitRunner:
    def __init__(self, cwd: str): ...
    def run(self, *args: str) -> str:  # returns stdout; raises GitError(stderr) on nonzero
    def run_code(self, *args: str) -> int:  # returns exit code; for is-ancestor (0/1 both valid)

class GhClient(Protocol):
    def create_pr(self, cwd: str, base: str, head: str, title: str, body: str) -> dict: ...   # {number, url}
    def comment(self, cwd: str, pr_number: int, path: str, line: int, body: str) -> None: ...
    def merge(self, cwd: str, pr_number: int, method: str = "squash") -> str: ...              # merge commit sha

def prepare_workspace(cfg: dict, task_id: str, slug: str, kind: str = "feat", *,
                      repo_dir: str, runner_factory=GitRunner) -> dict:  # {branch_name, worktree_path}
def open_pr(cfg: dict, worktree: str, branch: str, base: str, title: str, body: str, *,
            gh: GhClient, runner_factory=GitRunner) -> dict:  # {pr_number, pr_url}; pushes branch first
def post_review(pr_number: int, findings: list[dict], *, gh: GhClient) -> None
def merge(cfg: dict, worktree: str, branch: str, pr_number: int, *, gh: GhClient,
          repo_dir: str, method: str = "squash", runner_factory=GitRunner) -> str
          # returns merge_commit sha; removes worktree + deletes local branch; remote-branch
          # delete is delegated to gh.merge(delete-branch) and is tolerant of a missing remote ref
def commit_reached_branch(commit: str, branch: str, *, repo_dir: str,
                          runner_factory=GitRunner) -> bool  # git merge-base --is-ancestor origin/<branch>
def read_at_branch(repo_path: str, branch: str, *, repo_dir: str,
                   runner_factory=GitRunner) -> str  # git show origin/<branch>:<repo_path>; for artifact drawer
def promote(cfg: dict, from_branch: str, to_branch: str, title: str, body: str, *,
            repo_dir: str, gh: GhClient) -> dict  # {pr_number, pr_url}
```

Note: `open_pr` maps the `GhClient`'s returned `{number, url}` to `{pr_number, pr_url}` (the tests assert `pr["pr_number"]`/`pr["pr_url"]`). All functions use `cfg.get(...)` so they tolerate being handed a full `project_git.get()` row.

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

- [ ] **Step 2: Run, verify fail** — `cd apps/api && ../../.venv/bin/python -m pytest tests/test_gitops.py::test_prepare_workspace_creates_branch_and_worktree -v` Expected: FAIL (module/function missing).
- [ ] **Step 3: Implement `GitRunner`, `GitError`, `_slugify`, `prepare_workspace`.** `GitRunner.run(*args)` wraps `subprocess.run(["git", *args], cwd=self.cwd, capture_output=True, text=True)` and raises `GitError(result.stderr)` when `returncode != 0`; `run_code(*args)` returns `result.returncode` without raising. `prepare_workspace(cfg, task_id, slug, kind="feat", *, repo_dir, runner_factory=GitRunner)` builds `runner = runner_factory(repo_dir)`, computes `branch = f"{kind}/{task_id}-{_slugify(slug)}"` and `wt = os.path.join(cfg.get('worktrees_root'), task_id)`, then `runner.run("fetch", "origin", cfg.get("dev_branch", "development"))` and `runner.run("worktree", "add", "-b", branch, wt, f"origin/{cfg.get('dev_branch','development')}")`. Return `{"branch_name": branch, "worktree_path": wt}`.
- [ ] **Step 4: Run, verify pass** — same command. Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/gitops.py apps/api/tests/test_gitops.py && git commit -m "feat(lifecycle): gitops GitRunner + prepare_workspace"`

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
```

- [ ] **Step 2: Run, verify fail** — `cd apps/api && ../../.venv/bin/python -m pytest tests/test_gitops.py -k "open_pr or post_review or merge" -v` Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `open_pr(cfg, worktree, branch, base, title, body, *, gh, runner_factory=GitRunner)`: `runner_factory(worktree).run("push", "-u", "origin", branch)`, then `res = gh.create_pr(worktree, base, branch, title, body)`, return `{"pr_number": res["number"], "pr_url": res["url"]}`.
  - `post_review(pr_number, findings, *, gh)`: for each finding `gh.comment(None, pr_number, f["path"], f["line"], f["body"])`.
  - `merge(cfg, worktree, branch, pr_number, *, gh, repo_dir, method="squash", runner_factory=GitRunner)`: `sha = gh.merge(worktree, pr_number, method)`; then clean up from the MAIN clone: `runner = runner_factory(repo_dir)`, `runner.run("worktree", "remove", "--force", worktree)`, `runner.run("branch", "-D", branch)`. For the remote branch, call `runner.run_code("push", "origin", "--delete", branch)` and ignore a nonzero result (remote ref may not exist — the `FakeGh` path never pushed it; the real path relies on `gh pr merge --delete-branch`). Return `sha`.
- [ ] **Step 4: Run, verify pass** — same `-k` command. Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/gitops.py apps/api/tests/test_gitops.py && git commit -m "feat(lifecycle): gitops open_pr/post_review/merge"`

### Task 2.3: commit_reached_branch + read_at_branch (env-watcher + artifact-drawer primitives)

Both run against the persistent clone (`repo_dir`), NOT a worktree — the env watcher and the artifact drawer run after merge, when the worktree is gone.

- [ ] **Step 1: Write failing tests** — using the `origin_and_clone` fixture: make a commit on the clone's `development`, `git push origin development`, capture the sha; assert `commit_reached_branch(sha, "development", repo_dir=work)` is True and `commit_reached_branch(sha, "nonexistent", repo_dir=work)` raises `GitError` (unknown ref) OR returns False per your chosen handling — pick False by pre-checking the ref exists. Also: commit a `docs/x.md` on development + push, assert `read_at_branch("docs/x.md", "development", repo_dir=work)` returns its contents.

```python
def test_commit_reached_branch_true_after_push(origin_and_clone):
    work = origin_and_clone["work"]
    (Path(work)/"g.txt").write_text("g"); _git(work, "add", "."); _git(work, "commit", "-m", "g")
    sha = subprocess.run(["git","rev-parse","HEAD"], cwd=work, capture_output=True, text=True).stdout.strip()
    _git(work, "push", "origin", "development")
    _git(work, "fetch", "origin")
    assert gitops.commit_reached_branch(sha, "development", repo_dir=work) is True


def test_read_at_branch_returns_file_contents(origin_and_clone):
    work = origin_and_clone["work"]
    (Path(work)/"docs").mkdir(exist_ok=True); (Path(work)/"docs"/"x.md").write_text("hello guide")
    _git(work, "add", "."); _git(work, "commit", "-m", "doc"); _git(work, "push", "origin", "development")
    _git(work, "fetch", "origin")
    assert "hello guide" in gitops.read_at_branch("docs/x.md", "development", repo_dir=work)
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `commit_reached_branch(commit, branch, *, repo_dir, runner_factory=GitRunner)`: `runner = runner_factory(repo_dir)`; return `runner.run_code("merge-base", "--is-ancestor", commit, f"origin/{branch}") == 0` (exit 0 = ancestor, 1 = not; guard other codes by first confirming the ref via `run_code("rev-parse", "--verify", f"origin/{branch}")`, treating a missing ref as False). `read_at_branch(repo_path, branch, *, repo_dir, runner_factory=GitRunner)`: return `runner_factory(repo_dir).run("show", f"origin/{branch}:{repo_path}")`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/gitops.py apps/api/tests/test_gitops.py && git commit -m "feat(lifecycle): gitops commit_reached_branch + read_at_branch"`

### Task 2.4: promote + RealGh (subprocess `gh`) — thin, no network in tests

- [ ] **Step 1: Write failing tests.** `promote(cfg, from_branch, to_branch, title, body, *, repo_dir, gh=FakeGh())` → returns `{pr_number, pr_url}` from `gh.create_pr(repo_dir, to_branch, from_branch, title, body)`. Separately, a `RealGh` command-construction test that monkeypatches `subprocess.run` to a recorder and asserts the argv (NO network, NO `gh` binary needed, NO skip):

```python
def test_realgh_create_pr_builds_expected_argv(monkeypatch):
    calls = []
    class R: returncode = 0; stdout = "https://github.com/o/r/pull/7\n"; stderr = ""
    monkeypatch.setattr(gitops.subprocess, "run", lambda *a, **k: calls.append(a[0]) or R())
    gitops.RealGh().create_pr("/w", "development", "feat/x", "T", "B")
    argv = calls[-1]
    assert argv[:3] == ["gh", "pr", "create"] and "--base" in argv and "development" in argv
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `promote`** (thin wrapper over `gh.create_pr`) and **`RealGh`**: `create_pr` runs `gh pr create --base <b> --head <h> --title <t> --body <body>` and parses the trailing PR URL from stdout (derive `number` from the URL's last path segment); `comment` runs `gh api repos/{owner}/{repo}/pulls/{n}/comments ...` (or a simpler `gh pr comment {n} --body` if inline anchoring is deferred — state which); `merge` runs `gh pr merge {n} --squash --delete-branch` and returns the merge sha via a follow-up `gh pr view {n} --json mergeCommit`. All via a module-level `subprocess` reference so tests can monkeypatch it.
- [ ] **Step 4: Run, verify pass** (the monkeypatched test runs everywhere, no skip).
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/gitops.py apps/api/tests/test_gitops.py && git commit -m "feat(lifecycle): gitops promote + RealGh client"`

### Chunk 2 review
Dispatch plan-document-reviewer on Chunk 2. Fix + re-dispatch until approved.

---

## Chunk 3: Lifecycle engine (lifecycle.py)

The state machine, gates, artifacts, and phase advancement — with `spawn` and `git` injected so it's unit-testable with a fake agent (no tmux) and a local repo (no GitHub), exactly like `test_pipelines.py`'s `fake_spawn`.

### File Structure
Split by responsibility from the start (avoids a mid-implementation refactor of a file holding runs + gates + artifacts + a 6-branch state machine):
- Create: `apps/api/tui_pilot/gates.py` — gate CRUD (`open_gate`, `decide`, `waiting_for_project`, `gate_for`).
- Create: `apps/api/tui_pilot/artifacts.py` — artifact CRUD (`register`, `for_task`, `repoint_to_branch`).
- Create: `apps/api/tui_pilot/lifecycle.py` — run CRUD, `PHASES`, `advance()`, `decide_gate()`, `retry()`, `run_env_watch()` (Chunk 4). Consumes `gates`/`artifacts`.
- Test: `apps/api/tests/test_gates.py`, `apps/api/tests/test_artifacts.py`, `apps/api/tests/test_lifecycle.py`.

### Model
```python
PHASES = ["shaping", "plan_review", "building", "pr_review", "shipped", "blocked"]
AGENT_PHASES = {"shaping", "building", "pr_review"}   # phases that spawn an agent
GATES = {"plan", "manual_test", "merge"}

# spawn signature (injected): spawn(run, phase) -> (session_id, account_id)
#   The engine writes the latest changes-requested gate comment onto run["resume_comment"]
#   (None when not resuming) BEFORE calling spawn, so both the real prompt builder
#   (Chunk 4 _phase_prompt) and a recording test spawn can read it from the run dict.
# git: an injected facade whose methods are prepare_workspace / open_pr / post_review /
#   merge / commit_reached_branch / read_at_branch. Artifact re-pointing is a DB update
#   owned by the engine (artifacts.repoint_to_branch) — NOT a git-facade method.
```

### Key behaviors (from spec §2)
- `start_run(project_id, task_id, spawn, git)` → creates a `lifecycle_runs` row (`phase=shaping`, `active=1`), calls `git.prepare_workspace`, stores branch/worktree, spawns the shaping agent, moves task → `shaping`, posts a `system` note.
- On shaping `finished`: register spec+plan artifacts (paths come in the agent report payload), phase → `plan_review`, open the **plan** gate, move task → `plan_review`.
- Gate decide `plan` approve → phase → `building`, spawn builder; `request_changes` → phase → `shaping`, re-spawn with the comment.
- On building `finished` with tests green: register `test_guide` artifact, open **manual_test** gate (task stays `building`; board shows amber via gate). Tests red: increment `self_heal_attempts`; if < 3 re-spawn builder, else phase → `blocked`, set `blocked_from_phase="building"` + `blocked_reason`, and move task → `blocked` (per spec §1 status derivation: any `blocked` phase moves the task to `blocked` so the board stays honest).
- **Defensive report parsing (all agent phases):** every `finished` report is expected JSON; on a parse failure post a `system` note with the raw report and move the run to `blocked` (never silently swallow — spec §5).
- Gate decide `manual_test` approve → engine calls `git.open_pr` and stores `pr_number`/`pr_url` (so the reviewer agent works against an open PR), phase → `pr_review`, spawn reviewer; `request_changes` → re-spawn builder.
- On pr_review `finished`: `git.post_review` against the stored `pr_number` + record findings note (`review`) and `review_report` artifact, open **merge** gate. (PR is already open from the manual_test-approve step — do NOT open it again here.)
- Gate decide `merge` approve → `git.merge`, record `merge_commit`, stamp `env_dev_at`, re-point artifacts to `dev_branch`, phase → `shipped`, `active=0`, move task → `shipped`, post system note.
- `retry(run)` from blocked → phase = `blocked_from_phase`, re-spawn.
- Every transition posts a `task_comments` row (kinds: `artifact`, `gate`, `test_report`, `review`, `progress`, `system`).

### Task 3.0: gates + artifacts CRUD modules

**Files:** Create `apps/api/tui_pilot/gates.py`, `apps/api/tui_pilot/artifacts.py`; Test `apps/api/tests/test_gates.py`, `apps/api/tests/test_artifacts.py`.

- [ ] **Step 1: Write failing tests** — `gates.open_gate(task_id, run_id, "plan")` creates a `waiting` row; `gates.decide(gate_id, "approved", comment=..., by=...)` sets status/`decided_at`; `gates.waiting_for_project(project_id)` returns waiting gates joined to their task; `gates.gate_for(run_id, "plan")` returns the row. `artifacts.register(task_id, run_id, "spec", title, repo_path, branch, by)` creates a row; `artifacts.for_task(task_id)` lists them; `artifacts.repoint_to_branch(task_id, "development")` updates every row's `branch`.
- [ ] **Step 2: Run, verify fail** — `cd apps/api && ../../.venv/bin/python -m pytest tests/test_gates.py tests/test_artifacts.py -v`.
- [ ] **Step 3: Implement** both modules as thin `db` wrappers (mirror `tasks.add_comment`/`comments`), returning dicts. `waiting_for_project` joins `gates`→`lifecycle_runs`→`tasks` on `project_id` and `status='waiting'`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/gates.py apps/api/tui_pilot/artifacts.py apps/api/tests/test_gates.py apps/api/tests/test_artifacts.py && git commit -m "feat(lifecycle): gates + artifacts CRUD modules"`

### Task 3.1: Run CRUD + start_run

- [ ] **Step 1: Write failing tests** (mirror `test_pipelines.py` `_setup` + `fake_spawn`):

```python
# apps/api/tests/test_lifecycle.py
from tui_pilot import lifecycle, tasks, projects


class FakeGit:
    """Injected git facade — records calls, no real repo needed for engine tests.
    Note: artifact re-pointing is NOT here — it's an engine-owned DB update
    (artifacts.repoint_to_branch)."""
    def __init__(self): self.calls = []; self.merge_sha = "sha123"
    def prepare_workspace(self, cfg, task_id, slug, kind="feat"):
        self.calls.append(("prepare", task_id))
        return {"branch_name": f"feat/{task_id}-{slug}", "worktree_path": f"/wt/{task_id}"}
    def open_pr(self, *a, **k): self.calls.append(("open_pr",)); return {"pr_number": 7, "pr_url": "u/7"}
    def post_review(self, *a, **k): self.calls.append(("post_review",))
    def merge(self, *a, **k): self.calls.append(("merge",)); return self.merge_sha


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


def test_start_run_rejects_a_second_active_run():
    tid = _setup()
    lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    import pytest
    with pytest.raises(ValueError):
        lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
```

- [ ] **Step 2: Run, verify fail** — `cd apps/api && ../../.venv/bin/python -m pytest tests/test_lifecycle.py -k start_run -v` Expected: FAIL.
- [ ] **Step 3: Implement** `start_run` (guard: raise `ValueError` if `active_run_for_task(task_id)` exists), `get`, `active_run_for_task`, `_set_run`, `_now`, `_new_id`. `start_run` calls `git.prepare_workspace`, stores `branch_name`/`worktree_path`, sets `phase="shaping"`/`active=1`, spawns the shaping agent (stamps `agent_session_id`), `tasks.move(task_id, "shaping")`, posts a `system` note.
- [ ] **Step 4: Run, verify pass** — same command. Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/lifecycle.py apps/api/tests/test_lifecycle.py && git commit -m "feat(lifecycle): start_run + run CRUD"`

### Task 3.2: advance() through shaping → plan gate

- [ ] **Step 1: Failing test** — after `start_run`, call `lifecycle.advance(run_id, phase="shaping", report=<json with spec/plan paths>, spawn=_spawn, git=FakeGit())`; assert phase == `plan_review`, task == `plan_review`, `gates.gate_for(run_id,"plan")` is `waiting`, and `artifacts.for_task(tid)` has a `spec` and a `plan`.
- [ ] **Step 2: Run, verify fail** — `pytest tests/test_lifecycle.py -k shaping_advance -v`.
- [ ] **Step 3: Implement `advance()` shaping branch** — parse the report as JSON `{"spec_path","plan_path","summary"}`; register both artifacts (on the run's `branch_name`), post a `progress` note with the summary, phase → `plan_review`, `tasks.move → plan_review`, `gates.open_gate(...,"plan")`. Defensive parse: on JSON failure, `system` note + move run to `blocked` (per Model). Handle the `{"no_changes": true}` case per Task 3.6.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 3.3: Gate decisions (plan approve/reject)

- [ ] **Step 1: Failing tests** — `decide_gate(run_id, "plan", "approved", spawn=_spawn, git=FakeGit())` → phase `building`, task `building`, builder spawned, gate `approved` with `decided_at`. For `request_changes` use a recording spawn that captures `run.get("resume_comment")`:

```python
def test_plan_request_changes_threads_comment_into_respawn():
    tid = _setup()
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    lifecycle.advance(run["id"], phase="shaping",
                      report='{"spec_path":"docs/s.md","plan_path":"docs/p.md","summary":"ok"}',
                      spawn=_spawn, git=FakeGit())
    seen = {}
    def rec(run, phase): seen["comment"] = run.get("resume_comment"); return ("s", "a")
    lifecycle.decide_gate(run["id"], "plan", "changes_requested",
                          comment="tighten scope", spawn=rec, git=FakeGit())
    assert seen["comment"] == "tighten scope"
    assert lifecycle.get(run["id"])["phase"] == "shaping"
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `decide_gate(run_id, gate, decision, *, comment=None, spawn, git)`** — `gates.decide(...)`; on `approved` advance per the gate (plan→building spawn builder; manual_test→open_pr+pr_review spawn reviewer; merge→merge+ship, Task 3.5); on `changes_requested` set `run["resume_comment"]=comment`, move phase back to the producing phase, and re-spawn (the engine sets `resume_comment` on the run dict before calling `spawn`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 3.4: building → manual_test gate, self-heal, blocked

- [ ] **Step 1: Failing tests** — advance building with `report='{"tests":"green","test_guide_path":"docs/tg.md"}'` → `test_guide` artifact + `manual_test` gate waiting, task still `building`. With `'{"tests":"red","failing":["t1"]}'` → self_heal re-spawn and `self_heal_attempts==1`; after 3 red advances → phase `blocked`, `blocked_from_phase=="building"`, `tasks.get(tid)["status"]=="blocked"`, and a `test_report` note lists the failing tests.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement building branch of `advance()`** — green: register `test_guide` artifact, `gates.open_gate(...,"manual_test")` (task stays `building`). red: increment `self_heal_attempts`; if `< 3` re-spawn builder with a `test_report` note; else phase → `blocked`, set `blocked_from_phase="building"` + `blocked_reason`, `tasks.move(tid,"blocked")`, post the `test_report` note.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 3.5: pr_review → merge gate → shipped

- [ ] **Step 1: Failing tests** — approve `manual_test` → `git.open_pr` called (assert `("open_pr",) in fakegit.calls`), `pr_number` stored, phase `pr_review`, reviewer spawned. advance pr_review with `report='{"findings":[{"path":"a.py","line":1,"body":"x"}],"summary":"ok"}'` → `git.post_review` called, `review` note + `review_report` artifact, `merge` gate waiting. approve `merge` → `git.merge` called, `merge_commit`==FakeGit.merge_sha + `env_dev_at` set, `artifacts.for_task` rows now on `development`, phase `shipped`, task `shipped`, run `active=0`, `system` note posted.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** In `decide_gate` manual_test-approve branch: `git.open_pr(...)`, store `pr_number`/`pr_url`, phase → `pr_review`, spawn reviewer. In `advance()` pr_review branch: parse findings, `git.post_review(pr_number, findings)`, post `review` note, register `review_report` artifact, `gates.open_gate(...,"merge")`. In `decide_gate` merge-approve branch: `sha = git.merge(...)`, set `merge_commit=sha` + `env_dev_at=_now()`, `artifacts.repoint_to_branch(task_id, cfg dev_branch)`, phase → `shipped`, `active=0`, `tasks.move(tid,"shipped")`, `system` note.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 3.6: retry from blocked + empty-change edge

- [ ] **Step 1: Failing tests** — a blocked run (blocked_from_phase="building") → `lifecycle.retry(run_id, spawn=_spawn, git=FakeGit())` sets phase back to `building`, task → `building`, re-spawns. Empty-change: advance shaping with `'{"no_changes": true}'` → phase `blocked`, task `blocked`, a "no changes produced" `system` note (per spec §3).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `retry(run_id, *, spawn, git)`** — phase = `blocked_from_phase`, `tasks.move` to it, re-spawn that phase's agent. And the shaping `no_changes` guard in `advance()`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Chunk 3 review
Dispatch plan-document-reviewer on Chunk 3. Fix + re-dispatch until approved.

---

## Chunk 4: Server wiring (endpoints + poll-loop advance + real spawn)

Wire the engine to HTTP and to the tmux/mailbox poll loop, mirroring the pipeline glue exactly.

### File Structure
- Create: `apps/api/tui_pilot/lifecycle_git.py` — the `_lifecycle_git(project_id)` facade: resolves the persistent clone dir, wraps `gitops` free functions (binding `repo_dir` + a `RealGh`) into the object the engine calls (`prepare_workspace/open_pr/post_review/merge/commit_reached_branch/read_at_branch`).
- Modify: `apps/api/tui_pilot/spade_server.py` — lifecycle request models, `_lifecycle_spawn` (real spawn + `_meta` stamp), `_phase_prompt`, endpoints. `_lifecycle_git` is imported from `lifecycle_git.py`.
- Modify: `apps/api/tui_pilot/server.py` — `_collect_lifecycle_advance`, `_drain_lifecycle_advance`, env-watch tick; hook into `_poll_loop`.
- Test: `apps/api/tests/test_lifecycle_git.py`, `test_spade_server.py` (endpoints), `test_server.py` (collector).

**Clone location (resolves the repo_dir gap):** `_lifecycle_git` maintains ONE persistent working clone per project at `<worktrees_root>/.repo`. On first use it `git clone <repo_ssh_url> <worktrees_root>/.repo` (if absent); this clone is the `repo_dir` passed to every `gitops` call — `prepare_workspace` adds worktrees off it, and `merge`/`commit_reached_branch`/`read_at_branch` run in it after worktrees are gone. `project_git` needs no new column; the path is derived from `worktrees_root`.

### Task 4.0: `_lifecycle_git` facade

**Files:** Create `apps/api/tui_pilot/lifecycle_git.py`; Test `apps/api/tests/test_lifecycle_git.py`.

- [ ] **Step 1: Write failing test** — with a `project_git` row whose `worktrees_root` points into a tmp dir and `repo_ssh_url` set to a local bare origin path, `git = lifecycle_git.for_project("acme")` exposes the engine methods; `git.prepare_workspace(task_id="SPD-9", slug="x")` returns a branch+worktree and the persistent clone now exists at `<worktrees_root>/.repo`. (Use a local path as the "ssh url" so `git clone` works offline; inject a `FakeGh` via a module hook so no network.)
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `for_project(project_id, *, gh=None)`** returning an object that: loads `cfg = project_git.get(project_id)`; computes `repo_dir = os.path.join(cfg["worktrees_root"], ".repo")`; `_ensure_clone()` runs `git clone <repo_ssh_url> <repo_dir>` if missing; and exposes `prepare_workspace(task_id, slug, kind="feat")`, `open_pr(...)`, `post_review(...)`, `merge(...)`, `commit_reached_branch(...)`, `read_at_branch(...)` — each delegating to the `gitops` free function with `repo_dir=self.repo_dir` and `gh=self._gh` (default `gitops.RealGh()`; tests inject `FakeGh`). This is the object `spade_server._lifecycle_git(project_id)` returns.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add apps/api/tui_pilot/lifecycle_git.py apps/api/tests/test_lifecycle_git.py && git commit -m "feat(lifecycle): _lifecycle_git facade + persistent clone"`

### Task 4.1: `_lifecycle_spawn` + phase prompts

**Files:** Modify `spade_server.py` (near `_pipeline_spawn` at :351-384). Add `_lifecycle_git = lifecycle_git.for_project`.

- [ ] **Step 1: Implement `_phase_prompt(run, phase)`** returning the phase instructions that invoke superpowers skills by name (shaping → brainstorming+writing-plans, building → executing-plans+TDD, pr_review → requesting-code-review + the project's PR review). Include the resume context by reading `run.get("resume_comment")` (from a prior `changes_requested`) and the prior artifacts, so the closure needs no separate report argument. Each prompt instructs the agent to end with a `finished` handoff whose report is the exact JSON payload the engine parses (shaping: `{spec_path,plan_path,summary}`; building: `{tests,test_guide_path,failing?}`; pr_review: `{findings,summary}`).
- [ ] **Step 2: Implement `_lifecycle_spawn(run)`** returning a `spawn(run, phase)` closure that calls `server._spawn_agent(name=f"{phase}-{run['id']}", role=phase, project_id=run['project_id'], cwd=run['worktree_path'], task=_phase_prompt(run, phase), mission=run["id"], parent=None)`, then stamps `_meta[sid]["lifecycle_phase"]=phase` and `_meta[sid]["lifecycle_run_id"]=run["id"]` (run_id written LAST, matching the pipeline gate-key ordering), returns `(sid, info.get("account_id"))`. `mission=run["id"]` links the session row back to the run (mirrors the pipeline glue).
- [ ] **Step 3: Smoke-check** — a test that `_phase_prompt(run, "shaping")` renders a non-empty string mentioning "brainstorming" and the expected JSON keys; commit.

Notes: `cwd` is the **worktree_path** (not the project path), so each lifecycle agent works in isolation; `prepare_workspace` ran in `start_run`. `role=phase` (`shaping`/`building`/`pr_review`) — `_spawn_agent` tolerates unknown role ids (falls back to `name`), so no `roles_seed` change is required; do NOT add planner/builder/reviewer role rows (the ids wouldn't match the phase names).

### Task 4.2: Poll-loop lifecycle collector/drainer

**Files:** Modify `server.py` — add beside `_collect_pipeline_advance` (:243) and `_drain_pipeline_advance` (:271).

- [ ] **Step 1: Write failing test** (`test_server.py`) — construct a `_meta` entry with `lifecycle_run_id`, feed a fake `HarnessState(kind="done", report=...)`, assert `_collect_lifecycle_advance` returns `(run_id, phase, report)` once and is `None` on the second call (once-guard).
- [ ] **Step 2-3: Implement**:

```python
def _collect_lifecycle_advance(aid, harness_state):
    from tui_pilot import lifecycle
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
    if lifecycle.get(run_id) is None:  # vanished run — don't burn the once-flag
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
  - `GET /tasks/{id}/artifacts` → `artifacts.for_task(id)`; `GET /tasks/{id}/artifacts/{artifact_id}/content` → looks up the artifact row, then `_lifecycle_git(project_id).read_at_branch(artifact["repo_path"], artifact["branch"])` (works for shipped tasks too, since artifacts were re-pointed to `development` on merge and the read runs in the persistent clone). Returns `{content}`.
  - `GET /projects/{id}/git` + `PUT /projects/{id}/git` → `project_git.get/upsert`.
  - `GET /projects/{id}/releases` → env lanes: tasks grouped by furthest env reached (from `lifecycle_runs.env_*_at`).
  - `POST /projects/{id}/promote` `{from_env, to_env}` → `gitops.promote(...)`.
  - `GET /projects/{id}/gates` → all `waiting` lifecycle gates for the gate page.
- [ ] **Step 4: Run tests, commit.**

### Task 4.4: Env watcher on the poll loop

- [ ] **Step 1: Failing test** — a shipped run with `merge_commit` set and a fake `git` whose `commit_reached_branch` returns True for staging → after `lifecycle.run_env_watch("acme", git)` the run's `env_staging_at` is stamped and a `system` "reached staging" note is posted; a second call posts nothing (idempotent: skip runs that already have the stamp).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `lifecycle.run_env_watch(project_id, git)`** — query `lifecycle_runs` where `merge_commit IS NOT NULL AND env_prod_at IS NULL` for the project; for each, if `env_staging_at` is null and `git.commit_reached_branch(merge_commit, cfg staging_branch)` → stamp + note; likewise prod. Also `lifecycle.projects_with_pending_env()` → distinct project_ids with such runs.
- [ ] **Step 4: Wire into `_poll_loop`** — the loop (`while True` at server.py:193) gets a module-level tick counter incremented each iteration; every 60th tick (~60s), for each `pid in lifecycle.projects_with_pending_env()` call `lifecycle.run_env_watch(pid, spade_server._lifecycle_git(pid))`. Guard the whole block in try/except so a git error posts a `system` note and never kills the loop.
- [ ] **Step 5: Commit.**

### Chunk 4 review
Dispatch plan-document-reviewer on Chunk 4. Fix + re-dispatch until approved.

---

## Chunk 5: Client UI

SWR throughout. Add endpoints to `lib/api.ts`, types to `lib/types.ts`, then the five UI surfaces. Every new interactive element gets a `data-testid`.

### Task 5.1: API + types

**Files:** Modify `apps/client/lib/api.ts`, `apps/client/lib/types.ts`.

- [ ] **Step 1:** Add `Status` values `shaping|plan_review|building|pr_review` to the `Status` union + `STATUSES` (`types.ts:1-9`), and KEEP the legacy `in_progress|review` values in the union (the pipeline still emits them until Chunk 6, and `TaskCard.tsx:41`/`STATUS_COLOR` reference them). Add `LifecycleRun`, `Gate`, `Artifact`, `ProjectGit`, `ReleaseLanes` interfaces.
- [ ] **Step 2:** Add `api` methods: `startLifecycle`, `lifecycle(runId)`, `lifecycleList(projectId)`, `approveGate(taskId, gate, comment?)`, `requestGateChanges(taskId, gate, comment)`, `retryLifecycle(runId)`, `artifacts(taskId)`, `artifactContent(taskId, artifactId)`, `projectGit(projectId)`, `updateProjectGit(projectId, body)`, `releases(projectId)`, `promote(projectId, from, to)`, `lifecycleGates(projectId)` — each following the `http<T>("/path", {...})` pattern.
- [ ] **Step 3: Commit.**

### Task 5.2: Board columns + gate-amber cards

**Files:** `apps/client/app/backlog/page.tsx` (data plumbing), `components/backlog/Board.tsx:10-15` (+ props), `lib/adapters.ts:86-94`, `components/backlog/TaskCard.tsx` (+ props, legacy pill fix), task page `STATUS_COLOR`.

- [ ] **Step 1:** Extend `COLUMNS` to `ready · shaping · plan_review · building · pr_review · shipped` with colors; ensure `tasksByStatus` buckets the new statuses; add the new keys to the task page `STATUS_COLOR` (keep `in_progress`/`review` keys). In `TaskCard.tsx:41`, change the building-pill derivation from `task.status === "in_progress"` to `task.status === "building"` (post-migration the pill keys on the new value).
- [ ] **Step 2: Plumb gate + run data from the page.** In `app/backlog/page.tsx`, add `useSWR` for `api.lifecycleGates(project.id)` and `api.lifecycleList(project.id)`; derive `gatedTaskIds: Set<string>` (task ids with a `waiting` gate) and `runsByTask: Record<string, LifecycleRun>`; pass both into `<Board>` as new props, and `Board` forwards per-card `gated`/`run` into `<TaskCard>` (extend `BoardProps`/`TaskCardProps`). When `gated`, `TaskCard` renders amber "waiting on you" + an inline **Review →** link to `/task/{id}` (`data-testid="card-gate-review"`). This gives the `manual_test` gate — task still `building` — its visible home.
- [ ] **Step 3:** In `TaskCard`, when `run` has `env_*_at`, render `dev/staging/prod` badges (`data-testid="env-badge-*"`) on shipped cards.
- [ ] **Step 4: e2e** `e2e/backlog.spec.ts` — keep the existing `mock()` routes (always `/api/projects`, `/api/tasks`) and ADD `/api/projects/*/gates` + `/api/lifecycle`; assert six columns and an amber gated card via `getByTestId`. Commit.

### Task 5.3: Task view — artifacts panel + gate action bar + timeline

**Files:** `apps/client/app/task/[id]/page.tsx`.

- [ ] **Step 1:** Add `useSWR` for `artifacts(taskId)` and the task's lifecycle run/gate. Render an **Artifacts panel** (Spec, Plan, Test guide, Review report) above the existing "Pipeline history" (after :297); each opens a drawer rendering `artifactContent` markdown. Test guide gets the kid-simple treatment (big numbered steps, tickable checkboxes, print button).
- [ ] **Step 2:** Add a **Gate action bar** (mirror `headerActions` :114-127) shown when a gate is `waiting`: label + Approve / Request changes + comment box → `api.approveGate` / `api.requestGateChanges` then `mutate`.
- [ ] **Step 3:** Replace the "Start/Resume pipeline" button (`runPipeline` :97-112) with **Start lifecycle** → `api.startLifecycle` then stay on the task (SWR polls the run).
- [ ] **Step 4:** Upgrade the timeline to render the new comment kinds with icons (gate, test_report, review, artifact, progress).
- [ ] **Step 5: e2e** `e2e/task-detail.spec.ts` — mock artifacts + a waiting gate; assert the gate bar and artifact drawer. Commit.

### Task 5.4: Releases page

**Files:** Create `apps/client/app/releases/page.tsx`; modify `components/shell/Sidebar.tsx` (nav), `lib/useShell.ts` (optional count), `components/Icon.tsx` (reuse `bolt`/`orch`).

- [ ] **Step 1:** Add the `{ label: "Releases", icon: "bolt", href: "/releases" }` nav item under the **PLAN** group in `PROJECT_GROUPS` (per spec §4 "under PLAN"), not Execution. No `CountKey`/badge is added, so no union edit is needed.
- [ ] **Step 2:** Build the page: three lanes (Development / Staging / Production) from `api.releases(projectId)`, each listing tasks; **Promote** buttons between lanes → `api.promote` (open the env PR) showing the auto-generated release note; header shows the open promotion PR if any.
- [ ] **Step 3: e2e** `e2e/releases.spec.ts` — mock `/api/projects/*/releases`; assert three lanes + a promote button. Commit.

### Task 5.5: Gate page — lifecycle gates alongside brakes

**Files:** `apps/client/app/gate/page.tsx`, `components/gate/LifecycleGateCard.tsx` (new).

- [ ] **Step 1: Restructure the early return.** `gate/page.tsx:27` currently early-returns the "No human gates right now." empty state whenever `!brake`. Change the guard to show the empty state only when there is NO brake AND NO lifecycle gate, so lifecycle gates render even with no brake present.
- [ ] **Step 2: New card component.** `GateCard.tsx` is typed to `Brake` with `onAllow/onSkip(id)`; a lifecycle `Gate` has `gate/status/comment/task_id` and needs `(taskId, gate)`. Create `LifecycleGateCard.tsx` (mirroring `GateCard`'s amber styling) typed to `Gate`, with `onApprove(taskId, gate)` / `onRequestChanges(taskId, gate, comment)`. Do not try to overload the brake card.
- [ ] **Step 3:** Add `useSWR(project ? ["lifecycle-gates", project.id] : null, () => api.lifecycleGates(project.id), {refreshInterval:4000})`; render a list of `<LifecycleGateCard>` (approve → `api.approveGate` then `mutate`; reject → `api.requestGateChanges`) alongside the existing brake banner.
- [ ] **Step 4: e2e** `e2e/gate.spec.ts` — KEEP existing mocks (`/api/projects`, `/api/brakes`, `/api/gate/conflict`) and add `/api/projects/*/gates`; assert a lifecycle gate card renders (with no brake present) and Approve calls the endpoint. Commit.

### Task 5.6: Project Repository settings

**Files:** `apps/client/app/settings/page.tsx`, `lib/api.ts` (already has `updateProjectGit` from 5.1). No `Project` type change is needed — Repository config is the separate `ProjectGit` entity, not fields on `Project`.

- [ ] **Step 1:** Add a bespoke **Repository** `<section className="set-group">` (before Danger zone ~:88) with controlled inputs for `repo_ssh_url`, `dev_branch`, `staging_branch`, `prod_branch`, persisting via `api.updateProjectGit(project.id, ...)` (mirror the autopilot toggle persistence at :48-56). Load current values via `useSWR(project ? ["project-git", project.id] : null, () => api.projectGit(project.id))`. Give inputs `data-testid`s (`repo-ssh-url`, `branch-dev`, …).
- [ ] **Step 2: e2e** `e2e/settings.spec.ts` — KEEP existing mocks (`/api/projects`) and add `/api/projects/*/git`; assert inputs render and save calls PUT. Commit.

### Chunk 5 review
Dispatch plan-document-reviewer on Chunk 5. Fix + re-dispatch until approved.

---

## Chunk 6: Retire pipelines + full-suite integration

### Task 6.1: End-to-end lifecycle integration test (fake agent, real local repo, fake gh)

**Files:** `apps/api/tests/test_lifecycle_integration.py`.

The engine consumes a `git` facade. Real `gitops` are free functions needing a `repo_dir` + `GhClient`; `lifecycle_git.for_project(project_id, gh=...)` already wraps them and accepts an injected gh. So the integration test uses **`lifecycle_git.for_project("acme", gh=FakeGh())`** — REAL `git` for workspace/merge/cleanup against a local bare-origin repo, FAKE gh for PR number/merge sha (no network).

- [ ] **Step 1:** Build the `origin_and_clone` fixture (from Chunk 2) and a `project_git` row whose `repo_ssh_url` is the local bare origin path and `worktrees_root` is a tmp dir. Drive a task `ready → shipped`: `lifecycle.start_run` → `advance(shaping, report)` → `decide_gate(plan, approved)` → `advance(building, tests green)` → `decide_gate(manual_test, approved)` → `advance(pr_review, findings)` → `decide_gate(merge, approved)`, all with a stub `spawn` (returns fake session ids) and `git=lifecycle_git.for_project("acme", gh=FakeGh())`. For the shaping/building agents to have real files to commit, the stub spawn writes the spec/plan/test-guide docs into the worktree before returning. Assert: artifacts registered + re-pointed to `development`, all three gate rows `approved`, a real branch was created + merged (merge commit on `development`) + worktree removed, task `shipped`, and a `task_comments` note exists for each event kind.
- [ ] **Step 2: Run, verify pass. Commit.**

### Task 6.2: Retire the pipeline engine (writes only) + legacy status migration

**Files:** `spade_server.py` (remove pipeline WRITE endpoints + `_pipeline_spawn`/`_stage_prompt`), `server.py` (remove `_collect_pipeline_advance`/`_drain_pipeline_advance` hooks), `db.py` (`_migrate`), plus the enumerated tests/clients.

- [ ] **Step 1: Remove the pipeline WRITE path, keep reads.** Delete `POST /pipelines`, `POST /pipelines/{id}/start`, `POST /pipelines/{id}/advance`, `_pipeline_spawn`, `_stage_prompt`. **KEEP** `GET /pipelines` and `GET /pipelines/{run_id}` read-only for one release (consistent with "tables read-only"), because these client read sites still call them and are NOT migrated here: `app/active/page.tsx`, `app/page.tsx` (dashboard, ~:63/173/176), `app/overview/page.tsx:31`, and the task page's history. Remove the pipeline poll-loop hooks (`_collect_pipeline_advance`/`_drain_pipeline_advance` calls) from `_poll_loop`; the lifecycle hooks remain. Keep `pipelines.py` module + tables (no new writes) and `roles_seed.upsert_pipeline_roles()` (harmless). Guard/leave the pipeline-reattach block at `server.py:814-827` — it no-ops once no runs advance.
- [ ] **Step 2: Update the client writes.** Remove `createPipeline`/`startPipeline`/`advancePipeline` from `lib/api.ts` and the task page's Start button (already replaced by `startLifecycle` in 5.3). Leave `api.pipelines()` (GET) in place for the four read sites above.
- [ ] **Step 3: Enumerate + fix broken backend tests.** These reference the removed write path and MUST be updated/trimmed, not left red: `apps/api/tests/test_pipelines.py` (the `start_stage`/`complete_stage`/`create_run` tests — delete or mark legacy since the engine is dormant), `apps/api/tests/test_spade_server.py` (~16 pipeline refs — remove the write-endpoint tests, keep GET tests), `apps/api/tests/test_server.py` (~9 refs incl. the `_collect_pipeline_advance` tests — delete those). Note: `test_sprints.py` sprint counts derive from pipeline runs and will now freeze — assert current behavior, don't treat as a regression (or point sprints at lifecycle runs as a follow-up, out of scope here).
- [ ] **Step 4: Deferred legacy status migration** — now that the pipeline no longer writes `in_progress`/`review`, add the remap to `db._migrate` (idempotent) and drop the two legacy values from `tasks.STATUSES` + the client `Status` union:

```python
    # (in db._migrate, after the additive-column loop)
    conn.execute("UPDATE tasks SET status = 'building'  WHERE status = 'in_progress'")
    conn.execute("UPDATE tasks SET status = 'pr_review' WHERE status = 'review'")
```

  Add a `test_db.py` test asserting a legacy `in_progress` row becomes `building`. Then remove `"in_progress","review"` from `tasks.STATUSES` and from `TaskCard`/`STATUS_COLOR`/`lib/types.ts`.
- [ ] **Step 5:** Add a `# TODO(cleanup, next release): drop pipeline_runs/pipeline_stages` note in `schema.sql`.
- [ ] **Step 6: Run full suite** `make test` + `cd apps/client && npx playwright test`. Fix regressions. Commit.

### Task 6.3: Verification before completion

- [ ] Use superpowers:verification-before-completion. Run `make test` (backend green), `npx playwright test` (e2e green), and manually drive one task through the lifecycle against a scratch GitHub repo (or the local-origin fixture) to confirm the happy path + one gate rejection loop. Record evidence before claiming done.

### Chunk 6 review
Dispatch plan-document-reviewer on Chunk 6. Fix + re-dispatch until approved.

---

## Execution notes
- Each chunk is independently testable and leaves the app working (the old pipeline stays until Chunk 6).
- Implement in a dedicated worktree per superpowers:using-git-worktrees; the lifecycle engine itself is exercised only with fakes until Chunk 6's integration test.
- Skills to invoke during execution: superpowers:test-driven-development (every task), superpowers:systematic-debugging (on failures), superpowers:verification-before-completion (before "done").
