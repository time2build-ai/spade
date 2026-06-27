# Home + Overview parity

**Status: both screens are 100% NOT IMPLEMENTED in our app.** `app/page.tsx` is a 5-line file that `redirect("/backlog")`. There is no `/overview` route, no triage feed, no KPI band, no project health table, no home/overview components, and no related CSS classes (`tri-*`, `ov-*`) anywhere in the repo. This is the largest gap of any cluster — two full-bleed dashboard screens to build from scratch.

The good news: the design tokens (`--bg #0b0b0d`, `--text/-2/-3/-4`, `--accent #c9b8ff`, `--accent-2 #8e7dff`, `--green --amber --red --blue`) already exist verbatim in `app/globals.css`, and a data/adapter layer exists (`lib/api.ts` with `api.projects/pipelines/tasks/decisions`, `lib/adapters.ts` with `projectGlyph`/`projectColor`). So the scaffolding for parity is present; the screens themselves are missing.

---

## Reference: what it renders

### HOME — `modules/mod_04.js` (`HomeView`)
A cross-project triage feed, full-bleed (`tri-wrap`, scrolls vertically). Top-down layout:

1. **Warm hero** (`tri-hero`)
   - Left: mono eyebrow `MONDAY · MON, JUN 27 · 3:14 PM` (live day/date/time, uppercased), serif title `Good morning, Robert.` (time-based greeting), sub line: `**14 pipelines** running across **4 projects**. {N} items need your eyes. · {N} P0 · $142.30 spent of $600 cap`. The "N items" colors amber when >0; "N P0" is red; spend is muted.
   - Right: two ghost buttons — `[graph] Workspace`, `[spark] Ask follow-up`.

2. **KPI band** (`tri-kpis`) — 6 `Kpi` cards, each = mono uppercase label + big value + optional muted mono sub + optional progress bar:
   - `PIPELINES RUNNING` 14 (accent variant)
   - `WAITING HUMAN` {count of gate items}, `hot` when >5, sub `oldest {N}m` when oldest wait >30m
   - `P0 OPEN` {count}, hot when >0
   - `SPEND TODAY` `$142.30`, sub `of $600 cap`, with a fill bar (spend/cap)
   - `AGENTS ACTIVE` `18/24`, sub `across 4 accts`
   - `SHIPPED TODAY` `7`, sub `3 auto · 4 reviewed`

3. **Triage queue** (`tri-section`)
   - Header: `Triage queue`, muted mono `{filtered} of {total}`, spacer, search box (`[search] Search items`).
   - **Filters** (`tri-filters`), four groups of toggle chips:
     - `PROJECT` — one chip per project, each with a colored glyph square + name.
     - `SEVERITY` — `P0` / `P1` / `P2` chips (severity-colored).
     - `CATEGORY` — Gates / Blockers / Feedback / Sprint drift / Agents / Spend / Decisions.
     - `[flag] Mine only` toggle + conditional `Clear all` (appears when any filter active).
   - **Item list** (`tri-list`) of `TriRow`s. Each row: severity badge (`P0/P1/P2`) · category pill (colored dot + label) · body (mono id + title, then meta: detail · `[clock] waiting 38m` (amber if >30m) · assignee) · project chip (glyph + name) · actions (`[primary] quick-action` e.g. Review/Resolve/Approve/Revert, `[ghost] Open`, snooze icon-btn).
   - **Empty state**: `[check] Nothing matches these filters.` (muted, centered).
   - Feed is ~13 synthetic items across acme/mobile/tools projects (gates, blockers, crash P0, sprint drift, hot feedback, agent token-cap, spend anomaly, stale ADR). Sorted P0>P1>P2, then longest wait, then category rank.

4. **Projects health table** (`ProjectsTable`, `tri-section`)
   - Header: `Projects`, `{filtered} of {total}`, state toggle `Active / Paused / All`, search box (`Search projects`), `[plus] New project` button.
   - Sortable table, columns: `STATUS` (colored status dot: hot/warn/ok/paused) · `PROJECT` (glyph + name + mono slug) · `NEEDS YOU` (count, amber if >3) · `GATES` (amber if >2) · `SPRINT` (mono sprintCounter) · `DRIFT` (`+N` pts, amber if >1) · `VELOCITY` (mini sparkline bars + `↑/↓/→N` trend) · `TOP ISSUE` (sev badge + title) · arrow. Clicking a row sets project and navigates to overview. Sortable headers show `↑/↓`. Empty: `No projects match these filters.`

