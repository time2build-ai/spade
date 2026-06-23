# Spade UI Migration — Foundation (Milestone 1) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an `apps/` monorepo with the existing Python API relocated under `apps/api`, and a new Next.js app under `apps/client` that recreates the Spade design handoff — design tokens, shared components, app shell, and two live views (Backlog + Task detail) wired to the FastAPI REST API.

**Architecture:** Next.js (App Router) frontend consumes the existing FastAPI REST API unchanged via a same-origin proxy rewrite (`/api/* → http://127.0.0.1:8765/*`, prefix stripped). The handoff's `:root` design tokens are lifted verbatim into `globals.css` and mapped into Tailwind v4's theme. Client components fetch with SWR. Python remains the source of truth; no API code changes.

**Tech Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · SWR · Vitest + React Testing Library (client) · Python/FastAPI + pytest (api, unchanged).

**Spec:** `docs/superpowers/specs/2026-06-22-spade-ui-migration-foundation-design.md`

**Source design:** `~/Downloads/design_handoff_spade 2/` — `README.md` (tokens table), `Spade.html` (`:root` tokens + SVG icon sprite + component CSS), `views/backlog.jsx`, `views/task.jsx` (exact markup), `data.js` (data shapes).

---

## Conventions for this plan

- **Source of truth for visuals:** the handoff. When a step says "match the handoff," open the named `.jsx`/`Spade.html` and lift exact values (padding, radius, token names). Do **not** invent spacing or colors.
- **Frontend testing is pragmatic, not dogmatic.** Write real unit tests for *logic* (API client, project selection, data adapters). For presentational components, write one smoke/render test asserting key structure (role, text, token class) — enough to catch breakage, not pixel-perfection.
- **Commit after every task.** Use conventional commits. Run the relevant test/build before committing.
- All `apps/client` commands run with cwd `apps/client`. All `apps/api` commands run with cwd `apps/api`.

---

## File Structure

```
apps/
  api/                          # relocated Python (git mv)
    tui_pilot/                  # package, name unchanged
    tests/
    fixtures/                   # moved sibling (parent.parent lookup)
    roles.yaml  patterns.yaml   # moved siblings (parent.parent lookups)
    requirements.txt  schema.sql  plan.md
  client/                       # NEW Next.js app
    next.config.ts              # /api rewrite proxy
    package.json  tsconfig.json
    vitest.config.ts  vitest.setup.ts
    app/
      layout.tsx                # app shell: topbar + sidebar grid
      globals.css               # tokens (:root) + @theme + base
      page.tsx                  # redirect → /backlog
      backlog/page.tsx          # Backlog board
      task/[id]/page.tsx        # Task detail
    components/
      ui/                       # Btn, IconBtn, Chip, Priority, Avatar, Card, Kbd, TogglePill, Subtab, PageHead
      Icon.tsx                  # SVG sprite → React component
      shell/                    # Topbar, Sidebar, ProjectSwitcher
      backlog/                  # TaskCard, Board
      task/                     # OriginCard, EvidenceSection, TimelineRail, MetaRow
    lib/
      api.ts                    # typed fetch wrapper (calls /api/*)
      types.ts                  # Task, BrainNode, Project, Comment
      useProject.ts             # project selection (fetch list, persist, active id)
      adapters.ts               # group nodes by type, derive glyph/color/slug
Makefile                        # updated: make dev runs api + client
```

---

## Chunk 1: Backend restructure

### Task 1: Relocate Python into `apps/api` (tests are the proof)

**Files:**
- Move: `tui_pilot/`, `tests/`, `requirements.txt`, `schema.sql`, `plan.md`, and every `parent.parent` sibling (`roles.yaml`, `patterns.yaml`, `fixtures/`) → `apps/api/`
- Modify: `Makefile` (uvicorn cwd, setup path)

- [ ] **Step 1: Confirm the full sibling-file set** before moving anything.

```bash
cd /Users/thiagolopez/time2build/projects/tui-pilot
grep -rn "parent.parent" tui_pilot/*.py
ls roles.yaml patterns.yaml fixtures 2>/dev/null
```
Expected: references to `roles.yaml` (server.py, roles_seed.py), `patterns.yaml` (controller.py), `fixtures/` (cli.py). Note exactly which sibling paths exist — move only those.

