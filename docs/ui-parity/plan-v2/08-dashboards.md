# Home + Overview + Sprints — full-parity plan

Goal: **FULL visual + data parity** with `docs/Spade (standalone).html` for three currently-unbuilt
screens — the cross-project **Home** triage dashboard (`mod_04`), the per-project **Overview**
(`mod_03`), and **Sprints** (`mod_14`) — *including* rich demo data mirroring the reference
`SpadeData`. Real data (projects, tasks, pipelines, brain, decisions) is used where it fits; the
rest is **SEEDed** to match the reference exactly. Net-new real backend (Sprints) is flagged as a
follow-up PR + validation test, not blocking parity.

Reference files (scratchpad):
`modules/mod_04.js` HomeView · `modules/mod_03.js` OverviewView · `modules/mod_14.js` SprintsView ·
`modules/mod_01.js` SpadeData (`projects` L325-330, `sprints` L110-116, `meetings`, `feedbackClusters`,
`decisions`) · `inner.html` CSS (`.tri-*` L3056-3508, `.ov-*` L2281-2601, `.sprint-*`/`.stack-bar`/
`.burn-svg` L1649-1673, `.home-mode`/`.workspace-level` shell L506-524, `.page-head` L662-670) ·
`modules/mod_22.js` L23-26 (the `document.body.classList.toggle('home-mode'|'workspace-level', …)`
shell-mode driver).

Our app: `apps/client` (Next.js, "NOT the Next.js you know" — read `node_modules/next/dist/docs/`
before writing). `app/page.tsx` is a 5-line `redirect("/backlog")`. No `/overview`, no `/sprints`.
Design tokens already match (`app/globals.css`). Building blocks present: `lib/api.ts`,
`lib/adapters.ts` (`projectGlyph`/`projectColor`/`projectSlug`), `lib/useProject.ts` (shared
active-project store via `useSyncExternalStore`), `lib/useShell.ts`, `components/ui/*`
(`Btn`/`Chip`/`Card`/`TogglePill`/`PageHead`/`Avatar`/`Kbd`), `components/Icon.tsx`.

---

## Target (each screen, every region)

### HOME — `mod_04.js` (`HomeView` + `ProjectsTable` + `Kpi`/`TriRow`/`BurndownMini`/`VelocityMini`)
Full-bleed (`tri-wrap`), vertical scroll. **Sidebar hidden, full-bleed main, lavender tint** via the
home-mode shell. Top→bottom:

1. **Warm hero** (`.tri-hero`): left = mono eyebrow `MONDAY · MON, JUN 27 · 3:14 PM` (live
   `dayName()/dateString()/now()` uppercased), serif title `{greeting()}, Robert.` (time-based), sub:
   `**14 pipelines** running across **4 projects**. {N} items need your eyes. · {N} P0 · $142.30
   spent of $600 cap` (items amber when >0, P0 red, spend muted). Right = two ghost buttons
   `[graph] Workspace`, `[spark] Ask follow-up`.
2. **KPI band** (`.tri-kpis`): 6 `Kpi` cards (`label`/`value`/`sub`/`hot`/`accent`/`bar` variants) —
   PIPELINES RUNNING `14` (accent) · WAITING HUMAN `{gate-count}` (hot>5, sub `oldest {N}m` when
   oldestWait>30) · P0 OPEN `{count}` (hot>0) · SPEND TODAY `$142.30` sub `of $600 cap` + fill bar
   (spend/cap) · AGENTS ACTIVE `18/24` sub `across 4 accts` · SHIPPED TODAY `7` sub `3 auto · 4
   reviewed`.
3. **Triage queue** (`.tri-section`): header `Triage queue` + muted mono `{filtered} of {total}` +
   spacer + search box (`[search] Search items`). **Filters** (`.tri-filters`) four groups —
   PROJECT (chip per project, colored glyph + name) · SEVERITY (P0/P1/P2 sev-colored) · CATEGORY
   (Gates/Blockers/Feedback/Sprint drift/Agents/Spend/Decisions) · `[flag] Mine only` + conditional
   `Clear all`. **Item list** (`.tri-list`) of `TriRow`: sev badge · cat pill (dot+label) · body
   (mono id + title, meta: detail · `[clock] waiting 38m` amber>30m · assignee) · project chip
   (glyph+name) · actions (`[primary] quick-action`, `[ghost] Open`, snooze icon-btn). **Empty**:
   `[check] Nothing matches these filters.`. Feed = **13 synthetic items** (see Data sourcing),
   sorted P0>P1>P2 → longest wait → category rank.