Sub-components: `Kpi`, `TriRow`, `BurndownMini` (SVG ideal-dashed + actual line + endpoint dot, amber/green by drift), `VelocityMini` (SVG bars, last bar accent).

### OVERVIEW — `modules/mod_03.js` (`OverviewView`)
Per-project dashboard. Fixed `page-head` + scrolling body (`ov-scroll`).

1. **Page head** — breadcrumb: project glyph chip + `**Overview** · {slug}`. Right: `[term] CLI`, `[cog] Project settings`, `[primary] [orch] Orchestrator`.

2. **Hero band** (`ov-hero`)
   - Left: mono eyebrow `PROJECT · {SLUG}`, serif title `{proj.name}`, `{proj.desc}`, tag chips: `● {state}` (green), `{sprintCounter}`, `main · clean`, `{brainNodes} brain nodes`.
   - Right: 6 stat cells — `running` (with pulse dot), `queued`, `gates` (amber, warn), `agents`, `autoflows`, `$4.18 spend today`.

3. **Grid** (`ov-grid`), cards with span classes:
   - **Needs you** (`span-2`, amber gate icon, count badge, `Open gates →`): list of 3 synthetic gate items (`ov-need`), each = kind pill (merge/conflict/spend) + title + meta (who · reason) + aside (`waiting 8m`, `Review` / `Open task` buttons). Severity-classed (high/med/low).
   - **Sprint {num}** (board icon, `Board →`): sprint label, mono dates · day, segmented stacked bar (shipped green / review accent / progress blue / ready bg-3 / blocked red), legend with swatches, burndown mini-SVG (`BURNDOWN · 4 ahead of ideal`).
   - **Now executing** (`span-2`, live pulse icon, `{N} live` badge, provider mix chips `Claude 5 / Codex 2 / Gemini 1` with colored dots, `All →`): grid of up to 6 `ov-pipe` cards — mono task id + optional `P0` + mono eta, title, progress bar, footer (feature + `{progress}%`).
   - **Watchlist** (red bolt icon): 4 `ov-watch-row`s — icon (warn ⚠ / hot ● / ok ●) + title + muted sub (token window, feedback cluster, Stripe token expiry, brain coverage).
   - **Recent decisions** (doc icon, `All ADRs →`): 3 `ov-dec` buttons — mono id + status pill + title + mono owner · date.
   - **Inputs** (mic icon): two sub-columns — `MEETINGS` (3 rows: title + mono `duration · {t}t/{d}d/{q}q`), `HOT FEEDBACK` (neg clusters: label + `count signals · trend · linkedTask`).
   - **Jump to** (`span-3`): 6 `ov-jump-card`s — icon + title + sub: Backlog, Product brain, Active tasks, Feedback, Meetings, CLI / logs.

---

## Ours: what it renders

| Screen | Status | Evidence |
|---|---|---|
| Home | **NOT IMPLEMENTED** | `app/page.tsx` = `redirect("/backlog")`. No triage/KPI/projects-table code; grep for `triage`/`HomeView`/`tri-hero`/`tri-kpi`/`ov-hero` returns zero hits across `app/` and `components/`. |
| Overview | **NOT IMPLEMENTED** | No `app/overview/` route; no `ov-*` components or CSS. Project-switching exists (`components/shell/ProjectSwitcher.tsx`, `lib/useProject.ts`) but there is no per-project landing screen. |

Reusable building blocks already present: `app/globals.css` tokens (exact match), `lib/api.ts` (`projects`, `pipelines`, `tasks`, `decisions`, …), `lib/adapters.ts` (`projectGlyph`, `projectColor`), `components/ui/*` (`Btn`, `Chip`, `Card`, `TogglePill`, `Priority`, `PageHead`, `Icon`), and `components/shell/PageHead`-style head used by other pages.

---

## Diff table

