# Spade — Alignment Brief for the tui-pilot Foundation

> Source 1: thesis documentation at `~/university/thesis/documentation` (Spanish; summarized in English).
> Source 2: design handoff at `~/downloads/design_handoff_spade` (`README.md`, `data.js`, `views/*.jsx`).
> Purpose: steer the tui-pilot foundation so the **next** phase (the full Spade product) can be built on top of it without schema migrations.

> **Scope note (2026-06-15):** the current tui-pilot work (projects, accounts, SQLite persistence, project-aware orchestrator — see `docs/superpowers/plans/2026-06-15-projects-accounts.md`) IS the foundation. The richer Spade entities below (tasks/pipelines/brain/sprints/ADRs/feedback/meetings/integrations) are the **post-foundation** roadmap and each warrant their own spec→plan→build cycle. This brief is the input to those.

---

## What Spade Is

Spade is a local-first, desktop product-management workspace for software teams that run development through a fleet of AI coding agents. Its core innovation is a **Product Brain** — a typed knowledge graph of features, decisions, conventions, feedback clusters, bugs, and metrics — that grounds an orchestrator dispatching agents (Claude / Codex / Cursor / Gemini / Aider) through a four-stage pipeline (Developer → Reviewer → Integrator → Documentor). It targets Product Managers and Tech Leads who want full traceability from a customer complaint or meeting quote through to a shipped commit, without losing the context that lives in Jira, Notion, Slack, Sentry, Amplitude, and meeting recordings.

---

## Core Domain Entities

### Thesis schema (entrega-2 / `13-estructura-datos.md`) — PostgreSQL + JSONB, Spanish names

| Entity | Key fields |
|---|---|
| `fuente` | `id`, `proyecto_id`, `tipo` (jira/github/sentry/slack/docs), `identificador_externo`, `configuracion` (JSONB), `estado` (no_configurada/configurada/en_ingesta/activa/error) |
| `job_ingesta` | `id`, `fuente_id`, `iniciado_en`, `finalizado_en`, `estado`, `registros_ingeridos`, `error` (JSONB) |
| `nodo` | `id`, `tipo` (ticket/pull_request/bug/decision_tecnica/integracion/modulo/cliente), `propiedades` (JSONB), `fuente_id`, `referencia_externa` |
| `arista` | `id`, `nodo_origen_id`, `nodo_destino_id`, `tipo`, `propiedades` (JSONB) — directed typed edge |
| `agente` | `id`, `rol` (desarrollo/qa/revision), `especialidad`, `configuracion` (JSONB), `modelo` |
| `run_ia` | `id`, `prompt`, `nodos_contexto` (JSONB), `modelo`, `respuesta` |
| `issue` | `id`, `titulo`, `descripcion`, `contexto` (JSONB node IDs), `run_ia_id`, `estado` (generado/validado/asignado/en_ejecucion/resuelto/rechazado) |
| `run_agente` | `id`, `agente_id`, `issue_id`, `iniciado_en`, `finalizado_en`, `estado`, `salida` (JSONB), `error` (JSONB) |

Traceability chain: `fuente → job_ingesta → nodo ↔ arista → [run_ia →] issue → run_agente`.

### Design handoff `data.js` — canonical product-facing shapes (preferred for the production schema)