4. **Projects health table** (`ProjectsTable`, `.tri-section`): header `Projects` + `{filtered} of
   {total}` + state toggle `Active/Paused/All` + search + `[plus] New project`. Sortable
   `.tri-table` cols: STATUS (dot hot/warn/ok/paused) · PROJECT (glyph+name+mono slug) · NEEDS YOU
   (amber>3) · GATES (amber>2) · SPRINT (mono sprintCounter) · DRIFT (`+N` pts, amber>1) · VELOCITY
   (`VelocityMini` spark + `↑/↓/→N` trend) · TOP ISSUE (sev badge + title) · arrow. Sortable headers
   show `↑/↓`. Row click → set project + navigate to `/overview`. Empty: `No projects match these
   filters.`

### OVERVIEW — `mod_03.js` (`OverviewView`)
Per-project dashboard. Fixed `.page-head` + scrolling `.ov-scroll`.
1. **Page head**: breadcrumb proj-glyph chip + `**Overview** · {slug}`. Right `[term] CLI`,
   `[cog] Project settings`, `[primary] [orch] Orchestrator`.
2. **Hero band** (`.ov-hero`): left = mono eyebrow `PROJECT · {SLUG}`, serif title `{proj.name}`,
   `{proj.desc}`, tag chips `● {state}` (green), `{sprintCounter}`, `main · clean`,
   `{brainNodes} brain nodes`. Right = 6 stat cells: `running` (+ `.ov-pulse` dot), `queued`,
   `gates` (amber/warn), `agents`, `autoflows`, `$4.18 spend today`.
3. **Grid** (`.ov-grid`) — 7 cards w/ span classes:
   - **Needs you** (`.span-2`, amber gate icon, count badge, `Open gates →`): 3 `.ov-need`
     (severity high/med/low) — kind pill (merge/conflict/spend) + title + meta (who · reason) +
     aside (`waiting 8m`, `Review`/`Open task`).
   - **Sprint {num}** (board icon, `Board →`): label, mono `{dates} · day {days}`, segmented stacked
     bar (`.ov-sprint-bar`: shipped green / review accent / progress blue / ready bg-3 / blocked
     red), legend, burndown mini-SVG `.ov-burn` (`BURNDOWN · 4 ahead of ideal`).
   - **Now executing** (`.span-2`, live pulse icon, `{N} live` badge, provider chips
     `Claude 5 / Codex 2 / Gemini 1` w/ colored dots, `All →`): up to 6 `.ov-pipe` cards (mono id +
     optional `P0` + mono eta, title, progress bar, footer feature + `{progress}%`).
   - **Watchlist** (red bolt icon): 4 `.ov-watch-row` (icon warn⚠/hot●/ok● + title + muted sub).
   - **Recent decisions** (doc icon, `All ADRs →`): 3 `.ov-dec` buttons (mono id + status pill +
     title + mono `owner · date`).
   - **Inputs** (mic icon): MEETINGS (3 rows: title + mono `duration · {t}t/{d}d/{q}q`) + HOT
     FEEDBACK (neg clusters: label + `count signals · trend · linkedTask`).
   - **Jump to** (`.span-3`): 6 `.ov-jump-card` (Backlog / Product brain / Active tasks / Feedback /
     Meetings / CLI logs).

### SPRINTS — `mod_14.js` (`SprintsView` + `SprintRow` + `Burndown`)
Fixed `.page-head` + 3-card `.sprint-hero` + scrolling `.sprint-list`.
1. **Page head**: breadcrumb `**Sprints** · {slug}`. Right `[cal] Cadence: 2 weeks`,
   `[spark] Auto-plan next sprint`, `[primary] [plus] New sprint`.