| Aspect | Reference | Ours | Severity |
|---|---|---|---|
| Home route (`/`) | Full triage dashboard | Redirects to `/backlog` | **Blocker** |
| Home: warm hero (greeting/date/sub stats) | Present | Missing | Major |
| Home: 6-card KPI band | Present | Missing | Major |
| Home: triage queue + filters + rows + empty state | Present | Missing | **Blocker** |
| Home: projects health table (sortable, sparklines) | Present | Missing | **Blocker** |
| Home: BurndownMini / VelocityMini SVG charts | Present | Missing | Major |
| Overview route (`/overview`) | Per-project dashboard | No route at all | **Blocker** |
| Overview: page head (CLI/Settings/Orchestrator) | Present | Missing | Minor |
| Overview: hero band + 6 stat cells | Present | Missing | Major |
| Overview: Needs-you / Sprint / Now-executing / Watchlist / Decisions / Inputs / Jump-to cards | Present (7 cards) | Missing | **Blocker** |
| Overview: provider mix chips + pipe cards | Present | Missing | Major |
| Design tokens / fonts | Defined | **Already match** | None |
| Data layer | `window.SpadeData` synthetic | `lib/api.ts` real-ish; triage feed is synthetic & must be derived | Major (logic to build) |

---

## Concrete parity changes

Build from scratch. Component breakdown (mirror reference class names so CSS can be ported 1:1 from `inner.html`/`mod_01`):

**Home (`app/page.tsx` — replace the redirect, render `<HomeView/>`):**
- `components/home/HomeView.tsx` — orchestrates feed + filter state (projFilter/sevFilter/catFilter/mineOnly/search/snoozed Sets).
- `components/home/TriageHero.tsx` — eyebrow (live `dayName/dateString/now`), serif greeting, stats sub-line.
- `components/home/KpiBand.tsx` + `Kpi.tsx` — 6 cards, `accent`/`hot`/`bar`/`sub` variants.
- `components/home/TriageQueue.tsx` — header + search; `TriageFilters.tsx` (4 chip groups, Clear all); `TriRow.tsx` (sev badge, cat pill, body, project chip, actions, snooze); empty state.
- `components/home/ProjectsTable.tsx` — sortable table, state toggle, search, New project; row click → set project + go to overview.
- `components/home/charts/{BurndownMini,VelocityMini}.tsx` — port the two SVGs verbatim.
- `lib/triage.ts` — port `buildTriageFeed`, `mockBurndownFor`, `mockVelocityFor`, `fmtWait`, sort logic (adapt to our `Project`/`Task`/`Pipeline` types from `lib/api.ts`).
- Port `tri-*` CSS into `app/globals.css` from reference `inner.html`.

**Overview (new `app/overview/page.tsx` → `<OverviewView/>`):**
- `components/overview/OverviewView.tsx` (uses `useProject()`), `OverviewHead.tsx`, `OverviewHero.tsx` (+ stat cells with pulse).
- Cards: `NeedsYouCard`, `SprintPulseCard` (segmented bar + burndown SVG), `NowExecutingCard` (provider chips + `PipeCard`), `WatchlistCard`, `RecentDecisionsCard`, `InputsCard`, `JumpToCard`.
- Wire sidebar/topbar nav so selecting a project lands on `/overview`; wire `ProjectsTable` rows + `Home` to navigate here.
- Port `ov-*` CSS into `app/globals.css`.

Reuse existing `components/ui/{Btn,Chip,Card,Icon,TogglePill}` and `lib/adapters.projectGlyph/projectColor` instead of re-implementing.

---

## Suggested PR grouping

1. **PR A — Home shell + hero + KPI band**: replace redirect, add `HomeView` skeleton, `TriageHero`, `KpiBand`, port hero/KPI CSS, `lib/triage.ts` feed builder. (e2e: greeting renders, 6 KPI cards, counts derive from feed.)
2. **PR B — Triage queue**: filters, `TriRow`, search, snooze, empty state. (e2e: filter by project/sev/category, Mine-only, Clear all, empty message.)
3. **PR C — Projects health table**: sortable table, state toggle, sparklines, row→overview nav. (e2e: sort, state filter, row click navigates.)
4. **PR D — Overview route + head + hero**: `/overview` page, head buttons, hero band + stat cells. (e2e: route renders for selected project, stat counts.)
5. **PR E — Overview cards**: Needs-you, Sprint, Now-executing (+provider chips/pipes), Watchlist, Decisions, Inputs, Jump-to. (e2e: each card renders, jump links navigate.)

(PRs B/C depend on A; E depends on D. A–C and D–E are two parallel tracks.)
