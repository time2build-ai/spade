# Task Lifecycle V2 — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorming), pending implementation plan
**Supersedes:** the 4-stage pipeline engine (`pipelines.py`) from `2026-06-15-spade-mvp-design.md`

## Problem

Spade's current task execution is a fixed, linear 4-stage pipeline (developer →
reviewer → integrator → documentor) that only flips a task's `status` column and
posts stage reports as comments. It does not match how the user actually ships
software, and critically **has zero git integration** — no branches, worktrees,
PRs, or merges. "Shipped" is a bare DB flip; nothing is ever pushed or merged.

The user's real workflow is:

> brainstorm → plan → implementation plan → **human approval** → build in a
> worktree → test → PR → PR review (findings as comments) → apply fixes → merge
> to development

with every step recorded as an activity note, and with visibility into which
environment (development / staging / production) each piece of work has reached.

## Goals

1. Model the user's real brainstorm→ship workflow as a first-class, **durable
   state machine** per task, not a linear stage chain.
2. Enforce **human gates by code**, not by prompt — a merge can never happen
   without a recorded human approval, even across server restarts.
3. Add real **git/GitHub integration**: isolated worktrees + feature branches,
   PR creation, review findings posted as PR comments, and merge-to-development.
4. Record **every lifecycle event as an activity note** on the task timeline —
   the complete, honest audit trail.
5. Track **environment promotion** (development → staging → production) by
   deriving it from merge commits, and give grouped promotions a home.
6. Reuse everything that already works: the tmux agent-spawn harness, the file
   mailbox protocol, account pools, and the poll loop.

## Non-Goals

- Replacing the conversational orchestrator or the existing in-memory
  permission/Opus **brakes** (those stay as-is; lifecycle gates are a new,
  durable, separate concept).
- Building a deploy system. Spade *observes* deploys (via branch ancestry) and
  *opens* promotion PRs; it does not run CI or deploy code itself. Merging a
  promotion PR remains a human action; prod auto-deploys on merge via the
  project's existing CI, outside Spade.
- Generating literal PDF files. The manual-test guide is markdown rendered as a
  kid-simple checklist with a browser print/save-as-PDF button.

## Terminology

- **Phase** — a node in the lifecycle state machine (`shaping`, `building`, …).
- **Gate** — a durable point where the machine waits for a human decision.
- **Brake** — the pre-existing, in-memory permission/model-ceiling interrupt.
  Distinct from a gate. Unchanged by this design.
- **Artifact** — a produced document pinned to the task (spec, plan, test guide,
  review report).
- **Promotion** — moving a set of merged tasks from one environment branch to the
  next via a PR (development→staging, staging→prod).

---

## Approach

A new **lifecycle engine** (`lifecycle.py`) implementing a proper per-task state
machine, a **git service** (`gitops.py`) that owns all git/GitHub interaction,
durable **gates** and **artifacts** tables, and client UI for the board, task
view, a new Releases page, and the gates page. The old `pipelines.py` engine is
retired.

Rejected alternatives:

- **Evolve the existing linear pipeline** — the stage-N→stage-N+1 model fights
  the loops we need (test-fail → re-implement, review → fix → re-review, gate
  rejection → re-shape). Gates and artifacts would be awkward bolt-ons.
- **Orchestrator-driven, no engine** — transitions decided by the conversational
  agent via mailbox signals. Non-deterministic; a gate enforced by prompt is the
  wrong trust model for merge approval.

---

## 1 · Data Model (SQLite)

`tasks` and `task_comments` are kept. New tables:

### `project_git` (one row per project)

| column | notes |
| --- | --- |
| `project_id` | PK/FK → projects |
| `repo_ssh_url` | e.g. `git@github.com:org/repo.git` |
| `dev_branch` | default `development` |
| `staging_branch` | default `staging` |
| `prod_branch` | default `main` |
| `worktrees_root` | default `~/.spade/worktrees/<project>` |