2. **Sprint hero** (`.sprint-hero`, 3 cards):
   - Current card: mono eyebrow `CURRENT · SPRINT {num}`, serif `{label}`, muted
     `{dates} · day {days} · {theme}`, `.sprint-progress` stacked bar (shipped/review/progress/ready),
     legend (4 swatches).
   - Burndown card: eyebrow `BURNDOWN`, `Burndown` SVG (`.burn-svg`, ideal dashed + actual accent +
     endpoint dot), mono `on pace · 4 ahead of ideal`.
   - Velocity card: eyebrow `VELOCITY (LAST 4)`, 4 bars (last = accent) w/ value labels + `S23..S26`.
3. **Sprint list** (`.sprint-list`): `All sprints` label, then `SprintRow` per sprint (sorted
   desc by num) — serif italic `{num}` (accent if current) + label (+ `current`/`planning` chip) +
   muted `{dates} · {theme}` + `.stack-bar` (5 segments) + right mono progress
   (`{shipped}/{planned} shipped` done · `{shipped}/{total} done` current · `{ready} planned`
   planning).

---

## Current state (unbuilt)
- **Home**: `app/page.tsx` = `redirect("/backlog")`. No triage/KPI/projects-table code; zero
  `tri-*`/`HomeView` hits. **Blocker.**
- **Overview**: no `app/overview/` route, no `ov-*` components/CSS. **Blocker.**
- **Sprints**: no `app/sprints/` route, no `sprint-*`/`stack-bar`/`burn-svg` CSS, no sprints data
  (no `api.sprints`, no `Sprint` type). Sidebar `Sprints` + `Overview` are `href:"#"` (disabled
  "Próximamente"). **Blocker.**
- **Home-mode shell machinery** (`body.home-mode`: hide sidebar, full-bleed main, lavender tint) does
  **not exist** in our shell. The reference drives it via `document.body.classList.toggle` per active
  view (`mod_22.js` L23). Our `app/layout.tsx` is a server component rendering a fixed
  `<Topbar/> <Sidebar/> <main>` `.app` grid — no per-route body class. **Must be built first.**
- Project type mismatch: our real `Project` (`lib/types.ts` L11) has NO `glyph/color/slug/state/
  sprintCounter/brainNodes/workers/agents/automations/desc` — those are reference-only and must be
  SEEDed/derived.

---

## Build steps

### Step 0 — Home-mode shell (DEPENDENCY for Home; do first)
The full-bleed home shell needs a body class applied per-route on the **client**. `app/layout.tsx`
stays a server component; add a tiny client component that toggles `document.body` classes.

1. `components/shell/ShellMode.tsx` (`"use client"`): reads `usePathname()`; in a `useEffect`
   toggles `document.body.classList.toggle("home-mode", pathname === "/")` (and
   `"workspace-level"` reserved for the future Workspace screen). Cleanup removes both on unmount.
   Returns `null`. Mount it inside `<body>` in `app/layout.tsx` (above `.app`).
2. Port shell CSS into `app/globals.css` from `inner.html` L506-524 — adapting selectors to our DOM
   (`.app` grid, `.sidebar`, `.main`→our `<main>`, `.topbar`). Keep our existing `.app` grid intact;
   home-mode overrides: `body.home-mode .sidebar { display:none } body.home-mode main { grid-column:
   1 / -1 }` + the lavender topbar/sidebar tint (the tint only matters once Workspace exists; ship
   the `home-mode` rules now, `workspace-level` rules can come with Workspace).
3. Verify Topbar still renders in home-mode (reference keeps the topbar; only the sidebar hides).

### Step 1 — Seed layer + triage builder (`lib/`)
- `lib/projectMeta.ts` — SEED map keyed by real project id → `{ glyph, color, slug, state,
  sprintCounter, brainNodes, workers, agents, automations, desc }`, mirroring `mod_01` L325-330.
  Provide a `projectMeta(p: Project)` that returns the seed if present, else **derives** from real
  data (`projectGlyph`/`projectColor`/`projectSlug` + live counts from `useShell`) so new real
  projects still render. (Note: real ids are arbitrary; key the seed by name-match or first-N real
  projects → acme/mobile/tools/labs, documented in the file.)