- [ ] **Step 2: Baseline the test suite (must pass before the move).**

Run: `python -m pytest -q` (from repo root, with venv active)
Expected: PASS (record the count, e.g. "N passed").

- [ ] **Step 3: Create `apps/api` and `git mv` the package + siblings.**

```bash
mkdir -p apps/api
git mv tui_pilot apps/api/tui_pilot      # schema.sql lives INSIDE the package — moves with it
git mv tests apps/api/tests
git mv requirements.txt apps/api/requirements.txt
git mv plan.md apps/api/plan.md
git mv roles.yaml apps/api/roles.yaml
git mv patterns.yaml apps/api/patterns.yaml
git mv fixtures apps/api/fixtures        # only if it exists at repo root
```
**Verify first** (`find . -maxdepth 2 -name schema.sql`): `schema.sql` is at `tui_pilot/schema.sql`, so it relocates automatically with the package — do NOT add a separate `git mv schema.sql` (it would fail). `plan.md`, `requirements.txt`, `roles.yaml`, `patterns.yaml` are at repo root and ARE moved explicitly above. Leave `docs/`, `README.md`, `Makefile`, `.claude/` at root. `.venv`, `.pytest_cache`, and all `tui_pilot.*` imports are unaffected — the package name does not change.

- [ ] **Step 4: Re-run the test suite from the new location.**

Run: `cd apps/api && python -m pytest -q`
Expected: SAME pass count as Step 2. If `roles.yaml`/`patterns.yaml`/`fixtures` paths fail, confirm they were moved into `apps/api/` (so `parent.parent` resolves to `apps/api/`). Do not edit the `parent.parent` lines — fix by moving the file.

- [ ] **Step 5: Point the Makefile at the new cwd.** Update the run/dev targets to launch uvicorn from `apps/api`, and `setup` to install from `apps/api/requirements.txt`. Keep the uvicorn target string `tui_pilot.server:app` (so `make stop`'s grep still matches). Example:

```makefile
PY_DIR ?= apps/api
api: $(VENV) stop
	@cd $(PY_DIR) && $(RUN_ENV) ../../$(PY) -m uvicorn tui_pilot.server:app --reload --host $(HOST) --port $(PORT)
```
(The combined `make dev` that also starts the client is wired in Task 10 — for now make the api target work standalone.)

- [ ] **Step 6: Verify the API still boots and serves the old UI.**

Run: `make api` (then in another shell) `curl -s http://127.0.0.1:8765/projects | head -c 200`
Expected: JSON `{"projects":[...]}` (possibly empty list). The legacy UI still loads at `http://127.0.0.1:8765/ui/` (served by FastAPI from `tui_pilot/static`, which moved with the package — its mount path is unchanged). Stop with `make stop`.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "refactor(repo): relocate Python API to apps/api monorepo layout"
```

---

## Chunk 2: Next.js scaffold + design tokens

### Task 2: Scaffold the Next.js app with the API proxy

**Files:**
- Create: `apps/client/` (via create-next-app), `apps/client/next.config.ts`, `apps/client/.env.local`

- [ ] **Step 1: Scaffold.**

```bash
cd apps && npx create-next-app@latest client --yes --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*"
```
`--yes` accepts defaults non-interactively. If any flag is rejected by your installed `create-next-app` version (the flag set changes between releases — e.g. `--no-turbopack`/`--src-dir` naming), drop the rejected flag and answer the prompt manually. After scaffolding, **confirm Tailwind v4** (`apps/client/package.json` → `tailwindcss` is `^4`); if it pinned v3, upgrade to v4 per Tailwind's Next.js guide before continuing.

- [ ] **Step 2: Configure the API proxy rewrite.** Edit `apps/client/next.config.ts`:

```ts
import type { NextConfig } from "next";
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:8765";
const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_BASE}/:path*` }];
  },
};
export default nextConfig;
```
Add `API_BASE=http://127.0.0.1:8765` to `apps/client/.env.local`.

- [ ] **Step 3: Verify the proxy reaches FastAPI.** Start the API (`make api`) and the client (`cd apps/client && npm run dev`), then:

Run: `curl -s http://127.0.0.1:3000/api/projects | head -c 200`
Expected: the SAME `{"projects":[...]}` JSON the API returns — proving `/api/projects → /projects` strip works.

- [ ] **Step 4: Set up Vitest + React Testing Library.** Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react` as dev deps. Create `vitest.config.ts` (jsdom env, setup file) and `vitest.setup.ts` (`import "@testing-library/jest-dom"`). Add `"test": "vitest run"` to package.json scripts.

- [ ] **Step 5: Smoke test the harness.** Create `apps/client/lib/__tests__/smoke.test.ts`:

```ts
import { expect, test } from "vitest";
test("vitest runs", () => { expect(1 + 1).toBe(2); });
```
Run: `cd apps/client && npm test`
Expected: 1 passed.

- [ ] **Step 6: Commit.**

```bash
git add apps/client
git commit -m "feat(client): scaffold Next.js app with FastAPI proxy + vitest"
```

### Task 3: Design tokens, fonts, and Tailwind theme

**Files:**
- Modify: `apps/client/app/globals.css`
- Modify: `apps/client/app/layout.tsx` (fonts)

- [ ] **Step 1: Lift the `:root` tokens verbatim.** Open `~/Downloads/design_handoff_spade 2/Spade.html`, copy the entire `:root { ... }` custom-property block (all `--bg*`, `--line*`, `--text*`, `--accent*`, semantic colors, radii) into the top of `globals.css`. Also copy the custom scrollbar rules and the `@keyframes pulse`/`pulse-blue`/`ap-pulse` animations. Set `body` base: `font-size:13.5px; line-height:1.5; -webkit-font-smoothing:antialiased; background:var(--bg); color:var(--text);`.

- [ ] **Step 2: Map tokens into Tailwind v4 `@theme`.** In `globals.css`, after `@import "tailwindcss";`, add an `@theme` block exposing tokens as utilities, e.g.:

```css
@theme {
  --color-bg: var(--bg);
  --color-bg-1: var(--bg-1);
  --color-bg-2: var(--bg-2);
  --color-bg-3: var(--bg-3);
  --color-bg-4: var(--bg-4);
  --color-line: var(--line);
  --color-line-2: var(--line-2);
  --color-text: var(--text);
  --color-text-2: var(--text-2);
  --color-text-3: var(--text-3);
  --color-text-4: var(--text-4);
  --color-accent: var(--accent);
  --color-green: var(--green);
  --color-amber: var(--amber);
  --color-red: var(--red);
  --color-blue: var(--blue);
  --color-pink: var(--pink);
  --color-teal: var(--teal);
}
```
This yields `bg-bg-1`, `text-text-2`, `border-line`, `text-accent`, etc.

- [ ] **Step 3: Load the three fonts via `next/font/google`.** In `layout.tsx`:

```ts
import { Inter_Tight, JetBrains_Mono, Instrument_Serif } from "next/font/google";
const sans = Inter_Tight({ subsets: ["latin"], weight: ["400","500","600","700"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400","500","600"], variable: "--font-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-serif" });
```
Apply `${sans.variable} ${mono.variable} ${serif.variable}` to `<html>`. In `globals.css` set `--sans`, `--mono`, `--serif` to the respective `var(--font-*)`, with `font-feature-settings:"ss01","cv11"` on body. Map into `@theme` as `--font-sans/-mono/-serif` so `font-mono`/`font-serif` utilities work.

- [ ] **Step 4: Render-test a token swatch.** Create a temporary `app/_tokens/page.tsx` rendering a few `bg-bg-1 / text-accent / font-mono` boxes; load `http://127.0.0.1:3000/_tokens`, eyeball that near-black bg + lavender accent + monospace render correctly. (Delete this page before commit, or keep behind `_`.)

- [ ] **Step 5: Commit.**

```bash
git add apps/client/app
git commit -m "feat(client): design tokens, fonts, and Tailwind theme from handoff"
```

---

## Chunk 3: Icons + shared component library

### Task 4: Icon component from the SVG sprite

**Files:**
- Create: `apps/client/components/Icon.tsx`
- Test: `apps/client/components/__tests__/Icon.test.tsx`

- [ ] **Step 1: Extract the sprite.** From `Spade.html`, copy each `<symbol id="i-…">` path data. Build a typed component:

```tsx
const PATHS: Record<string, React.ReactNode> = { brain: <path d="…"/>, tasks: <path d="…"/>, /* … */ };
export type IconName = keyof typeof PATHS;
export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className}>{PATHS[name]}</svg>;
}
```
Include at minimum the icons the shell + two views use: `brain, tasks, board, orch, gate, search, doc, flag, x, check, play, cog, plus, chev, bolt`.

- [ ] **Step 2: Write the test.**

```tsx
import { render } from "@testing-library/react";
import { Icon } from "../Icon";
test("renders an svg for a known icon", () => {
  const { container } = render(<Icon name="brain" />);
  expect(container.querySelector("svg")).toBeInTheDocument();
});
```
- [ ] **Step 3: Run** `npm test` → PASS.
- [ ] **Step 4: Commit** `feat(client): Icon component from handoff sprite`.

### Task 5: Shared UI components

**Files:**
- Create: `apps/client/components/ui/{Btn,IconBtn,Chip,Priority,Avatar,Card,Kbd,TogglePill,Subtab,PageHead}.tsx`
- Test: `apps/client/components/ui/__tests__/ui.test.tsx`

Build each per the handoff `README.md` "Shared Components" section and the CSS in `Spade.html`. Use Tailwind utilities backed by tokens; for the few bespoke ones (chip dot, priority glow, toggle thumb) a small CSS class in `globals.css` is fine.

- [ ] **Step 1: `Card`, `Btn`, `Kbd`** (simplest). `Btn`: `inline-flex items-center gap-1 px-2.5 py-[5px] rounded-md bg-bg-1 border border-line text-text-2 text-[12px]`; `primary` variant = lavender gradient + dark text + weight 600; `ghost` = transparent/muted; `xs` = smaller. `Card`: `bg-bg-1 border border-line rounded-lg`.
- [ ] **Step 2: `Chip`, `Priority`, `Avatar`.** `Chip`: mono, `px-[7px] py-[2px] rounded text-[11px]` with a leading colored dot; typed variants (`feature`=accent, `decision`=amber, `feedback`=blue, `bug`=red, `metric`=teal, `convention`=pink, `meeting`=grey) set dot+text color. `Priority`: 8px dot, `p0` red+glow … `p3` faint. `Avatar`: 22px circle, grey gradient; `ai` variant = lavender gradient + dark text.
- [ ] **Step 3: `IconBtn`, `TogglePill`, `Subtab`, `PageHead`.** `PageHead`: header bar `px-[22px] py-[14px] border-b border-line` with H1 (15px) left + actions right.
- [ ] **Step 4: One render test per component group** asserting it renders and applies the variant (e.g. `Btn` primary has the gradient class; `Chip` decision shows amber). Keep assertions structural.
- [ ] **Step 5: Run** `npm test` → all PASS.
- [ ] **Step 6: Commit** `feat(client): shared UI component library from handoff tokens`.

---

## Chunk 4: Data layer

### Task 6: Typed API client, types, adapters, and project selection

**Files:**
- Create: `apps/client/lib/{types.ts,api.ts,adapters.ts,useProject.ts}`
- Test: `apps/client/lib/__tests__/{adapters.test.ts,useProject.test.tsx}`

- [ ] **Step 1: Define types** (`types.ts`) matching the real API:

```ts
export type Project = { id: string; name: string; path: string; account_strategy: string; model_ceiling: string | null; autopilot: number; created_at: string };
export type BrainNodeType = "feature"|"decision"|"convention"|"feedback"|"bug"|"metric";
export type BrainNode = { id: string; project_id: string; type: BrainNodeType; label: string; detail: string | null; x: number|null; y: number|null };
export type Task = { id: string; project_id: string; title: string; feature: string|null; priority: number; status: string; origin_quote: string|null; origin_source: string|null; description: string|null; created_at: string; nodes: BrainNode[] };
export type Comment = { id: string; author: string|null; kind: string; body: string; created_at: string };
export const STATUSES = ["ready","in_progress","review","shipped","blocked"] as const;
```

- [ ] **Step 2: `api.ts` fetch wrapper** (all calls go to `/api/*`):

```ts
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers||{}) } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
export const api = {
  projects: () => http<{projects: Project[]}>("/projects"),
  tasks: (projectId: string) => http<{tasks: Task[]}>(`/tasks?project_id=${encodeURIComponent(projectId)}`),
  task: (id: string) => http<Task>(`/tasks/${id}`),
  comments: (id: string) => http<{comments: Comment[]}>(`/tasks/${id}/comments`),
  moveTask: (id: string, status: string) => http<Task>(`/tasks/${id}/move`, { method: "POST", body: JSON.stringify({ status }) }),
};
```

- [ ] **Step 3: `adapters.ts` — pure functions (TEST FIRST).** Write failing tests in `adapters.test.ts` first:
  - `groupNodesByType(nodes)` → `{ decision: BrainNode[], bug: [], feedback: [], metric: [], … }` (drives Task-detail evidence sections).
  - `projectGlyph(project)` → first letter of name, uppercased.
  - `projectColor(project)` → deterministic pick from the handoff glyph palette (`#c9b8ff,#7ad19a,#f0c674,#9bd1f0`) by hashing `project.id`.
  - `projectSlug(project)` → kebab-case of name.
  - `tasksByStatus(tasks)` → `Record<status, Task[]>` for the board columns.

```ts
test("groups nodes by type", () => {
  const g = groupNodesByType([{type:"bug"} as any, {type:"bug"} as any, {type:"decision"} as any]);
  expect(g.bug).toHaveLength(2); expect(g.decision).toHaveLength(1);
});
test("color is deterministic", () => {
  expect(projectColor({id:"p1"} as any)).toBe(projectColor({id:"p1"} as any));
});
```
- [ ] **Step 4: Run** `npm test` → FAIL (functions undefined). Implement `adapters.ts`. Re-run → PASS.

- [ ] **Step 5: `useProject.ts` — selection hook (TEST the logic).** Fetches projects via SWR, exposes `{ projects, project, setProject, loading }`. Active id resolution: localStorage `spade.projectId` if still present in the list, else first project, else `null`. `setProject` persists to localStorage. Write a test that mocks `api.projects` and asserts: (a) first project chosen when storage empty; (b) stored id honored when valid; (c) `null` when list empty.

- [ ] **Step 6: Run** `npm test` → PASS.
- [ ] **Step 7: Commit** `feat(client): typed API client, adapters, and project selection`.

---

## Chunk 5: App shell

### Task 7: Topbar + Sidebar layout

**Files:**
- Create: `apps/client/components/shell/{Topbar,Sidebar,ProjectSwitcher}.tsx`
- Modify: `apps/client/app/layout.tsx`, `apps/client/app/page.tsx`

- [ ] **Step 1: Layout grid.** In `layout.tsx`, wrap children in the handoff `.app` grid: `grid-template-columns:232px 1fr; grid-template-rows:44px 1fr; height:100vh; overflow:hidden`. Row 1 = `<Topbar/>` (spans both cols), Row 2 = `<Sidebar/>` + `<main className="overflow-auto">{children}</main>`.
- [ ] **Step 2: `Topbar`.** Left→right per handoff: brand (gradient lavender square + "Spade", links `/`), `<ProjectSwitcher/>`, command pill ("Ask the brain…" + `<Kbd>⌘K</Kbd>`), right group: daemon pill (pulsing green dot + "daemon · N sessions" — static text OK for M1), sprint pill (static), account pill (static), tweaks `<IconBtn name="bolt"/>`, avatar "RM". Static labels are fine where no endpoint exists; mark them `/* static M1 */`.
- [ ] **Step 3: `ProjectSwitcher`** (client component). Uses `useProject()`. Renders glyph chip (`projectGlyph`+`projectColor`) + project name + chevron; dropdown lists projects (check on active), "All projects", "New project" (the last two can be no-ops/disabled for M1). Empty state: dashed "Select a project" placeholder when `project` is null (the handoff `workspace-level` look).
- [ ] **Step 4: `Sidebar`.** Header card (project glyph + name + slug, or placeholder). Grouped nav using `<Link>` + `<Icon>` + optional mono badge: **Project** (Overview, Ask), **Plan** (Sprints, Backlog→`/backlog`, Product brain, Graph & Issues), **Execution** (Orchestrator, Agent pool, Human gates), **Inputs** (Meetings, Feedback, Decisions), **System** (CLI/logs, Settings). Only Backlog routes to a real page in M1; the rest are `<Link href="#">` placeholders styled identically. Active state via `usePathname()`. Footer: muted "Local-first · v1.0.0" + mono `~/.spade · 84 MB` (`/* static design label */`).
- [ ] **Step 5: `page.tsx`** redirects `/` → `/backlog` (`import { redirect } from "next/navigation"`).
- [ ] **Step 6: Render test** for `Sidebar` (asserts "Backlog" link points to `/backlog`) and `ProjectSwitcher` (asserts placeholder shows when no project). Run `npm test` → PASS.
- [ ] **Step 7: Manual check.** `npm run dev` → shell renders at 232/44 grid, dark + lavender, fonts correct. Sidebar + topbar match handoff density.
- [ ] **Step 8: Commit** `feat(client): app shell — topbar, sidebar, project switcher`.

---

## Chunk 6: Backlog view

### Task 8: Backlog board wired to the API

**Files:**
- Create: `apps/client/app/backlog/page.tsx`, `apps/client/components/backlog/{Board,TaskCard}.tsx`
- Test: `apps/client/components/backlog/__tests__/TaskCard.test.tsx`

- [ ] **Step 1: `TaskCard`** (presentational, per `views/backlog.jsx`). Mono header = `<Priority p={…}/>` + ID (`SPD-NNN`) + feature; title; intel bar (thin multi-segment bar summarizing `task.nodes` by type — a row of colored segments); chip meta (a `<Chip>` per distinct node type present); footer = assigned agent text or "—" (no agent field in API yet → show "unassigned", `/* no agent endpoint M1 */`). Clicking links to `/task/${task.id}`.
- [ ] **Step 2: Test `TaskCard`** renders ID, title, and a priority dot; links to the task. Run → PASS.
- [ ] **Step 3: `Board`** (client). Props: `tasks: Task[]`. Uses `tasksByStatus` to render columns Ready / In progress / Review / Shipped / Blocked, each a column header + count + stacked `TaskCard`s. Empty column = subtle empty state.
- [ ] **Step 4: `backlog/page.tsx`** (client). Uses `useProject()` for the active id, then SWR `useSWR(project ? ["tasks", project.id] : null, () => api.tasks(project.id))`. States: no project → "Select or create a project" empty state; loading → skeleton/columns; loaded empty → empty board; error → inline error. Wrap content in `<PageHead>Backlog</PageHead>`.
- [ ] **Step 5: Seed + manual verify.** With the API running, ensure at least one project + a few tasks exist (create via `curl -X POST /api/projects` and `/api/tasks`, or reuse `make`/existing data). Load `http://127.0.0.1:3000/backlog` → real tasks appear in the right columns, matching handoff card layout.
- [ ] **Step 6: Run** `npm test` → PASS. **Commit** `feat(client): Backlog board wired to live API`.

---

## Chunk 7: Task detail view

### Task 9: Task detail wired to the API

**Files:**
- Create: `apps/client/app/task/[id]/page.tsx`, `apps/client/components/task/{OriginCard,EvidenceSection,TimelineRail,MetaRow}.tsx`
- Test: `apps/client/components/task/__tests__/EvidenceSection.test.tsx`

- [ ] **Step 1: `OriginCard`** (per `views/task.jsx`). Serif italic `task.origin_quote` + `origin_source` (speaker/source). If `origin_quote` is null → omit the card (empty state, don't fabricate).
- [ ] **Step 2: `EvidenceSection`.** Props: `title`, `node-type`, `nodes: BrainNode[]`. Renders a titled section listing nodes of that type (label + detail). Used for decisions / bugs / feedback / metric, driven by `groupNodesByType(task.nodes)`. A section with zero nodes renders a muted "No linked {type}" empty state. Test: passing 2 decision nodes renders both labels; passing `[]` renders the empty state.
- [ ] **Step 3: `MetaRow` + side rail.** Metadata rows (ID, feature, priority, status, created) + `TimelineRail`: a vertical timeline built from `GET /tasks/{id}/comments` (the activity trail) — each comment = a dot + author + kind + body + relative time; latest/current marked accent/green.
- [ ] **Step 4: `task/[id]/page.tsx`** (client). SWR for `api.task(id)` and `api.comments(id)`. Two columns: main (`OriginCard` + the four `EvidenceSection`s) + 320px side rail (`MetaRow`s + `TimelineRail`). 404 → "Task not found" state. Wrap in `<PageHead>` showing breadcrumb `Backlog / SPD-NNN`.
- [ ] **Step 5: Run** `npm test` → PASS.
- [ ] **Step 6: Manual verify the round trip.** From `/backlog`, click a card → lands on `/task/SPD-NNN` with real origin quote, evidence sections populated from grounded nodes, timeline from comments. Confirm tokens/density match `views/task.jsx`.
- [ ] **Step 7: Commit** `feat(client): Task detail view wired to live API`.

---

## Chunk 8: Dev workflow + docs

### Task 10: `make dev` runs both servers; README update

**Files:**
- Modify: `Makefile`, `README.md`

- [ ] **Step 1: Combined `make dev`.** Update `dev` to start the API (background) and the Next dev server together, with a clean shutdown. Update `setup` to also `npm install` in `apps/client`. Update `stop` to also kill the next dev server. Update `open` to point at `http://127.0.0.1:3000`. Example:

```makefile
setup:
	@... existing python setup ...
	@cd apps/client && npm install
	@echo "✓ setup complete — run 'make dev'"

# Run both servers under one process group; `trap 'kill 0'` + `wait` ensures
# Ctrl-C tears down BOTH children (job-control %1 is unreliable in make/sh).
dev: $(VENV) stop
	@echo "▶ API → :$(PORT)   UI → http://127.0.0.1:3000"
	@bash -c 'trap "kill 0" INT TERM; \
	  ( cd apps/api && $(RUN_ENV) ../../$(PY) -m uvicorn tui_pilot.server:app --reload --host $(HOST) --port $(PORT) ) & \
	  ( cd apps/client && npm run dev ) & \
	  wait'

stop:
	@pkill -f "uvicorn tui_pilot.server:app" 2>/dev/null && echo "• stopped api" || true
	@pkill -f "next dev" 2>/dev/null && echo "• stopped client" || true
```
(Adjust to taste; the requirement is: one command, both servers, UI on :3000, Ctrl-C and `make stop` both kill both. The `trap "kill 0"` on the shared process group is what makes Ctrl-C reliable — do not use bare `kill %1`.)

- [ ] **Step 2: Verify.** `make stop && make dev` → both boot; `http://127.0.0.1:3000/backlog` works end-to-end; pressing `Ctrl-C` in the `make dev` terminal tears down BOTH servers (verify with `pgrep -f "uvicorn tui_pilot"` and `pgrep -f "next dev"` returning nothing). `make stop` from another shell also kills both.
- [ ] **Step 3: README.** Add a short "Monorepo layout" + "Running the new UI" section: `apps/api` (Python) / `apps/client` (Next.js), `make dev`, note the legacy `/ui/` still exists as fallback until parity.
- [ ] **Step 4: Run the full api suite once more** from `apps/api` (`python -m pytest -q`) → PASS (guards against accidental breakage).
- [ ] **Step 5: Commit** `feat(dev): make dev runs api + client; document monorepo layout`.

---

## Done criteria (Milestone 1)

- `cd apps/api && python -m pytest -q` passes with the same count as before the move.
- `make dev` brings up both servers; `http://127.0.0.1:3000` renders the shell (232/44 grid, dark + lavender, three fonts).
- `/backlog` lists real tasks from the live API in status columns, cards matching `views/backlog.jsx`.
- Clicking a card opens `/task/SPD-NNN` with real origin quote, evidence sections from grounded brain nodes, and a timeline from comments — matching `views/task.jsx` tokens/density.
- Shared token system, icon set, and UI component library exist and are reused by both views.
- The legacy `tui_pilot/static` UI remains reachable at `/ui/` (no big-bang cutover).
