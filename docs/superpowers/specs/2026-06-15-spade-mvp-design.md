# Spade MVP — Design

**Date:** 2026-06-15
**Status:** Approved (autonomous, grounded in `docs/spade-alignment.md` + design handoff)
**Builds on:** the projects/accounts/persistence foundation (`docs/superpowers/specs/2026-06-15-projects-accounts-design.md`).

## 1. What the MVP proves

Spade's thesis: a product-management workspace where work flows from a typed **Product Brain** through an **agent pipeline** with full traceability. The MVP delivers the smallest end-to-end vertical slice of that thesis on top of the existing foundation (projects, accounts, agent fleet, orchestrator, SQLite):

> A PM creates a **Task** in a project → grounds it against the **Product Brain** (links to feature/decision/feedback nodes) → runs a 4-stage agent **Pipeline** (Developer → Reviewer → Integrator → Documentor) that spawns real `claude` agents on the project's account pool → watches stage progress → ships it. The Backlog (kanban) and Brain (graph) views give traceability.

Deferred to post-MVP (explicitly out of scope): data-source ingestion (meetings, feedback clusters, integrations, Sentry/Jira), sprints, human-gate conflict detection against ADRs, the conversational Brain (Ask), multi-provider accounts, cost/usage tracking. These are named in `docs/spade-alignment.md` §Gap List.

## 2. Scope — the four MVP capabilities

1. **Tasks + Backlog** — a `tasks` table; CRUD; a 4-column kanban (Ready / In progress / Review / Shipped) with feature + priority; a task detail panel showing origin + grounded brain nodes + its pipeline.
2. **Product Brain** — `brain_nodes` (typed: feature/decision/feedback/bug/metric) + `brain_edges`; CRUD; an SVG graph view; tasks link to nodes (`task_nodes`) for grounding. ADRs are modeled as `decision`-type nodes (no separate table — keeps the MVP tight).
3. **Pipelines** — `pipeline_runs` + `pipeline_stages`; starting a pipeline on a task spawns the Developer agent into the task's project (account-pool aware, via the foundation's `_spawn_agent`); stages advance through Developer → Reviewer → Integrator → Documentor; an Orchestrator view shows pipeline cards with per-stage state.
4. **Home/Overview** — a light landing surface: current project, task counts by column, active pipelines, recent brain nodes — so the app opens to something coherent.

## 3. Data model (extends the existing `schema.sql`)

```sql
tasks(
  id TEXT PRIMARY KEY,                 -- e.g. SPD-001 (generated per project)
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  feature TEXT,                        -- free-text feature name
  priority INTEGER DEFAULT 2,          -- 0=P0 .. 3=P3
  status TEXT DEFAULT 'ready',         -- kanban column: ready|in_progress|review|shipped|blocked
                                       -- (named `status`, NOT `column`, to avoid the SQL keyword)
  origin_quote TEXT, origin_source TEXT,
  description TEXT,
  created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
)

brain_nodes(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,                  -- feature|decision|convention|feedback|bug|metric
  label TEXT NOT NULL,
  detail TEXT,                         -- e.g. ADR body / metric value / quote
  x REAL, y REAL,                      -- layout hint (nullable; UI can auto-layout)
  created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
)

brain_edges(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  rel TEXT,                            -- optional relation label
  FOREIGN KEY(from_id) REFERENCES brain_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(to_id)   REFERENCES brain_nodes(id) ON DELETE CASCADE
)

task_nodes(                            -- grounding: a task references brain nodes
  task_id TEXT NOT NULL, node_id TEXT NOT NULL,
  PRIMARY KEY(task_id, node_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES brain_nodes(id) ON DELETE CASCADE
)

pipeline_runs(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT DEFAULT 'queued',        -- queued|running|gated|shipped|paused|failed
                                       -- (`gated`/`paused` reserved; human-gate logic is post-MVP)
  -- no account_id column: a run can span accounts (round-robin); the run's
  -- "account" for display is derived from its stages.
  current_stage INTEGER DEFAULT 0,     -- index into the 4 stages
  created_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id)    REFERENCES tasks(id)    ON DELETE CASCADE
)

pipeline_stages(
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL,
  role TEXT NOT NULL,                  -- developer|reviewer|integrator|documentor
  stage_order INTEGER NOT NULL,        -- 0..3
  state TEXT DEFAULT 'queued',         -- queued|running|done|gate|failed
  session_id TEXT,                     -- the spawned agent session (nullable)
  account_id TEXT,                     -- which account ran it
  created_at TEXT,
  FOREIGN KEY(pipeline_run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
)
```