The Projects page gains a "Repository" settings section to edit these. When a
project has no local `path`, the git service clones `repo_ssh_url` on first use.

### `lifecycle_runs` (one active run per task)

| column | notes |
| --- | --- |
| `id`, `task_id` | one active (non-terminal) run per task; history retained |
| `phase` | `shaping · plan_review · building · pr_review · shipped · blocked` |
| `branch_name`, `worktree_path` | populated once building starts |
| `pr_number`, `pr_url` | populated once the PR opens |
| `merge_commit` | populated on merge to development |
| `env_dev_at`, `env_staging_at`, `env_prod_at` | timestamps when `merge_commit` first appears in each env branch |
| `agent_session_id`, `account_id` | current phase's agent, via existing spawn |
| `blocked_reason` | set when phase = `blocked` |
| `self_heal_attempts` | int, for the building test-fix loop (cap 3) |
| `created_at`, `updated_at` | |

### `artifacts`

| column | notes |
| --- | --- |
| `id`, `task_id` | |
| `kind` | `spec · plan · test_guide · review_report` |
| `title` | display title |
| `repo_path` | repo-relative path (spec/plan/test-guide are committed on the feature branch) |
| `branch` | branch the path lives on |
| `created_by` | agent id |
| `created_at` | |

Rationale for storing repo path + branch rather than inlined content: specs and
plans are committed to the branch (mirroring the superpowers flow), so the repo
is the source of truth; the task view reads them from the branch on demand.

### `gates`

| column | notes |
| --- | --- |
| `id`, `task_id` | |
| `gate` | `plan · manual_test · merge` |
| `status` | `waiting · approved · changes_requested` |
| `comment` | human's decision comment (fed into re-run prompt on changes) |
| `decided_by`, `decided_at` | |
| `created_at` | |

Durable rows mean a pending approval survives a server restart — unlike the
in-memory brakes.

### Status derivation

Task `status` (used by the board) becomes **derived** from the active run's
phase, so the board is always honest:

| run state | task status |
| --- | --- |
| no active run | `ready` |
| phase `shaping` | `shaping` |
| phase `plan_review` | `plan_review` |
| phase `building` | `building` |
| phase `pr_review` | `pr_review` |
| phase `shipped` | `shipped` |
| phase `blocked` | `blocked` (banner) |

The `STATUSES` enum in `tasks.py` is extended accordingly. Legacy statuses
(`in_progress`, `review`) are migrated: `in_progress → building`,
`review → pr_review`.

### Activity notes

Every phase change, gate decision, artifact creation, test run, PR event, and
promotion appends a `task_comments` row. New `kind` values:
`artifact · gate · test_report · review · progress` (existing: `note ·
stage_report · system`).

---

## 2 · Lifecycle Engine (`lifecycle.py`)

Graph-based state machine, structurally similar to today's `pipelines.py` but
with branching transitions and loops.

### Transition table

