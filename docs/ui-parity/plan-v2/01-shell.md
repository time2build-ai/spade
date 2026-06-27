# Shell/nav — full-parity plan

> **Goal change:** FULL visual + data parity with `docs/Spade (standalone).html`.
> Where the real API has data, wire it; where it doesn't, **SEED** from a demo
> layer mirroring the reference `SpadeData` (`modules/mod_01.js`). Genuinely
> missing backend features get a follow-up PR + validation test. The earlier
> "no-fabrication / Próximamente" approach is **reversed** here.

Reference (decoded): `inner.html` (CSS + static shell), `modules/mod_22.js`
(App/nav + mode logic), `modules/mod_01.js` (`SpadeData` demo data).
Ours: `apps/client` — `components/shell/{Sidebar,Topbar,ProjectSwitcher}.tsx`,
`app/{layout,page,globals.css}.tsx`, `lib/{useShell,useProject,api,adapters}.ts`.

---

## Target (exact reference shell)

### Shell grid (`inner.html` :500-527)
- `.app` = `232px 1fr` cols / `44px 1fr` rows, `height:100vh; overflow:hidden`.
- `body.home-mode` (view `home`): single column, **`.sidebar{display:none}`**, `.main` spans `1/-1` (full-bleed dashboard).
- `body.workspace-level` (view `home` **or** `workspace`):
  - Sidebar swaps **proj-only** groups → **ws-only** groups (`:511-517`).
  - Topbar + sidebar get a lavender wash (`:519-527`).

### Topbar (`inner.html` :4552-4592)
| Slot | Markup | Notes |
|---|---|---|
| Brand | `.brand` = `.brand-mark` gradient chip + "Spade" | click → home; hover scales mark (`:3918`) |
| Project switcher | `.proj-switcher` glyph + `.proj-name` + chev + `.proj-menu` | placeholder ("Select a project") at workspace level |
| Command pill | `.topbar-pill` (`margin-left:4px`): search icon + "Ask the brain…" + `.kbd ⌘K` | |
| Right: sessions | `<span class="topbar-pill"><span class="pulse-dot"></span> daemon · 7 sessions</span>` | **REAL alive count** |
| Right: **sprint pill** | `<span class="topbar-pill mono">sprint 26 · day 2/10</span>` | hidden at workspace level (`mod_22.js` :56) |
| Right: account pill | `<span class="topbar-pill" title="Active Claude account">`green-dot`acct: rmurphy@acme · 62%` | **prefix + usage %** |
| Right: tweaks | `<button class="btn ghost" id="tweak-btn">` spark icon | borderless ghost (already done) |
| Right: avatar | `<span class="avatar">RM</span>` | |

### Sidebar (`inner.html` :4594-4711)
Header card: `sb-proj-head proj-only-h` (project glyph/name/slug) **or**
`sb-proj-head ws-only-h` (lavender wash; `i-graph` mark + "Workspace" / "all projects · global").

**Project-scoped** groups (each `.sb-section proj-only-h`), exact order + icon `<use>` id + badge:
- **Project**: Overview (`i-graph`) · Ask (`i-spark`, trailing `badge mono ⌘K` 9.5px)
- **Plan**: Sprints (`i-board`, `26`) · Backlog (`i-tasks`, `23`) · Product brain (`i-brain`, `847`) · Graph & Issues (`i-graph`, `7`)
- **Execution**: Orchestrator (`i-orch`, `live`, `7 live`) · Agent pool (`i-spark`, `10`) · Human gates (`i-gate`, amber `2`)
- **Inputs**: Meetings (`i-mic`, `42`) · Feedback (`i-flag`, `312`) · Decisions (`i-doc`, `94`)
- **System**: CLI / logs (`i-term`) · Settings (`i-cog`)

**Workspace-scoped** groups (`.sb-section ws-only-h`), shown at workspace level:
- **Workspace**: Settings (`i-cog`) · Agents pool (`i-spark`, `5`) · Integrations (`i-link`, `7`) · CLI / logs (`i-term`)
- **Projects**: All projects (`i-graph`, `4`)

Footer (`margin-top:auto`): "Local-first · v1.0.0" + mono "~/.spade · 84 MB".

> **Critical fix #1 — Product brain vs Graph & Issues are SEPARATE items.**
> Product brain (`/brain`, `i-brain`, 847) is the rich Explorer; Graph & Issues
> (`/graph-issues`, `i-graph`, 7) is its OWN route holding the node graph. Neither
> is a subtab of the other. Both already exist as distinct sidebar entries in the
> reference — we keep them as two distinct routes.

---

## Current state