History note (consistent with the foundation): `pipeline_stages.session_id` is NOT a hard FK to `sessions` (sessions are historical and may be reaped); it's a soft link.

## 4. Components

### Backend (new domain modules, db-helpers only, plain-dict returns — mirror accounts.py/projects.py)
- **`tasks.py`** — CRUD; `next_task_id(project_id)` (SPD-NNN per project); `move(task_id, status)` (validate against the 5 kanban statuses); `list_for_project(project_id)`; grounding via `set_nodes(task_id, node_ids)` / `nodes(task_id)`. Always quote `"status"` is unnecessary now (renamed off the keyword), but the column holds the kanban state.
- **`brain.py`** — node CRUD (`create_node`/`list_nodes`/`update_node`/`delete_node`), edge CRUD (`add_edge`/`list_edges`/`delete_edge`), all project-scoped.
- **`pipelines.py`** — `STAGES = ["developer","reviewer","integrator","documentor"]`; `create_run(project_id, task_id)` (creates the run + 4 queued stages); `run(run_id)`, `get(run_id)` (with stages), `list_for_project`; `start_stage(run_id, idx)` / `complete_stage(run_id, idx, ...)` / `advance(run_id)`; state-machine helpers. The actual agent spawn is injected (a callback) so `pipelines.py` stays testable without the server/tmux.

### Backend (server wiring)
- **`spade_server.py`** — a new FastAPI router (included like `registry_server`) exposing tasks/brain/pipelines endpoints. Handlers reach `server` lazily for the spawn callback.
- **Pipeline stage spawn**: starting a stage calls
  `server._spawn_agent(role=<stage role>, project_id=<task project>, cwd=projects.get(project_id)["path"], task=<stage prompt>, mission=<run id>, parent=None, report_context=<prev stage report>)`.
  - **`parent=None` is mandatory** — pipeline stages are plain workers, NOT children of the orchestrator. This is the key to avoiding any conflict with the existing finish-forwarding: `orchestrator_server.collect_worker_forward` returns early when a worker has no parent, so a parentless stage agent's `finished` is never narrated to / consumed by the orchestrator.
  - **`cwd` = the project's working dir** (`projects.path`) so Developer/Integrator agents touch the real repo, not an empty scratch dir.
  - **`report_context`** = the finishing predecessor stage's report (the foundation's handoff report; available as the poller's `done` report). The advance threads each stage's output into the next stage's prompt so stages don't run blind to each other. Stage 0 (Developer) gets the task title + description + grounded brain-node context instead.
  - The returned `info["id"]` is written to `pipeline_stages.session_id`, and the resolved account to `pipeline_stages.account_id`.
- **Auto-advance (additive, no conflict)**: add a small, separate collector branch in `server._poll_loop`'s COLLECT phase. For a session that is (a) NOT an orchestrator, (b) has NO parent, and (c) whose `_meta["mission"]` names an existing `pipeline_run`, when its `poller.poll()` reports `kind == "done"`, gather a `(run_id, stage_idx, report)` advance item — guarded by a once-only `_meta["pipeline_advanced"]` flag (mirrors the existing `finish_forwarded` guard) so a stage advances exactly once. In the DRAIN phase (no lock held), call `pipelines.complete_stage(...)` then spawn the next stage (threading the report as `report_context`); the **last** stage's completion marks the run `shipped` and moves the task to `status='shipped'`. A spawn failure marks the stage `failed` and the run `paused`, logged best-effort (never crashes the loop).
- **Manual override**: `POST /pipelines/{id}/advance` does the same advance synchronously (used as the integration-test primary path with a fake spawn, and as a UI fallback).