Each phase declares legal next phases; `move()` rejects illegal jumps with a
clear error (today's `move()` enforces nothing). An explicit `force=true` admin
path allows manual override, logged as a `system` note.

```
shaping        → plan_review
plan_review    → building            (plan gate approved)
               → shaping             (plan gate: changes requested)
building       → pr_review           (tests green + manual_test gate passed)
               → building            (test self-heal, attempts < 3)
               → blocked             (tests red after 3 attempts, or infra error)
pr_review      → shipped             (merge gate approved + merge succeeds)
               → pr_review           (new blocker findings → fix → re-review)
               → blocked             (merge conflict / push rejected / gh error)
blocked        → <phase it came from> (Retry phase)
any            → blocked             (agent death / infra failure)
```

### Phase agents

Agent-driven phases (`shaping`, `building`, `pr_review`) each spawn **one** agent
through the existing `_spawn_agent` tmux + mailbox harness. The phase prompt
invokes the user's superpowers skills by name:

- **shaping** — invoke `brainstorming` then `writing-plans`; ground the task
  against the Product Brain; commit `docs/specs/…-design.md` and
  `docs/plans/…-plan.md` on the feature branch; register both as artifacts;
  signal `finished` with a summary. Engine → `plan_review`, opens the **plan
  gate**. (The worktree/branch is created at the start of shaping so there is a
  place to commit the spec/plan — see gitops `prepare_workspace`.)
- **building** — invoke `executing-plans` + `test-driven-development` on the
  approved plan inside the worktree; run the project test suite; write the
  **test_guide** artifact (kid-simple numbered markdown); on green → open the
  **manual_test gate**. On red, invoke `systematic-debugging` and self-heal up
  to 3 attempts (`self_heal_attempts`), then → `blocked` with a `test_report`
  note listing failing tests.
- **pr_review** — push the branch; open the PR to `dev_branch` via `gh`; run
  review; post findings as **real PR comments** AND save a `review` note +
  `review_report` artifact; apply fixes; re-run tests; push. Then open the
  **merge gate** with a per-finding outcome summary (fixed / skipped /
  not-needed). The review step uses the project's PR-review command/skill.

### Gates

When a gate row goes `waiting`, the task card shows amber "waiting on you" and
the Human Gates page lists it. Endpoints:

```
POST /tasks/{id}/gates/{gate}/approve            body: { comment? }
POST /tasks/{id}/gates/{gate}/request-changes    body: { comment }
```

On `request-changes`, the comment is fed into the producing phase's re-run
prompt. Approve advances per the transition table.

### Engine driver

The existing poll loop already watches mailboxes for `finished` / `blocked`
signals for pipelines. The handler is routed to `lifecycle.advance()` instead of
`pipelines.complete_stage()`. No new daemon is introduced. On server restart the
poll loop re-attaches to still-alive tmux sessions (existing harness behavior);
durable `gates`/`lifecycle_runs` rows mean nothing waiting is lost.

---

## 3 · Git Service (`gitops.py`)

One module owns every git/GitHub interaction; the engine never shells out to git
directly. All `gh`/`git` calls sit behind a thin interface so tests can fake
GitHub while using a real local repo.

- **`prepare_workspace(task)`** — fetch; create branch
  `feat/SPD-NNN-<slug>` (or `fix/…` based on task type) off the latest
  `dev_branch`; add a worktree under `<worktrees_root>/SPD-NNN/`. The phase
  agent's `cwd` is the worktree, so parallel tasks never collide (replaces
  today's "agents work directly in the project checkout"). Called at the start
  of the shaping phase.
- **`open_pr(task)`** — push branch; `gh pr create --base <dev_branch>` with a
  body generated from the task + spec/plan artifact links; store
  `pr_number`/`pr_url`.
- **`post_review(pr, findings)`** — post findings as inline PR comments via
  `gh api`, so the audit trail exists on GitHub too.
- **`merge(task)`** — on merge-gate approval: `gh pr merge` (squash by default,
  configurable); record `merge_commit`; remove the worktree; delete the branch.
  Failure (conflict, red required CI) → task `blocked` with the exact stderr;
  merge conflicts additionally suggest "rebase on development" as the retry.
- **Env watcher** — periodic job on the poll loop (~60s): for tasks with a
  `merge_commit` not yet on prod, `git fetch` then
  `git merge-base --is-ancestor <merge_commit> origin/<staging_branch|prod_branch>`;
  when a commit newly lands, stamp `env_staging_at`/`env_prod_at` and post a
  "reached staging/production" activity note.
- **`promote(project, from_env, to_env)`** — the Releases page action: open the
  `dev→staging` or `staging→prod` PR via `gh`, body auto-listing every task
  whose commits are being promoted (the release note). Merging that PR is a human
  action; Spade observes it landing via the env watcher.

Every git/`gh` error is captured verbatim into a `system` activity note — no
silent failures.

---

## 4 · Client UI

### Backlog board

Columns become six: `Ready · Shaping · Plan review · Building · PR review ·
Shipped`. `Blocked` stays a banner (not a column). `Plan review` and `PR review`
cards get amber "waiting on you" styling with an inline **Review →** button.
Shipped cards show small `dev / staging / prod` env badges that light up as the
task's merge commit reaches each branch. The "Start here" banner surfaces pending
gates first (clearing a gate beats starting a new task).

### Task detail page

- **Artifacts panel** (pinned above the timeline): Spec, Plan, Test guide, Review
  report — each opens in a drawer rendering the markdown from the branch. The
  test guide is rendered as big numbered steps (one action per step), "✓ what you
  should see" callouts, tickable checkboxes, and a print button.
- **Gate action bar**: when a gate is `waiting`, a fixed bar appears — e.g. "Plan
  ready for review — Approve / Request changes" with a comment box.
- **Timeline**: today's "Pipeline history" becomes the full activity trail with
  per-kind icons (gate decisions, test reports with pass/fail counts, PR opened
  with link, review findings, promotions).

### Releases page (new, under PLAN in the sidebar)

Three lanes — Development / Staging / Production — each listing the tasks
currently there, with a **Promote** button between lanes that opens the env PR
and shows the auto-generated release note. The header shows the open promotion PR
if one exists.

### Human gates page

Lifecycle gates (`plan` / `manual_test` / `merge`) are listed alongside the
existing brakes, oldest first, each deep-linking to the task's gate bar.

---

## 5 · Failure Handling

One rule: **no failure is silent; every failure lands as a gate or a `blocked`
state with the evidence attached.**

- Agent death / tmux session vanishes mid-phase → `blocked`; note records the
  last mailbox signal + session log tail. A **Retry phase** button re-spawns the
  agent with the same inputs plus a "previous attempt failed because…" preamble.
- Tests red after 3 self-heal attempts → `blocked` with failing test names in a
  `test_report` note.
- Git/`gh` failures (push rejected, merge conflict, rate limit) → `blocked` with
  exact stderr; conflicts suggest a rebase retry.
- Gate rejections are **not** failures — they loop back to the producing phase
  with the human's comment, unlimited times.
- Server restart → durable `gates`/`lifecycle_runs` resume; poll loop re-attaches
  to live tmux sessions.

---

## 6 · Testing Strategy

Matches repo conventions (`.venv` pytest, in-memory SQLite via `db._migrate`).

- **Unit** — transition table (every legal/illegal move), gate state machine,
  status derivation, env-watcher ancestor logic against a scratch git repo built
  in a tmp dir (real `git`, no mocks).
- **Integration** — a fake-agent lifecycle run (spawn stubbed to immediately
  write `finished` to the mailbox) driving a task `ready → shipped` across all
  gates, asserting artifacts, notes, and a real local worktree/branch/merge (a
  local bare repo stands in for GitHub; `gh` calls behind the thin interface are
  faked).
- **Client** — Playwright e2e for board columns, gate action bar
  approve/reject, test-guide rendering, and the Releases page lanes, following
  the existing e2e setup.

---

## Migration & Rollout

1. Add new tables via `db._migrate`; migrate legacy task statuses
   (`in_progress → building`, `review → pr_review`).
2. Land `lifecycle.py` + `gitops.py` behind the existing spawn/poll
   infrastructure; retire `pipelines.py` (keep the table briefly for history,
   remove endpoints).
3. Ship UI changes; require `project_git.repo_ssh_url` before a task can leave
   `ready` (clear error in the gate bar if unset).

## Open Questions (non-blocking)

- Squash vs merge commit for `gh pr merge` — default squash, make configurable in
  `project_git` if needed.
- Whether the manual_test gate should be a per-task toggle (skippable) — deferred;
  ships always-on with the test guide, toggle can come later.