- **Grid**: `globals.css` `.app` matches (`232px 1fr` / `44px 1fr`). **No `home-mode`, no `workspace-level`, no `proj-only`/`ws-only` rules, no lavender wash.** Sidebar always renders.
- **Home**: `app/page.tsx` `redirect("/backlog")` — there is **no home dashboard** and no full-bleed mode.
- **Topbar** (`Topbar.tsx`): brand, switcher, command pill, sessions pill (real alive count — correct), account pill shows `acct: {label}` **without `· NN%`**, ghost tweaks button (done), avatar. **No sprint pill** (explicitly omitted with a no-fabrication comment to delete).
- **Sidebar** (`Sidebar.tsx`): single static `GROUPS` array (Project/Plan/Execution/Inputs/System). `"#"` items render as dimmed `.sb-item.soon` "Próximamente". Counts come from `useShellData` and are `undefined` (no badge) for most. **No Workspace/Projects ws-only groups.** Icons partially off vs reference (Overview `graph` ✓, Ask `spark` ✓, Sprints `board` ✓, Agent pool `spark` ✓, Feedback `flag` ✓ — these already match the e2e in `shell-nav.spec.ts`).
- **No demo/seed layer exists** in `apps/client` (grep: zero `demo`/`seed`/`SpadeData`).
- **Backend daemon count is REAL and correct**: `server.py:389` emits `"alive": ctrl.session.is_alive()`; `_reconcile_sessions` (`:754`) prunes dead tmux panes; client already does `sessions.filter(s => s.alive).length`. **No fix needed — just verify in a test.**

---

## Build steps (components, reference CSS to port, routing)

