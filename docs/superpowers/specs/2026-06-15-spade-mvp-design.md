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
  column TEXT DEFAULT 'ready',         -- ready|in_progress|review|shipped|blocked
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
- **`tasks.py`** — CRUD; `next_task_id(project_id)` (SPD-NNN per project); `move(task_id, column)`; `list_for_project(project_id)`; grounding via `set_nodes(task_id, node_ids)` / `nodes(task_id)`.
- **`brain.py`** — node CRUD (`create_node`/`list_nodes`/`update_node`/`delete_node`), edge CRUD (`add_edge`/`list_edges`/`delete_edge`), all project-scoped.
- **`pipelines.py`** — `STAGES = ["developer","reviewer","integrator","documentor"]`; `create_run(project_id, task_id)` (creates the run + 4 queued stages); `run(run_id)`, `get(run_id)` (with stages), `list_for_project`; `start_stage(run_id, idx)` / `complete_stage(run_id, idx, ...)` / `advance(run_id)`; state-machine helpers. The actual agent spawn is injected (a callback) so `pipelines.py` stays testable without the server/tmux.

### Backend (server wiring)
- **`spade_server.py`** — a new FastAPI router (included like `registry_server`) exposing tasks/brain/pipelines endpoints. Handlers reach `server` lazily for the spawn callback.
- **Pipeline execution**: starting a run calls `server._spawn_agent(role=<stage role>, project_id=<task project>, task=<task title+description+grounded context>, mission=<run id>)` — reusing the foundation's account resolution + auth guard + persistence. The spawned session's id is written to the stage. **Auto-advance**: when a pipeline worker emits the harness `finished` signal, the poll loop advances the run to the next stage and spawns it; the last stage's finish marks the run `shipped` and moves the task to `shipped`. A manual `POST /pipelines/{id}/advance` is also provided as a fallback / override. Auto-advance reuses the existing finish-detection the orchestrator already consumes (a `pipeline_run` mission is recognized and routed to the pipeline advancer instead of/in addition to the orchestrator narration).

### Frontend (extend the existing `/ui` vanilla-JS app)
- New nav-rail destinations: **Home**, **Backlog**, **Brain**, **Pipelines** (Orchestrator), alongside the foundation's Fleet/Projects/Accounts/Agents.
- **Backlog** — 4 columns; task cards (id, title, feature chip, priority dot); click → task detail (origin, grounded nodes, pipeline status, "Run pipeline" button); create-task form; move via buttons (and/or drag).
- **Brain** — SVG canvas of nodes (color by type) + edges; click a node → detail; add node / add edge / link-to-task.
- **Pipelines/Orchestrator** — pipeline cards: task title, 4 stage chips (queued/running/done/gate) with the live agent session link; clicking a running stage focuses its agent in the Fleet screen.
- **Home** — current project, task counts per column, active pipelines, recent brain nodes.
- All views project-scoped to the current project (foundation's current-project state).

## 5. Error handling
- Pipeline start when the project has no authed account → surfaces the foundation's 400 (account not logged in) as a stage `failed` + a message; the run goes `paused`.
- Task move to an unknown column → 400. Brain edge referencing a missing node → 400 (FK).
- Deleting a project cascades tasks/brain/pipelines (FKs).
- Pipeline auto-advance is best-effort and logged (mirrors the foundation's logging pattern); a spawn failure marks the stage `failed` and the run `paused`, never crashes the poll loop.

## 6. Testing
- `tasks.py`: CRUD, SPD-id generation per project, move/column validation, grounding set/get.
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
