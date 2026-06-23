# Sprints — `/sprints`

**Status:** 🔴 Blocked (no backend). **Handoff:** `views/sprints.jsx`.

## What it is
Sprint list/board: current / done / planning states; planned vs shipped/review/progress/
ready/blocked counts; a theme line per sprint.

## Why blocked
No sprints model or endpoints. `data.sprints` is mock. The topbar "sprint 26 · day 2/10" pill
is a static design label.

## Backend needed first (rough)
- A `sprints` table: `id, project_id, number, name/theme, state (planning|current|done),
  starts_at, ends_at, goal`.
- A task↔sprint linkage: add `sprint_id` to `tasks` (or a join table) so per-sprint task
  counts are real.
- Endpoints: `GET /sprints?project_id=`, `GET /sprints/{id}` (with task rollup), and
  CRUD to plan/start/close a sprint.

## When unblocked — UI scope
Sprint cards with state + the status-count rollup (derive counts from the linked tasks by
status — reuse `tasksByStatus`). Could partly reuse the Backlog board per sprint. Reuse `Card`, `Chip`, `Priority`.

## Honesty notes
Counts must come from real task↔sprint links, not invented. Until `sprint_id` exists on tasks,
even a basic sprint board can't show real composition.
