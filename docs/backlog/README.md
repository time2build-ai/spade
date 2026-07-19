# Spade UI — view backlog

Tracks the remaining handoff views for the Spade UI migration (`apps/client`). The
foundation (monorepo, design system, app shell) and the views below marked **Done** are
already merged to `main`. Each remaining item has a stub spec in `ready/` or `blocked/`.

**Source design:** `~/Downloads/design_handoff_spade 2/` (`views/*.jsx`, `Spade.html`, `README.md`).
**How to run:** `make dev` → UI at http://127.0.0.1:8766 (API on :8765). Legacy UI at :8765/ui/.

## Guiding rule: honest data only
We only build views backed by a real API endpoint. Where the handoff mock shows fields
with no backend (usage meters, ETAs, transcripts, sentiment, …), we omit them rather than
fabricate. A view is **blocked** if its *core* content has no endpoint — it needs backend
work first.

## Status

### ✅ Done (merged to `main`)
| View | Route | Data source |
|---|---|---|
| Backlog | `/backlog` | `GET /tasks` |
| Task detail | `/task/[id]` | `GET /tasks/{id}` (+ grounded brain nodes, comments) |
| Orchestrator | `/orchestrator` | `GET /pipelines` (polled) + session screen terminal |
| Product Brain | `/brain` | `GET /brain/nodes` + `/brain/edges` |
| Decisions | `/decisions` | brain nodes `type=decision` |
| Human Gates | `/gate` | `GET /brakes` + allow/skip |
| Agent pool | `/agent-pool` | `GET /sessions` (polled) + `GET /accounts` |

### 🟢 Ready — real data exists, buildable now
| View | Route | Stub | Data source |
|---|---|---|---|
| CLI / logs | `/cli` | [ready/cli-logs.md](ready/cli-logs.md) | `GET /sessions` + `/sessions/{id}/screen` |
| Graph & Issues | `/graph-issues` | [ready/graph-and-issues.md](ready/graph-and-issues.md) | brain nodes/edges + `GET /tasks` |
| Overview / Home | `/overview`, `/` | [ready/overview-home.md](ready/overview-home.md) | composite of existing endpoints |

### 🔴 Blocked — needs new backend before an honest UI
| View | Route | Stub | Missing backend |
|---|---|---|---|
| Meetings | `/meetings` | [blocked/meetings.md](blocked/meetings.md) | meetings + transcript/extraction model |
| Feedback | `/feedback` | [blocked/feedback.md](blocked/feedback.md) | feedback clusters + quotes |
| Sprints | `/sprints` | [blocked/sprints.md](blocked/sprints.md) | sprints model |
| Integrations | `/integrations` | [blocked/integrations.md](blocked/integrations.md) | integrations/connections catalog |
| Ask / chat | `/ask` | [blocked/ask-chat.md](blocked/ask-chat.md) | chat threads + grounded "ask the brain" LLM endpoint |

## 🟡 Polish / tech debt (cross-cutting, not a view)
- [x] Sidebar badge counts now show LIVE numbers for built views (`useShellData`); unbuilt items show "Próximamente" instead of fake counts.
- [ ] Workspace-level shell tint + the workspace-scoped nav groups (`body.workspace-level`) — deferred from M1.
- [ ] Backlog drag-to-move — `api.moveTask` is scaffolded but unwired; `POST /tasks/{id}/move` exists.
- [x] Topbar daemon pill (live session count) + account pill (default account) wired to `GET /sessions`/`/accounts`; the fake "sprint 26 · day 2/10" pill was removed (Sprints has no backend).
- [ ] Project switcher "All projects" / "New project" actions are no-ops; command pill ⌘K / "Ask the brain" is non-functional (depends on Ask view).
- [ ] Remove the legacy vanilla UI (`apps/api/tui_pilot/static`, served at :8765/ui/) once parity is reached.
- [ ] Remove the `app/dev-tokens` preview route before any production build ships.

## Conventions for picking up an item
Each stub lists: data source, scope, components, acceptance, and honesty notes (what to
omit). Build on a feature branch reusing the existing `lib/` data layer, `components/ui`,
and the app shell. TDD the pure adapters; add a render test per component; keep
`npx tsc --noEmit` clean; verify against live data before committing.