### A. Demo/seed layer (foundation for SEED values)
1. New `lib/demo.ts` — port the slices of `SpadeData` the shell needs, typed to our `lib/types.ts`. Minimum for this cluster:
   - `DEMO_SPRINT = { num: 26, dayLabel: "day 2/10", counter: "sprint 26 · day 2/10" }` (from `sprints[0]`).
   - `DEMO_ACCOUNT_USAGE` keyed by email → `used` % (from `accounts`: `rmurphy@acme.com → 62`).
   - `DEMO_SIDEBAR_COUNTS = { sprints:26, backlog:23, brain:847, graphIssues:7, orchestrator:"7 live", agentPool:10, gates:2, meetings:42, feedback:312, decisions:94 }` (the reference's literal badges).
   - `DEMO_WS_COUNTS = { agentsPool:5, integrations:7, projects:4 }`.
   - `DEMO_PROJECTS` (id/name/slug/color/glyph/sprintCounter) from `projects` for the switcher menu + "all projects · global".
2. **Sourcing rule**: a count is REAL when the API returns a value for the current project, else fall back to the SEED. Implement as `count ?? DEMO_SIDEBAR_COUNTS[key]` in `useShellData`. (This means real projects with data show real numbers; the demo `acme` project shows the reference numbers.)

### B. Shell modes (`home-mode` / `workspace-level`)
3. Add a `lib/useShellMode.ts` (or extend `useShell.ts`): derive `mode` from the route — `home` for `/` (or `/home`), `workspace` for `/workspace/*`, else `project`. Mirrors `mod_22.js` `isFullBleed`/`isWorkspaceLevel`.
4. In `app/layout.tsx`, set `body` classes from the mode (client component or a small `BodyModeClass` effect): `home-mode` when `home`, `workspace-level` when `home || workspace`.
5. Port CSS verbatim from `inner.html` :506-527 into `globals.css`:
   - `body.home-mode .app{grid-template-columns:1fr} .sidebar{display:none} .main{grid-column:1/-1}`
   - `body.workspace-level:not(.home-mode) .sidebar .ws-only{display:flex}` (+ the 5 sibling rules `:511-517`)
   - lavender wash `:519-527` for `.topbar` and `.sidebar`.
6. Build a **home dashboard route** (`app/page.tsx` → real home view, or `app/home/`). Scope note: the home dashboard *content* belongs to another cluster; THIS cluster only needs the route to exist so `home-mode` is reachable and the sidebar hides. Coordinate: ship a minimal placeholder `<main>` if the home cluster isn't merged yet, gated so the shell test can assert sidebar-hidden.

### C. Sidebar — proj-only + ws-only groups
7. Refactor `Sidebar.tsx`: keep `PROJECT_GROUPS` (rename current `GROUPS`) and add `WORKSPACE_GROUPS`. Render BOTH; let CSS `proj-only`/`ws-only` visibility classes (from step 5) show the right set. Add `proj-only-h`/`ws-only-h` on section + header wrappers exactly as `inner.html`.
8. Wire routes (Critical fix #1):
   - Overview `/overview` · Ask `/ask` (or open Ask dock) · Sprints `/sprints` · Backlog `/backlog` · **Product brain `/brain`** · **Graph & Issues `/graph-issues`** · Orchestrator `/orchestrator` · Agent pool `/agent-pool` · Human gates `/gate` · Meetings `/meetings` · Feedback `/feedback` · Decisions `/decisions` · CLI `/cli` · Settings `/settings`.
   - ws-only: Settings `/workspace/settings` · Agents pool `/workspace/agents` · Integrations `/workspace/integrations` · CLI `/workspace/cli` · All projects `/` (home).
   - For routes not yet built by other clusters, link them anyway (no more `soon`/"Próximamente"); a 404/placeholder is acceptable until that cluster lands. **Remove the `.sb-item.soon` + "Próximamente" branch entirely** — the reference has no such state.
9. **Badges always render** from `count ?? SEED` (step A2). Ask item gets the trailing `<span class="badge mono">⌘K</span>` at `font-size:9.5px`. Orchestrator badge text is `${n} live` with `.sb-item.live`. Human gates badge uses the amber inline style.
10. ws header card: lavender `sb-proj-head ws-only-h` with `i-graph` mark + "Workspace" / "all projects · global". (Current `Sidebar` already has a `ws` variant driven by *no project*; replace that data-driven logic with the CSS-mode logic.)

### D. Topbar — sprint + account-usage pills
11. **Sprint pill**: add `<span className="topbar-pill mono">{sprintCounter}</span>` after the sessions pill. Source = real project `sprintCounter` if the API ever exposes it, else `DEMO_SPRINT.counter`. Hide it at workspace level (mode-driven, mirroring `mod_22.js` :56). Delete the no-fabrication comment block.
12. **Account pill usage**: render `acct: {label} · {usage}%`. `usage` = real account usage if the API exposes it (it does NOT today — see BACKEND-FEATURE), else `DEMO_ACCOUNT_USAGE[account.email] ?? 62`. Keep the green dot.
13. **Project switcher menu**: the dropdown rows should show `${slug} · ${sprintCounter}` sub-line (reference `mod_22.js` :4767) and "All projects" should NAVIGATE home (currently `disabled`/"Próximamente"). Source slug/sprintCounter from `DEMO_PROJECTS` until the API returns them.
14. Keep the sessions pill exactly as-is (real alive count).

---

## Data sourcing (per item)

| Shell item | Source |
|---|---|
| daemon · N sessions | **REAL** `api:sessions[].alive` (count of `alive===true`). Backend verified correct (`server.py:389`, `_reconcile_sessions`). |
| Sidebar Backlog count | **REAL** `api:tasks.length` ?? **SEED** `23` |
| Sidebar Product brain count | **REAL** `api:brain.nodes.length` ?? **SEED** `847` |
| Sidebar Decisions count | **REAL** `api:brain nodes type=decision` ?? **SEED** `94` |
| Sidebar Orchestrator badge | **REAL** running `api:pipelines` count + " live" ?? **SEED** `7 live` |
| Sidebar Agent pool count | **REAL** `api:sessions.length` ?? **SEED** `10` |
| Sidebar Human gates count | **REAL** `api:brakes.length` ?? **SEED** `2` (amber) |
| Sidebar Sprints `26` | **SEED** `26` (`DEMO_SPRINT.num`) — no sprints API |
| Sidebar Graph & Issues `7` | **SEED** `7` — no issues API |
| Sidebar Meetings `42` | **SEED** `42` — no meetings API |
| Sidebar Feedback `312` | **SEED** `312` — no feedback API |
| Ask `⌘K` badge | **SEED** static `⌘K` |
| ws Agents pool `5` / Integrations `7` / Projects `4` | **SEED** `5` / `7` / `4` |
| Topbar sprint pill `sprint 26 · day 2/10` | **SEED** `DEMO_SPRINT.counter` (BACKEND-FEATURE: real sprint API) |
| Topbar account label `rmurphy@acme` | **REAL** `api:accounts[].label` (default account) ?? **SEED** `rmurphy@acme` |
| Topbar account usage `· 62%` | **SEED** `DEMO_ACCOUNT_USAGE[email]` (BACKEND-FEATURE: real usage %) |
| Project switcher rows slug/sprint sub-line | **SEED** `DEMO_PROJECTS` (BACKEND-FEATURE: project slug + sprintCounter fields) |

**BACKEND-FEATURE follow-ups (need a planned PR + validation test):**
- **Sprints/sprint-counter API** (`GET /projects/{id}/sprint` → current sprint num, day x/y). Feeds the sprint pill + Sprints badge.
- **Account usage %** (`used` field on `GET /accounts`, 0-100 of the rate window). Feeds the account pill suffix + ws Agents pool.
- **Project slug + sprintCounter fields** on `GET /projects` for the switcher sub-line.
- (Lower priority for this cluster) issues/meetings/feedback counts — owned by their feature clusters; here they stay SEED.

---

## Validation

### Playwright (extend `e2e/shell-nav.spec.ts`, `e2e/shell-topbar.spec.ts`)
**Reverse the no-fabrication assertions** (the current "no sprint pill" / absent-usage tests must be deleted/inverted).

Sidebar:
- `.sb-label` order in project mode = `["Project","Plan","Execution","Inputs","System"]`.
- Each project item shows its reference badge text: Sprints `26`, Backlog `23`/real, Product brain `847`/real, Graph & Issues `7`, Orchestrator `7 live`, Agent pool `10`, Human gates `2`, Meetings `42`, Feedback `312`, Decisions `94`.
- **Product brain and Graph & Issues are two distinct items** with hrefs `/brain` and `/graph-issues` respectively (assert both `.sb-item` exist and links differ).
- Ask item has a trailing `.badge.mono` with text `⌘K`.
- **No `.sb-item.soon` / "Próximamente"** anywhere (`toHaveCount(0)`).
- At `/workspace/...` (or home), `.sb-label` set = `["Workspace","Projects"]`; ws badges Agents pool `5`, Integrations `7`, All projects `4`.
- On `/` (home), `body.home-mode` present and `aside.sidebar` is `display:none` (sidebar hidden).

Topbar:
- Sprint pill `sprint 26 · day 2/10` visible in project mode; `toHaveCount(0)` at workspace level.
- Account pill matches `/acct: .+ · \d+%/` (e.g. `acct: rmurphy@acme · 62%`).
- daemon pill: route `/api/sessions` with a mix of `alive:true`/`alive:false` → pill shows the **alive** count only (regression guard for the dead-session concern).
- Tweaks button keeps `btn ghost`, no `icon-btn` (existing).

### Manual checklist
- [ ] Visual diff against `Spade (standalone).html` at 1440px: topbar pill row + sidebar groups pixel-match.
- [ ] Brand click → home; sidebar disappears (full-bleed).
- [ ] Enter a project → sidebar reappears with proj groups; sprint pill shows.
- [ ] Switch to workspace settings → lavender wash on topbar+sidebar; ws groups; sprint pill hidden.
- [ ] Account pill reads `acct: rmurphy@acme · 62%` for the demo account.
- [ ] Real project with live sessions shows real daemon count (not seeded).

---

## PR breakdown (ordered)

**PR-1 — shell modes + demo seed layer** (Blocker)
`feat(client): home-mode/workspace-level shell modes + demo seed layer`
- `lib/demo.ts` (SEED data), `lib/useShellMode.ts`, body-class wiring in `layout.tsx`.
- Port `home-mode`/`workspace-level`/`proj-only`/`ws-only`/lavender-wash CSS (`globals.css`).
- Minimal home route so the sidebar can hide. Tests: home hides sidebar; workspace tint + mode classes.

**PR-2 — sidebar full parity (proj + ws groups, real⌖seed badges, brain/graph split)** (Blocker)
`feat(client): full-parity sidebar nav with workspace groups and seeded badges`
- Add `WORKSPACE_GROUPS`, `proj-only`/`ws-only` markup, remove `soon`/"Próximamente".
- Route Product brain `/brain` and Graph & Issues `/graph-issues` as separate items; Ask `⌘K` badge.
- `useShellData` `count ?? SEED`. Tests: badge text, group order both modes, brain≠graph routes, no-soon.

**PR-3 — topbar pills (sprint + account usage) + switcher sub-line** (Major)
`feat(client): topbar sprint pill, account usage %, project switcher sprint sub-line`
- Sprint pill (mode-hidden), account `· NN%`, switcher rows `slug · sprintCounter`, "All projects" navigates home.
- Delete reversed no-fabrication tests; add sprint-pill + usage-% + alive-count tests.

**PR-4 (follow-up) — backend feature surfaces** (separate, after FE seeds land)
`feat(api): sprint counter, account usage %, project slug/sprintCounter fields`
- `GET /projects/{id}/sprint`, `used` on `/accounts`, slug/sprintCounter on `/projects`.
- FE swaps `?? SEED` to prefer the now-real fields. Validation: pills show live values, fall back to SEED when null.