- `lib/triage.ts` — port from `mod_04` L504-638 verbatim (adapted to TS):
  `buildTriageFeed()` (the 13 hard-coded items, L510-593), the P0>P1>P2 → wait → catRank sort
  (L596-602), `navigateToItem(it, router)` (replace `goto` with Next `router.push` + set project via
  `useProject().setProject`), `mockBurndownFor(id)` (L613-621), `mockVelocityFor(id)` (L623-631),
  `fmtWait(min)` (L633-638), and the time helpers `now()/dayName()/greeting()/dateString()`
  (L640-657). Type the `TriItem` shape: `{ id, project, cat, catLabel, sev, title, detail, waitMin?,
  mine, quick?, assignee?, target }`.
- `lib/sprintsSeed.ts` — SEED the 5 sprints from `mod_01` L110-116 (`Sprint` type: `{ num, label,
  dates, state: "current"|"done"|"planning", days?, planned, shipped, review, progress, ready,
  blocked, theme }`). Export `sprints` + `currentSprint()` helper. (Real backend = follow-up.)

### Step 2 — Home (`app/page.tsx` → `<HomeView/>`)
Replace the redirect. New `"use client"` page rendering `<HomeView/>`. Components under
`components/home/`:
- `HomeView.tsx` — owns filter state (`projFilter/sevFilter/catFilter` Sets, `mineOnly`, `search`,
  `snoozed` Set), `buildTriageFeed` via `useMemo`, KPI aggregates (`mod_04` L33-45). Uses
  `useProject()` for the project list + `setProject`, `useRouter()` for nav.
- `TriageHero.tsx` — eyebrow (live time helpers, guard SSR hydration: render times only after mount
  via `useEffect`/`useState` so server+client markup match — this is "NOT the Next.js you know", read
  the hydration guidance), serif greeting, stats sub-line.
- `KpiBand.tsx` + `Kpi.tsx` — 6 cards (port `Kpi` `mod_04` L338-349, classes `.tri-kpi`/`.accent`/
  `.hot`/`.tri-kpi-bar`).
- `TriageQueue.tsx` (header + search) + `TriageFilters.tsx` (4 chip groups + Clear all,
  `.tri-filters`/`.tri-chip`/`.tri-fl`) + `TriRow.tsx` (port `mod_04` L351-392, `.tri-row`/`.tri-sev`/
  `.tri-cat-pill`/`.tri-body`/`.tri-proj`/`.tri-actions`) + empty state.
- `ProjectsTable.tsx` — port `mod_04` L174-336 (sort state, `stateFilter`, `enriched`/`filtered`/
  `sorted`, `.tri-table` markup). Row click: `setProject(p.id)` then `router.push("/overview")`.
- `charts/BurndownMini.tsx` + `charts/VelocityMini.tsx` — port the two SVGs verbatim (`mod_04`
  L470-502).
- Port `.tri-*` CSS (`inner.html` L3056-3508) into `app/globals.css`.

### Step 3 — Overview (`app/overview/page.tsx` → `<OverviewView/>`)
New route + `components/overview/`:
- `OverviewView.tsx` (`"use client"`) — `useProject()` for active project; resolve seed via
  `projectMeta`; **real** running/queued/blocked from `api.pipelines(project.id)` (SWR), **real**
  `decisions` from `api.brainNodes` filtered `type==="decision"` (slice 3), **real** `tasks` count
  for Jump-to/backlog. SEED `gates[]` (`mod_03` L15-19), `providerMix` (L22-26), watchlist rows,
  meetings/feedback (no real endpoints) — see Data sourcing.