- **`tasks`** — `id` (SPD-XXX), `title`, `priority` (0–3), `feature`, `status`/`column` (ready/in_progress/review/shipped/blocked), `assignee {name, ai}`, `links {feedback,bugs,decisions,meetings,metrics}`, and for detail: `origin {quote,speaker,source}`, `decisions[]`, `bugs[]`, `feedback[]`, `metric {name,value,target,trend}`, optional `flag`.
- **`pipelines`** — `id`, `task` (SPD-XXX), `title`, `priority`, `feature`, `account`, `progress`, `eta`, `spent`, `stages[] {role,state: done|run|gate|queue, meta}`, `paused`, `shipped`.
- **`sprints`** — `num`, `label`, `dates`, `state` (current/done/planning), `days`, `planned`, `shipped`, `review`, `progress`, `ready`, `blocked`, `theme`.
- **`meetings`** — `id`, `title`, `source` (granola/fathom/otter/fireflies/zoom), `duration`, `date`, `participants`, `extracted {tasks,decisions,questions}`, `status`, `fidelity` (transcript/summary/outcomes_only/metadata_only/processing).
- **`feedbackClusters`** — `id`, `label`, `feature`, `count`, `sentiment` (neg/pos/feature), `trend`, `linkedTask`, `breakdown[]`.
- **`feedbackQuotes`** — by cluster id → `{q,platform,author,when,meta,id}`.
- **`decisions`** (ADRs) — `id` (ADR-XXX), `title`, `status` (active/superseded/proposed), `date`, `owner`, `linksFeatures[]`, `supersedes[]`, `related[]`, `conflict`.
- **`accounts`** — `id`, `provider` (claude/codex/cursor/gemini/aider), `model`, `email`, `plan` (Max/Pro/API/Plus/Team/Free/Local), `limit`, `used`, `state` (active/exhausted/fallback/idle), `sessions`, `today` ($), `role` (orchestrator/worker/fallback), `strengths[]`.
- **`handoffs`** — `ts`, `from`, `to`, `reason`, `session`, `provFrom`, `provTo`.
- **`integrations`** — `id`, `name`, `cat` (Meetings/Feedback/Code/PM/Observability/Analytics), `connected`, `connections[] {id,label,identity,scope,status: healthy|warn|stale,last,usedBy[]}`.
- **`brainNodes`** — `{id,type: feature|decision|convention|feedback|bug|metric,label,x,y,r}`; **`brainEdges`** — `[fromId,toId]`.
- **`projects`** — `id`, `name`, `slug` (e.g. "acme/web"), `color`, `glyph`, `current`, `workers`, `automations`, `agents`, `brainNodes`, `sprintCounter`, `desc`, `state` (active/paused).
- **`chatThreads`** — `id`, `title`, `project`, `pinned`, `updated`, `msgCount`, `messages[] {role,t,text,cites[],plan,action {type,target,section,summary,risk}}`.
- **`cliRuns`** — `{ts,cmd,status,who}`.

---

## View / Screen Inventory (design handoff `views/`)

| File | Scope | Purpose |
|---|---|---|
| `home.jsx` | Workspace | Cross-project triage dashboard: AI brief, KPI band, P0/P1/P2 triage, project health grid. |
| `workspace.jsx` | Workspace | Global automation rules / workspace settings. |
| `accounts.jsx` | Workspace | Shared AI provider account pool: strategy selector, usage meters, state, spend, handoff failover log. |
| `integrations.jsx` | Workspace | Integration catalog with per-connection health, scope, sync status. |
| `overview.jsx` | Project | Project home: pipeline strip, provider status, watchlist, recent decisions/inputs. |
| `ask.jsx` / `chat-panel.jsx` / `chat-bubble.jsx` | Project | Conversational Brain interface with citation chips + context sidebar. |
| `sprints.jsx` | Project | Sprint list (current/done/planning) with planned vs shipped/review counts. |
| `backlog.jsx` | Project | 4-column kanban (Ready/In progress/Review/Shipped) of task cards. |
| `task.jsx` | Project | Task detail: origin quote, linked ADRs/bugs/feedback, metric, lifecycle timeline. |
| `brain.jsx` | Project | Knowledge graph viz: legend/filters, SVG force canvas, node info panel. |
| `graph-issues.jsx` | Project | Force graph + issues list with agent role + context-node grounding chips. |
| `agent-pool.jsx` | Project | Project agent pool cards (state/issue/usage) + in-flight executions table. |
| `orchestrator.jsx` | Project | Execution command center: KPI + 4-stage pipeline cards + live terminal log. |
| `gate.jsx` | Project | Human approval queue: conflict cards (change vs ADR), diffs, approve/reject. |
| `meetings.jsx` | Project | Meeting ingestion list w/ fidelity badges; transcript with highlighted extractions. |
| `feedback.jsx` | Project | Feedback clusters (sentiment/trend/platform) + representative quotes. |
| `decisions.jsx` | Project | ADR catalog with status, owner, linked features, supersedes/related, conflicts. |
| `cli.jsx` | Project | Terminal-styled command history + console output. |
| `settings.jsx` | Project | Project automation rules with toggle pills. |
| `active.jsx` / `overview.jsx` | Project | Live pipeline/active-work surfaces. |