### Roles for the pipeline (idempotent seed)
The foundation seeds only planner/developer/reviewer/plain/orchestrator. The pipeline needs `integrator` and `documentor` too. Add them to `roles.yaml` AND add an idempotent per-role upsert (`INSERT OR IGNORE INTO roles ...` for each of the 4 pipeline roles) that runs at startup — `seed_if_empty()` only seeds an empty table, so an existing DB would otherwise miss the two new roles. Give `integrator` (mode accept-edits: merges/commits the work) and `documentor` (mode accept-edits: writes docs/changelog) concise role instructions.

### Frontend (extend the existing `/ui` vanilla-JS app)
- New nav-rail destinations: **Home**, **Backlog**, **Brain**, **Pipelines** (Orchestrator), alongside the foundation's Fleet/Projects/Accounts/Agents.
- **Backlog** — 4 columns; task cards (id, title, feature chip, priority dot); click → task detail (origin, grounded nodes, pipeline status, "Run pipeline" button); create-task form; move via buttons (and/or drag).
- **Brain** — SVG canvas of nodes (color by type) + edges; click a node → detail; add node / add edge / link-to-task. Baseline MVP may auto-layout (e.g. simple circular/grid placement from optional x/y) and render read-mostly (add-node + link-to-task required; drag-reposition and manual edge-drawing are nice-to-have, can be deferred without hurting the core loop).
- **Pipelines/Orchestrator** — pipeline cards: task title, 4 stage chips (queued/running/done/gate) with the live agent session link; clicking a running stage focuses its agent in the Fleet screen.
- **Home** — current project, task counts per column, active pipelines, recent brain nodes.
- All views project-scoped to the current project (foundation's current-project state).

## 5. Error handling
- Pipeline start when the project has no authed account → surfaces the foundation's 400 (account not logged in) as a stage `failed` + a message; the run goes `paused`.
- Task move to an unknown column → 400. Brain edge referencing a missing node → 400 (FK).
- Deleting a project cascades tasks/brain/pipelines (FKs).
- Pipeline auto-advance is best-effort and logged (mirrors the foundation's logging pattern); a spawn failure marks the stage `failed` and the run `paused`, never crashes the poll loop.

## 6. Testing
- `tasks.py`: CRUD, SPD-id generation per project, move/status validation (reject unknown status), grounding set/get.
- roles seed: after startup, the `roles` table contains developer/reviewer/integrator/documentor (idempotent upsert covers an already-seeded DB).
- `brain.py`: node/edge CRUD, project scoping, cascade on node delete.
- `pipelines.py`: create_run builds 4 ordered stages; advance state machine (queued→running→done→next; last→shipped + task shipped); start/complete with an injected spawn callback (no tmux); failure → paused.
- `spade_server.py`: endpoint flows via TestClient — create task, ground it, create+advance a pipeline with a fake spawn, move task, brain CRUD.
- Integration: task → ground → start pipeline (fake spawn returns a session id) → advance through 4 stages → run shipped, task column = shipped.

## 7. Build order (chunks)
1. **Tasks + Backlog** (tasks.py, endpoints, kanban UI).
2. **Brain** (brain.py, endpoints, graph UI, task grounding).
3. **Pipelines** (pipelines.py, endpoints, execution wiring + auto-advance, Orchestrator UI).
4. **Home + nav integration + end-to-end verify.**

Each chunk: TDD, then spec-compliance + code-quality review, then fix.