- `OverviewHead.tsx`, `OverviewHero.tsx` (+ `.ov-stat-cell` w/ `.ov-pulse`), and the 7 cards:
  `NeedsYouCard`, `SprintPulseCard` (segmented bar + burndown SVG, fed by `sprintsSeed`),
  `NowExecutingCard` (provider chips + `PipeCard`), `WatchlistCard`, `RecentDecisionsCard`,
  `InputsCard`, `JumpToCard`. Buttons navigate via `useRouter` to real routes
  (`/gate`,`/sprints`,`/orchestrator`,`/decisions`,`/backlog`,`/brain`,`/active`); unbuilt targets
  (`/meetings`,`/feedback`,`/cli`,`/settings`) point at `#`/no-op for now (flag as cross-cluster
  dependency — those screens are other clusters' work).
- Port `.ov-*` CSS (`inner.html` L2281-2601) into `app/globals.css`.

### Step 4 — Sprints (`app/sprints/page.tsx` → `<SprintsView/>`)
New route + `components/sprints/`:
- `SprintsView.tsx` (`"use client"`) — reads `sprintsSeed`; `currentSprint`, burndown ideal/actual
  arrays (`mod_14` L7-9). Renders head + hero + list.
- `SprintHero.tsx` (3 cards), `SprintRow.tsx` (port `mod_14` L72-101), `Burndown.tsx` (port L103-117,
  class `.burn-svg`).
- Port `.sprint-hero`/`.sprint-progress`/`.sprint-row`/`.stack-bar`/`.burn-svg` CSS
  (`inner.html` L1649-1673) into `app/globals.css`.

### Step 5 — Nav wiring (sidebar / topbar / page links)
- `Sidebar.tsx`: change `Overview` `href:"#"` → `/overview`, `Sprints` `href:"#"` → `/sprints`
  (remove "Próximamente"). Add an **Overview**-as-home consideration: the topbar brand `Link href="/"`
  already targets Home — keep it. Sidebar is hidden on Home via home-mode, so Overview/Sprints links
  are reached from Overview/Projects-table, not Home.
- Confirm `ProjectsTable` row click and the topbar brand correctly toggle home-mode (ShellMode reacts
  to `usePathname`).

---

## Data sourcing (REAL | SEED | BACKEND-FEATURE)

| Region / field | Source | Notes |
|---|---|---|
| Home: project list (Projects table, PROJECT filter chips) | **REAL** | `api.projects()` via `useProject()`. |
| Home: per-project glyph/color/slug | **REAL** | `lib/adapters` `projectGlyph/projectColor/projectSlug`. |
| Home: project state/sprintCounter/brainNodes/workers | **SEED** | `lib/projectMeta.ts` (mirror `mod_01` L325-330); fall back to live `useShell` counts for unknown ids. |
| Home: triage feed (13 items) | **SEED** | `buildTriageFeed` (`mod_04` L510-593) — IDs/titles/sev/wait verbatim. No real cross-project triage endpoint exists. |
| Home: KPI pipelines-running | **REAL→SEED** | `api.pipelines` count `|| 14` (matches reference fallback). |
| Home: KPI waiting/P0 | **REAL-ish (derived from SEED feed)** | counts off the seeded feed (matches reference). |
| Home: KPI spend/agents/shipped | **SEED** | `$142.30/$600`, `18/24`, `7` — no spend/agent-usage endpoints. |
| Home: burndown/velocity sparklines | **SEED** | `mockBurndownFor`/`mockVelocityFor` (`mod_04` L613-631). |
| Overview: running/queued pipelines + Now-executing pipes | **REAL** | `api.pipelines(project.id)`, filter by status; pipe cards from real runs (id/title/progress). |
| Overview: recent decisions | **REAL** | `api.brainNodes` filtered `type==="decision"`, slice 3 (Decisions cluster already does this). |
| Overview: backlog/active counts (Jump-to) | **REAL** | `api.tasks`, `api.pipelines`. |
| Overview: hero stat `$4.18 spend today`, agents, autoflows | **SEED** | from `projectMeta` + literal. |
| Overview: Needs-you gates (3) | **SEED** | `mod_03` L15-19 (real gates live in `/gate`; this card is a curated preview). |
| Overview: provider mix (Claude/Codex/Gemini) | **SEED** | `mod_03` L22-26. |
| Overview: Watchlist rows (4) | **SEED** | hard-coded in `mod_03` L220-247. |
| Overview: Inputs — meetings + hot feedback | **SEED** | `mod_01` meetings (L118-129) + feedbackClusters neg (L131-139); no real meetings/feedback endpoints. |
| Overview: sprint pulse card | **SEED** | `sprintsSeed` current sprint. |
| Sprints: all sprints + hero + burndown + velocity | **SEED** | `lib/sprintsSeed.ts` (mirror `mod_01` L110-116) + `mod_14` burn/velocity arrays. |
| Home-mode shell tint/full-bleed | **N/A (CSS)** | new shell CSS + `ShellMode` client toggle. |

**BACKEND-FEATURE (planned follow-up, not blocking parity):**
- **Sprints backend.** New `Sprint` type + persistence + endpoints: `GET /sprints?project_id=`,
  `GET /sprints/:num`, `POST /sprints` (New sprint), `POST /sprints/:num/auto-plan`. Derive
  shipped/review/progress/ready/blocked from real task statuses in the sprint; burndown from task
  close timestamps; velocity from last-N completed sprints. Wire `api.sprints()` and swap
  `sprintsSeed` → real in SprintsView + Overview SprintPulseCard. Ship behind the same component
  contract so the seeded UI is the spec. **Follow-up PR (F) + validation test** below.

---

## Validation

### Playwright (`e2e/`, one spec per screen, mirroring existing specs)
- `e2e/home.spec.ts` — `/` renders `.tri-wrap`; greeting + live eyebrow present; **6** `.tri-kpi`
  cards; triage list has **13** `.tri-row` initially; filter by a project chip narrows the list and
  updates `{filtered} of {total}`; SEVERITY `P0` filter shows only `.sev-P0` rows; `Mine only`
  toggles; `Clear all` restores 13; a search with no match shows `Nothing matches these filters.`;
  Projects table renders 4 rows, header sort toggles `↑/↓`, state toggle `Paused` shows only the
  labs row; clicking a project row navigates to `/overview`.
- `e2e/home-shell.spec.ts` — on `/`, `body` has class `home-mode` and `.sidebar` is not visible;
  navigating to `/overview` removes `home-mode` and the sidebar reappears.
- `e2e/overview.spec.ts` — `/overview` renders `.ov-hero` w/ project name + 6 `.ov-stat-cell`; all 7
  `.ov-card` regions render (`Needs you`, `Sprint`, `Now executing`, `Watchlist`, `Recent
  decisions`, `Inputs`, `Jump to`); provider chips show Claude/Codex/Gemini; Jump-to `Backlog`
  navigates to `/backlog`; `Board →` navigates to `/sprints`.
- `e2e/sprints.spec.ts` — `/sprints` renders `.sprint-hero` (3 cards), current sprint label `Mobile
  checkout polish`, **5** `.sprint-row` sorted desc (27 planning first), burndown `.burn-svg`
  present, velocity 4 bars; current row has `current` chip.
- `e2e/sprints-backend.spec.ts` *(follow-up PR F only)* — with the real endpoint, `/sprints` rows
  reflect API data; `New sprint` POSTs and a new row appears; counts equal task-status rollups.

### Manual
- Home full-bleed: sidebar gone, content edge-to-edge, topbar still present; lavender tint when
  Workspace lands. Live clock updates; greeting matches local time.
- Filters compose (project ∩ severity ∩ category ∩ mine ∩ search); snooze removes a row; empty state.
- Table sort indicators flip; row → overview sets the correct project (sidebar header + Overview hero
  show that project).
- Overview cards match reference pixel-for-pixel (spans 2/2/2/3; pulse dot; segmented bar colors;
  burndown endpoint dot color amber/green by drift).
- Sprints hero bars + burndown + velocity match; SprintRow progress text matches per-state.
- `npm run lint` + `npx tsc --noEmit` clean; `npx playwright test` green.

---

## PR breakdown

| PR | Title | Scope | Depends on |
|---|---|---|---|
| **A** | Home-mode shell + seed/triage libs | `ShellMode.tsx` + body-class toggle + home-mode CSS; `lib/projectMeta.ts`, `lib/triage.ts`, `lib/sprintsSeed.ts` (+ `Sprint`/`TriItem` types). Tests: `home-shell.spec.ts`. | — (**foundation; everything else depends on this**) |
| **B** | Home: hero + KPI band + triage queue | replace redirect; `HomeView`, `TriageHero`, `KpiBand`/`Kpi`, `TriageQueue`/`TriageFilters`/`TriRow`, empty state; `.tri-*` CSS (hero/kpi/section/filters/list). Tests: `home.spec.ts` (hero/kpi/queue parts). | A |
| **C** | Home: projects health table + sparklines | `ProjectsTable`, `BurndownMini`, `VelocityMini`; remaining `.tri-table`/`.tri-vel` CSS; row→overview nav. Tests: extend `home.spec.ts` (table/sort/state/nav). | B |
| **D** | Overview route + head + hero | `app/overview/page.tsx`, `OverviewView` skeleton, `OverviewHead`, `OverviewHero` (+stat cells/pulse); `.ov-hero`/`.ov-scroll`/`.page-head` CSS; sidebar `Overview` href. Tests: `overview.spec.ts` (head/hero). | A (shell) |
| **E** | Overview cards | `NeedsYouCard`, `SprintPulseCard`, `NowExecutingCard` (+provider chips/`PipeCard`), `WatchlistCard`, `RecentDecisionsCard`, `InputsCard`, `JumpToCard`; rest of `.ov-*` CSS; real pipelines/decisions wiring. Tests: extend `overview.spec.ts` (7 cards, nav). | D |
| **F** | Sprints screen | `app/sprints/page.tsx`, `SprintsView`, `SprintHero`, `SprintRow`, `Burndown`; `.sprint-*`/`.stack-bar`/`.burn-svg` CSS; sidebar `Sprints` href. Tests: `sprints.spec.ts`. | A |
| **G** | *(follow-up)* Sprints **real backend** | `Sprint` model + persistence; `GET/POST /sprints` endpoints; `api.sprints()`; swap seed → real in SprintsView + Overview SprintPulseCard; status-rollup derivation. Tests: `sprints-backend.spec.ts` + API unit tests. | F + backend |

**Parallelism:** A is the gate. After A, two tracks run in parallel — Home track **B→C** and Overview
track **D→E** — plus **F** (Sprints) independently. **G** is the deferred real-backend follow-up.

---

### 10-line summary
1. PR count: **6 parity PRs (A–F)** + **1 follow-up backend PR (G)** = 7 total.
2. PR A is the foundation: home-mode shell + seed/triage/sprints libs — **B, C, D, E, F all depend on it.**
3. Home-mode shell is **net-new machinery**: a `"use client"` `ShellMode` component toggles
   `document.body.classList("home-mode")` per `usePathname` (layout stays a server component) + new
   `body.home-mode` CSS that hides the sidebar and full-bleeds main (ref `mod_22` L23 / `inner.html` L506).
4. After A, Home (B→C) and Overview (D→E) run as **parallel tracks**; Sprints (F) is independent.
5. Most Home/Overview/Sprints data is **SEED** (triage feed, KPIs, sparklines, gates, provider mix,
   watchlist, meetings/feedback, all sprints) mirroring reference `SpadeData`.
6. **REAL** data is used where it fits: project list + glyph/color/slug, Overview running/queued
   pipelines + Now-executing pipes, recent decisions (brain nodes), backlog/active counts.
7. Project meta (`state/sprintCounter/brainNodes/…`) is SEEDed because our real `Project` type lacks
   those fields; unknown projects derive from live counts.
8. **Backend need (Sprints):** no `Sprint` type/endpoint exists — PR G adds the model +
   `GET/POST /sprints` and status-rollup derivation, swapping `sprintsSeed` → `api.sprints()` behind
   the same component contract.
9. Cross-cluster note: Overview/Home link to `/meetings`,`/feedback`,`/cli`,`/settings`,`/workspace`
   which are **other clusters' unbuilt screens** — wired as no-ops/`#` until those land.
10. Validation: 4 parity specs (`home`, `home-shell`, `overview`, `sprints`) + 1 follow-up
    (`sprints-backend`), plus `tsc`/`lint`/manual pixel checks against the reference.