---

## Foundation Mapping: tui-pilot → Spade

Current tui-pilot schema (`tui_pilot/schema.sql`): `accounts`, `projects`, `project_accounts`, `roles`, `sessions`, `missions`, `app_state`.

| tui-pilot | Spade equivalent | Alignment / note |
|---|---|---|
| `accounts` | `accounts` (data.js) | Good conceptual fit. tui-pilot account = a Claude Code `CLAUDE_CONFIG_DIR`. Spade account = multi-provider with `plan`, `limit`, `used`, `state`, `today` spend, `role`, `strengths[]`. **Gap: no usage/spend/state/strengths yet** (deliberately out of v1 scope). |
| `projects` | `projects` (data.js) | Both literally "project" (NOT "workspace") — safe naming. tui-pilot `path` = the repo cwd; Spade adds `slug` ("acme/web"), `glyph`, `color`, `state`. |
| `project_accounts` | account pool | Good fit. Spade adds connection `scope` (workspace vs project). |
| `roles` | pipeline roles | tui-pilot roles map to agent specializations. Spade's canonical pipeline is Developer→Reviewer→Integrator→Documentor (+orchestrator). |
| `sessions` | pipeline stages / `run_agente` | **Highest-risk gap:** tui-pilot session = one tmux agent. Spade needs a `pipeline_runs` grouping (one task → 4 ordered stage sessions) with per-stage `state`/cost/diff. |
| `missions` | `tasks` / `issue` | Name + schema mismatch. tui-pilot `missions.goal` is a text blob; Spade `tasks` carry `feature`, `priority`, kanban `column`, `origin`, evidence links, `context_nodes`. |
| — | `fuente`/`integrations`, `nodo`+`arista` (Brain), `sprints`, `decisions`, `feedback*`, `meetings`, `run_ia`, `handoffs`, `chat_threads`, `gates` | Missing entirely — the post-foundation roadmap. |

---

## Decisions for the NEXT phase (do NOT retrofit into the current foundation build)

These are flagged so the next spec accounts for them. They are intentionally **not** applied to the in-flight foundation build, to keep its reviewed schema stable:

1. **`missions` → `tasks` naming.** The orchestrator/agent-comms protocol is deeply built around "mission". The next phase should introduce a richer `tasks` table (feature, priority, kanban column, origin, evidence) and decide whether `missions` becomes an orchestrator-session grouping above tasks, or is renamed. A rename touches harness.py, orchestration.py, the agent-comms skill, signals, and UI — treat as its own migration.
2. **`pipeline_runs` layer above `sessions`** — `id, task_id, project_id, account_id, status, progress_pct, eta, spent`; `sessions` gain `pipeline_run_id` + `stage_order`. Required before the Orchestrator/Active views.
3. **`projects.slug`** (display id, e.g. "acme/web") distinct from `path` (cwd); plus `glyph`, `color`, `state`.
4. **Multi-provider accounts** — extend `provider` beyond `claude-code`; add `plan`, `limit`, `used_pct`, `state`, `today_spend`, `role`, `strengths` (JSON).
5. **Task enrichment** — `feature`, `priority` (0–3), kanban `column` (ready/in_progress/review/shipped/blocked), `origin_*`, `context_nodes` (JSON).
6. **Seed canonical pipeline roles** — Developer, Reviewer, Integrator, Documentor as `is_system` roles.

## Gap List (post-foundation build order)

1. `pipeline_runs` (+ session stage linkage) · 2. `tasks` enrichment · 3. `integrations`/`fuente` · 4. `job_ingesta` · 5. `nodo`+`arista` (Brain) · 6. `sprints` · 7. `decisions` (ADRs) · 8. `feedback_clusters`+`feedback_quotes` · 9. `meetings` · 10. `run_ia` · 11. `handoffs` · 12. `chat_threads`+`chat_messages` · 13. `gates` · 14. account `state` machine + usage/spend · 15. Brain-coverage metric.

---

*Generated 2026-06-15 from thesis (entrega-2/3) + design handoff `data.js`/`README.md`. data.js (English, design-facing) names are preferred over thesis (Spanish, academic) names for the production schema.*
