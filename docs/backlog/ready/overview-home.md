# Overview (project home) + Home / triage (workspace) — `/overview`, `/`

**Status:** 🟢 Ready (composite of existing endpoints). **Handoff:** `views/overview.jsx`, `views/home.jsx`.

Two related dashboards. Overview is project-scoped; Home/triage is cross-project (workspace level).

## Overview — `/overview`
Project home: a hero + grid of cards composed entirely from endpoints we already consume.

### Data source (real, all existing)
- Live **pipelines** strip → `GET /pipelines?project_id=` (+ `runStepLabel`, `StagesMini`).
- **Provider** status chips → `GET /accounts`.
- **Watchlist** (warn/hot/ok) → derive from tasks (`priority`/`status`) and paused pipelines.
- Recent **decisions** → brain nodes `type=decision` (newest).
- Recent **inputs / activity** → recent `task_comments` across tasks (activity trail) — or omit if too heavy for v1.
- **"Jump to"** grid → static links to the live routes.

### Scope
Reuse `Card`, `Chip`, `Priority`, `StagesMini`, `PipelineCard` (collapsed), `DecisionCard`.
`<PageHead title="Overview" />`. Sidebar `Overview` (Project group) `href="#"` → `/overview`.

## Home / triage — `/`
Cross-project landing dashboard (the most content-dense handoff screen). Serif hero, an AI
Brief card, a KPI band, a cross-project triage list, and a project health grid/table.

### Data source + caveat
- Project list → `GET /projects`; per-project tasks/pipelines → loop the existing endpoints.
- ⚠️ This is **workspace-level** (full-bleed, no sidebar). It depends on the deferred
  `body.workspace-level` shell work (see backlog README → Polish). Build the shell variant first,
  or scope Home to a simpler cross-project summary initially.
- The "AI Brief" narrative summary has no backend (it's an LLM synthesis) — either omit the
  narrative and show structured KPIs only, or treat it as blocked-on the Ask/LLM endpoint.

### Acceptance
- Overview: every card shows real data from a live endpoint; honest empty states; no fabricated metrics. tsc clean.
- Home: real project list + per-project rollups; the AI Brief narrative is omitted (or gated) until an LLM endpoint exists.

## Honesty notes
- Compose only from real endpoints. The handoff's hero metrics/KPIs that have no source
  (e.g. invented health scores) must be derived from real fields or omitted — don't hardcode numbers.
