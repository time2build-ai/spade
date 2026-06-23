# Graph & Issues — `/graph-issues`

**Status:** 🟢 Ready (real data). **Handoff:** `views/graph-issues.jsx`, `Spade.html`.

## What it is
A split view: a filterable force/knowledge graph (left) and an issues list (right) where each
issue (task) shows its status, the agent role assigned, and **context chips** — the brain
nodes fed to that agent ("grounding"). Demonstrates which knowledge each issue's agent sees.

## Data source (real)
- `GET /api/brain/nodes` + `/api/brain/edges` (have `api.brainNodes`, `api.brainEdges`).
- `GET /api/tasks?project_id=` (have `api.tasks`). Each task's `nodes: string[]` are grounded
  brain-node IDs — resolve via `resolveNodes`/`indexNodesById` (already in `lib/adapters.ts`).

## Scope
- Left: reuse `components/brain/GraphCanvas.tsx` + `BrainLegend` (filter by node type).
- Right: issues list — one row per task: status dot, id/title, role (if a pipeline/agent is
  assigned — cross-reference `GET /pipelines` for the task's stage role, optional), and the
  resolved context chips (`<Chip type=...>` per grounded node). Toggling a chip could
  highlight that node in the graph (stretch).
- `<PageHead title="Graph & Issues" />`. Sidebar `Graph & Issues` (Plan group) `href="#"` → `/graph-issues`.

## Components
- Reuse `GraphCanvas`, `BrainLegend`, `Chip`, `Priority`. New: `IssueRow`.

## Acceptance
- Graph renders real nodes/edges; issues list shows real tasks with their resolved grounded-node chips.
- Selecting an issue highlights its grounded nodes in the graph (stretch; at minimum list the chips).
- States: loading / no-project / empty / error. tsc clean; tests for IssueRow chip resolution.

## Honesty notes
- The handoff's "context in/out toggle" implies editing grounding — `PUT /tasks/{id}/nodes`
  exists, so a real add/remove is possible (stretch). If not wired, render chips read-only.
- Don't fabricate an issue "role" if no pipeline assigns one — show "unassigned".
