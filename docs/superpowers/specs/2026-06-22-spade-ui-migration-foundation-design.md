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
    api/      ← Python: tui_pilot/, tests/, requirements.txt, schema.sql,
              ←         roles.yaml, patterns.yaml, fixtures/, plan.md
    client/   ← NEW Next.js app
  Makefile    ← updated: `make dev` runs BOTH api + client
  README.md
```
The Python move is a `git mv` only — package name stays `tui_pilot`, imports unchanged
(`tui_pilot.*`). **Critical:** several modules resolve sibling data files via
`Path(__file__).resolve().parent.parent / "<file>"` — they expect these files next to the
package dir:
- `server.py` & `roles_seed.py` → `roles.yaml`
- `controller.py` → `patterns.yaml`
- `cli.py` → `fixtures/`

Therefore `roles.yaml`, `patterns.yaml`, and `fixtures/` **must move into `apps/api/`
alongside `tui_pilot/`** so `parent.parent` still resolves (→ `apps/api/`). No code edits
to those paths are needed *if and only if* the sibling files move together. The plan must
`git mv` whichever of these siblings actually exist at move time (grep the `parent.parent`
references first to confirm the full set), move them in the same step, and then run the
test suite to confirm. Uvicorn target stays
`tui_pilot.server:app`, launched with cwd `apps/api` (so `make stop`'s grep string is
unchanged). `DATA_HOME`/`TUI_PILOT_HOME` env handling is unaffected (it's an absolute
path, default `~/.tui-pilot`).

### 2. Next.js app (`apps/client`)
- Next.js **App Router** + **TypeScript** + **Tailwind v4**. File-based routes map 1:1
  onto handoff views (`/backlog`, `/task/[id]`, …).
- **API access via Next rewrites proxy:** `next.config` rewrites `source: '/api/:path*'`
  → `destination: '${API_BASE}/:path*'` where `API_BASE` defaults to
  `http://127.0.0.1:8765`. The `/api` prefix is **stripped** by the rewrite, so
  `/api/tasks` reaches FastAPI as `/tasks` (the router is mounted at root). Browser sees
  same-origin — no CORS. Client calls `fetch('/api/tasks?project_id=…')`.
- **Data fetching:** thin typed `lib/api.ts` wrapper + **SWR** in client components.
  Backlog/Task are interactive, so client-side fetching is the honest fit; SWR provides
  caching/revalidation and sets up the polling the Orchestrator view will later need.

### 3. Design system (the reusable core)
- `globals.css`: handoff `:root` tokens lifted verbatim (colors, lines, text, accents,
  radii, shadows, custom scrollbars, pulse keyframes). **Source:** the `:root` block at the
  top of `~/Downloads/design_handoff_spade 2/Spade.html`.
- **Fonts** via `next/font/google` — all three (Inter Tight, JetBrains Mono, Instrument
  Serif) are Google Fonts, loaded with the weights/italics the handoff lists
  (Inter Tight 400/500/600/700 + `ss01`/`cv11`; JetBrains Mono 400/500/600; Instrument
  Serif italic).
- `@theme` maps tokens → Tailwind utilities (`bg-bg-1`, `text-text-2`, `border-line`,
  `text-accent`, …).
- **Icon set:** the inline SVG sprite (`<symbol id="i-…">` elements) lifted from
  `Spade.html`, recreated as a typed `<Icon name="…" />` component; stroke-width 1.6,
  round caps/joins, 14×14 default.
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
- The sidebar footer `~/.spade · 84 MB` is a **static design label** for M1 (the real data
  home is `~/.tui-pilot` / `$TUI_PILOT_HOME`); wiring it to a live value is out of scope.

### 5. Anchor views
- **Backlog** (`app/backlog/page.tsx`): 4-column board of `TaskCard`s from
  `GET /api/tasks?project_id=…`. Card = mono header (priority dot + ID + feature), title,
  intel bar, chip meta, agent footer. Click → Task detail. Drag-to-move
  (`POST /tasks/{id}/move`) is a stretch goal; static columns ship first.
- **Task detail** (`app/task/[id]/page.tsx`): two columns from `GET /api/tasks/{id}` —
  main (serif italic origin quote w/ speaker+source; evidence sections decisions/bugs/
  feedback/metric) + 320px side rail (metadata rows + vertical lifecycle timeline, current
  step green).

### 5a. Data contracts, project selection & states

**Project selection (blocker if unhandled).** `GET /tasks` requires a `project_id` query
param (no default). Flow:
1. On load, fetch the project list (existing projects endpoint in `server.py`/`projects.py`).
2. Pick the active/first project; persist the selection (localStorage) and reflect it in
   the topbar project switcher.
3. Backlog/Task queries use that id.
4. **Empty states:** if zero projects exist → shell renders with a "Select / create a
   project" placeholder (matches handoff `workspace-level` placeholder) and Backlog shows
   an empty state, not an error. If a project has zero tasks → empty board columns.

**Task data shape (real, from `tasks.py` / `schema.sql`).** A task row is flat:
`id` (SPD-NNN), `project_id`, `title`, `feature`, `priority` (0–3), `status`
(ready/in_progress/review/shipped/blocked), `origin_quote`, `origin_source`,
`description`, `created_at`. `GET /tasks/{id}` is additionally `_enrich`-ed with grounded
**brain nodes** (the task's linked evidence) + comments.

**Consequence for fidelity:** the handoff's Task-detail evidence sections
(decisions/bugs/feedback/metric) and the intel bar are driven by **grounded brain nodes**,
not by dedicated task columns. Backlog cards and Task-detail render the fields that exist;
any handoff sub-section with no backing data shows a tasteful empty state — **we do not
invent data**. This keeps the "matches handoff" success criterion honest: layout/tokens
match pixel-for-pixel, content is whatever the live API actually returns.

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
- Relocating the Python package risks breaking the `parent.parent` sibling-file lookups
  (`roles.yaml`, `patterns.yaml`, `fixtures/`) — mitigated by moving those files into
  `apps/api/` in the same step (see §1) and running the suite immediately after the move.

## Success criteria
- `apps/api` tests pass unchanged after the move.
- `make dev` brings up both servers; `http://127.0.0.1:3000` renders the shell.
- Backlog lists real tasks from the live API; clicking a card opens Task detail with real
  data, both visually matching the handoff tokens (colors, fonts, density, spacing).
- Shared component library + tokens + icon set exist and are used by both views.
