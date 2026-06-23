# Spade UI Migration — Foundation (Milestone 1)

**Date:** 2026-06-22
**Status:** Approved (design), pending implementation plan
**Source design:** `~/Downloads/design_handoff_spade 2/` (high-fidelity React/HTML prototype + `README.md` tokens)

## Problem

The PoC is confirmed: a working Python/FastAPI backend (`tui_pilot`) exposes a full
REST API (tasks, backlog, brain, pipelines, accounts, projects) and a hand-written
**vanilla-JS** frontend (`tui_pilot/static/app.js`, `style.css`, `index.html`) served at
`/ui/`. It works but does not look like a real product.

The design handoff specifies a high-fidelity, token-driven, dense "pro tool" UI
(near-black + lavender, Inter Tight / JetBrains Mono / Instrument Serif, Linear-style
density) across ~20 views. We want to migrate the UI to **Next.js** and make it match
the handoff — starting with a foundation that proves the architecture end-to-end before
porting every screen.

## Decisions (locked)

1. **Architecture:** Next.js frontend that consumes the **existing** FastAPI REST API.
   Python remains the backend / source of truth. No API code changes in this milestone.
2. **Repo layout:** monorepo under `apps/` — `apps/api` (Python, relocated) and
   `apps/client` (Next.js, new).
3. **Styling:** Tailwind v4 with the handoff's `:root` tokens lifted verbatim as CSS
   variables and mapped into Tailwind's theme. Tokens are the source of truth.
4. **Milestone 1 scope:** restructure + Next.js app + design tokens/fonts/icons +
   shared components + app shell + two anchor views (**Backlog**, **Task detail**)
   wired to the live API.

### Why these two views first
Backlog (a *list*, `GET /tasks`) and Task detail (a *record*, `GET /tasks/{id}`)
exercise the two fundamental data patterns every other view is a variation of. They are
read-mostly against endpoints that already exist and work, so the migration is purely a
frontend/architecture exercise. Task detail is the most design-rich screen in the
handoff (serif origin quote, evidence sections, timeline rail), so it stress-tests the
token system hardest. The Orchestrator view was explicitly deferred: it needs live
state/streaming and would conflate three new risks (Next.js, design-system port, live
data) in the first view.

## Design

### 1. Repo restructure
```
tui-pilot/
  apps/
    api/      ← git mv of tui_pilot/, tests/, requirements.txt, schema.sql, etc.
    client/   ← NEW Next.js app
  Makefile    ← updated: `make dev` runs BOTH api + client
  README.md
```
The Python move is a `git mv` only — package name stays `tui_pilot`, imports unchanged
(`tui_pilot.*`). Tests move with it and must still pass. Uvicorn target becomes
`tui_pilot.server:app` run from `apps/api`.

### 2. Next.js app (`apps/client`)
- Next.js **App Router** + **TypeScript** + **Tailwind v4**. File-based routes map 1:1
  onto handoff views (`/backlog`, `/task/[id]`, …).
- **API access via Next rewrites proxy:** `next.config` rewrites `/api/*` →
  `http://127.0.0.1:8765/*` (FastAPI base URL from env, default localhost:8765). Browser
  sees same-origin — no CORS. Client calls `fetch('/api/tasks?project_id=…')`.
- **Data fetching:** thin typed `lib/api.ts` wrapper + **SWR** in client components.
  Backlog/Task are interactive, so client-side fetching is the honest fit; SWR provides
  caching/revalidation and sets up the polling the Orchestrator view will later need.

### 3. Design system (the reusable core)
- `globals.css`: handoff `:root` tokens lifted verbatim (colors, lines, text, accents,
  radii, shadows, custom scrollbars, pulse keyframes). Fonts via `next/font`
  (Inter Tight, JetBrains Mono, Instrument Serif).
- `@theme` maps tokens → Tailwind utilities (`bg-bg-1`, `text-text-2`, `border-line`,
  `text-accent`, …).
- **Icon set:** the inline SVG sprite (`i-brain`, `i-tasks`, `i-orch`, …) recreated as a
  typed `<Icon name="…" />` component; stroke-width 1.6, round caps/joins, 14×14 default.
- **Shared components** (`components/ui/`), built once and reused across all later views:
  `Btn` (+ `primary`/`ghost`/`xs`), `IconBtn`, `Chip` (typed: feature/decision/feedback/
  bug/metric/convention/meeting), `Priority` (p0–p3), `Avatar` (+ `ai`), `Card`, `Kbd`,
  `TogglePill`, `Subtab`, `PageHead`.

### 4. App shell (`app/layout.tsx`)
- Grid: 232px sidebar + 44px topbar, `height:100vh; overflow:hidden`.
- **Topbar:** brand (→ home), project switcher (glyph chip + name + dropdown), command
  pill (`Ask the brain…` + `⌘K`), daemon pill, sprint pill, active-account pill, tweaks
  toggle, avatar.
- **Sidebar:** project-scoped groups (Project / Plan / Execution / Inputs / System) with
  mono badge counts; footer "Local-first · v1.0.0" + `~/.spade · 84 MB`.
- `home-mode` / `workspace-level` preserved as layout variants. Nav uses real Next
  `<Link>` routing, replacing the prototype's `data-nav` + CustomEvent mechanism.

### 5. Anchor views
- **Backlog** (`app/backlog/page.tsx`): 4-column board of `TaskCard`s from
  `GET /api/tasks?project_id=…`. Card = mono header (priority dot + ID + feature), title,
  intel bar, chip meta, agent footer. Click → Task detail. Drag-to-move
  (`POST /tasks/{id}/move`) is a stretch goal; static columns ship first.
- **Task detail** (`app/task/[id]/page.tsx`): two columns from `GET /api/tasks/{id}` —
  main (serif italic origin quote w/ speaker+source; evidence sections decisions/bugs/
  feedback/metric) + 320px side rail (metadata rows + vertical lifecycle timeline, current
  step green).

### 6. Dev workflow
- `make dev` starts FastAPI (`apps/api`, uvicorn `--reload`, port 8765) **and** the Next
  dev server (`apps/client`, port 3000) together. UI lives at `http://127.0.0.1:3000`.
- `make setup` adds `npm install` in `apps/client`.
- The old `tui_pilot/static` vanilla UI stays untouched as a fallback until the Next app
  reaches parity — no big-bang cutover, two UIs coexist briefly.

## Out of scope (Milestone 1)
The other 18 views; auth; live streaming/polling; drag-and-drop; deleting the old static
UI; production deploy config. Each later view is its own pass reusing this foundation.

## Risks / trade-offs
- **Two dev servers** is the cost of the monorepo split; `make dev` hides it but it exists.
- **Two coexisting UIs** during migration is intentional (incremental, not big-bang).
- Relocating the Python package risks breaking import/test paths — mitigated by keeping
  the package name and running the suite immediately after the `git mv`.

## Success criteria
- `apps/api` tests pass unchanged after the move.
- `make dev` brings up both servers; `http://127.0.0.1:3000` renders the shell.
- Backlog lists real tasks from the live API; clicking a card opens Task detail with real
  data, both visually matching the handoff tokens (colors, fonts, density, spacing).
- Shared component library + tokens + icon set exist and are used by both views.
