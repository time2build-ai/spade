# Spade UI Parity — PR Plan

Derived from [`REPORT.md`](./REPORT.md). Goal: ship our client to **visual parity** with `Spade (standalone).html`, in reviewable PRs.

**Every PR below carries two test artifacts:**
- 🤖 **Automated e2e** — a Playwright spec *I* write and run against the dev server; parity is "verified" only when it's green.
- 🧑 **Manual e2e** — a short numbered checklist *you* run in a browser to eyeball it against the reference.

**Conventions**
- Branch per PR off `development`: `feat/ui-<slug>` (e.g. `feat/ui-shell-foundation`).
- Reference for visual truth: open `docs/Spade (standalone).html` in a browser side-by-side.
- Playwright specs live in `apps/client/e2e/<screen>.spec.ts`; run with `npm run e2e` (added in PR-00).
- **No-fabrication policy (decided):** match the reference's **layout, structure, and styling**, but render **only real API data**. Where the API has no field (e.g. `Account` has no usage %, there is no Sprint type), **omit** that element or show an honest empty/placeholder state — do **not** invent demo values or add a demo-seed module. Parity stays partial on data-rich screens until the backend grows those fields; that is accepted. Each PR's automated e2e asserts **layout + empty/omitted states**, not fabricated content (mocking a real-shaped API response is fine, as in PR-02). This supersedes any "seeded fixtures" phrasing elsewhere in this plan.
- Sequencing: **Phase 0 → Phase 1 must land first** (foundation). Phases 2 and 3 can then run largely in parallel; intra-phase dependencies are noted.

---

## Phase 0 — Test harness

### PR-00 · Add Playwright e2e harness
**Why first:** every later PR's automated test depends on it.
**Scope:** add `@playwright/test`; `playwright.config.ts` (baseURL `http://localhost:3000`, `webServer` auto-starting `next dev`, chromium project, trace-on-first-retry); `apps/client/e2e/` dir; `npm run e2e` + `npm run e2e:ui` scripts; a `nav.ts` helper (sidebar locators) and a `seed` fixture hook; CI note in README.
**Files:** `package.json`, `playwright.config.ts`, `e2e/_helpers.ts`, `e2e/smoke.spec.ts`, `.gitignore` (playwright-report, test-results).
- 🤖 **Automated:** `smoke.spec.ts` — app boots at `/`, `<body>` renders, sidebar present, no console errors on load.
- 🧑 **Manual:** `cd apps/client && npm install && npx playwright install chromium && npm run e2e` → expect 1 passing test and a green report (`npx playwright show-report`).

---

## Phase 1 — Shell foundation  *(blocks most of Phase 2 & 3)*

### PR-01 · Sidebar nav: full item set + groups + icons
**Scope (from [§01](./sections/01-shell.md)):** add the **Workspace** group (Workspace, Accounts, Integrations, CLI, Home) and **Projects** group ("All projects"); correct the 5 wrong icon `<use>` ids (Overview, Ask, Sprints, Agent pool, Feedback); add the Ask `⌘K` badge; keep the dimmed "coming soon" state for not-yet-built routes so nav is complete without dead links.
**Files:** `components/shell/Sidebar.tsx`, `components/Icon.tsx`, `lib/useShell.ts`.
- 🤖 **Automated:** `shell-nav.spec.ts` — assert the exact ordered list of sidebar labels matches the reference set; project-scoped vs workspace items render in correct groups; Ask row shows a `⌘K` badge; clicking a "coming soon" item does not navigate.
- 🧑 **Manual:** open app next to reference; compare sidebar top-to-bottom — same items, same order, same grouping/dividers, same icons; hover states match.

### PR-02 · Topbar parity (sprint pill, account pill, ghost actions)
**Scope:** add sprint pill (`sprint 26 · day 2/10`, mono, hidden at workspace level); account pill regains `acct:` prefix + ` · 62%` usage suffix; "tweaks" button becomes borderless `.btn.ghost` not bordered `IconBtn`.
**Files:** `components/shell/Topbar.tsx`, `components/ui/Btn.tsx`/`IconBtn.tsx`.
- 🤖 **Automated:** `shell-topbar.spec.ts` — sprint pill visible on a project screen, hidden on Home/Workspace; account pill text matches `acct:… · NN%`; tweaks button has no border.
- 🧑 **Manual:** check topbar on a project screen vs reference (pills present), then on Home (sprint pill gone).

### PR-03 · Shell modes: `home-mode` full-bleed + `workspace-level` — ⚠️ FOLDED INTO PR-18 / PR-25
**Revised finding (decoding the reference CSS):** the rule is `.workspace-level:not(.home-mode) .sidebar .ws-only`. In the reference, both the `home` and `workspace` views set **both** `home-mode` *and* `workspace-level` (`mod_22.js` :22-26). Because `home-mode` hides the sidebar, the `:not(.home-mode)` ws-only nav swap **never triggers** — so the **Workspace/Projects sidebar groups are never actually visible**. Home and Workspace are simply **full-bleed screens with the sidebar hidden** + a lavender topbar tint + a "Select a project" switcher placeholder.
**Consequence:** there is nothing to apply `home-mode` to until a full-bleed route exists (`/` Home = PR-18; `/workspace` = PR-25), and the never-visible nav groups should **not** be added. The mode mechanism (`ShellModeProvider`: route → `home-mode`/`workspace-level` body classes + the `app/globals.css` rules + switcher placeholder) is therefore **built inside PR-18 (Home)** and reused by **PR-25 (Workspace)** — not as a standalone PR. The standalone `shell-modes.spec.ts` is replaced by assertions inside `home.spec.ts` / `workspace.spec.ts` (sidebar hidden, full-bleed, lavender tint, switcher placeholder).
**Net:** PR-03 is **closed as folded**; Phase 1 (foundation) = PR-00…PR-02 (done). The shell-mode CSS/mechanism ships with Home.

---

## Phase 2 — Restyle existing screens to match

### PR-04 · Brain: color fix + node glyphs + shared typeMeta *(quick win — DONE)*
**Scope (from [§03](./sections/03-brain-graphissues.md)):** fix the **swapped feedback/metric colors**; introduce a shared `NODE_TYPE_META` (color + F/D/C/U/B/M glyph + label) in `lib/adapters.ts`; render the glyph inside each node's dot and in the legend swatches.
**Deferred to PR-05:** changing node shape pill→**circle** and edges bezier→**straight with relation labels** — those are part of the Explorer rebuild and would otherwise be rewritten twice / risk regressing the current focus-highlight logic.
**Files:** `lib/adapters.ts` (`NODE_TYPE_META`, `nodeColor`, `nodeGlyph`), `components/brain/GraphCanvas.tsx`, `components/brain/BrainLegend.tsx`, `lib/__tests__/brainAdapters.test.ts` (corrected to reference colors).
- 🤖 **Automated:** `brain-style.spec.ts` — legend + node glyphs (F/D/C/U/B/M); feedback=teal `rgb(122,220,199)`, metric=blue `rgb(122,182,230)` (computed); regression guard for the swap. **8 green** (mocks the brain API).
- 🧑 **Manual:** open Brain; confirm node colors/glyphs and edge labels match the reference legend.

### PR-05 · Brain: rebuild as 3-column Explorer *(large; DONE)*
**Scope:** restructured Brain into the reference **detail-first Explorer** — Explorer/Graph **subtabs**, namespace **feature tree** (left, with per-feature D/B/U counts + a type Index), **record detail** (center: type-glyph header + id + title + keys grid + Description), and a **relations map** (right: `.bx-anchor` radial diagram + neighbor groups, clickable). The graph canvas is preserved behind the **Graph** subtab (keeps PR-04's glyph/color work).
**No-fabrication trims:** the reference's invented content is **omitted** — owner / confidence / coverage / source rows, the summary prose, the code-surface file list, the activity feed, and the MCP-server block (all need backend data we don't have). The keys grid shows the 3 honest fields (Type / Created / Edges); Description renders `node.detail` or an empty state. Brain-search input + Find-gaps / Export-to-MCP buttons deferred (search needs the Ask wiring; the buttons need real actions).
**Files:** `components/brain/BrainExplorer.tsx` (new), `app/brain/page.tsx`, `app/globals.css` (bx-* scoped under `.brain-explorer` to avoid colliding with NodeInfo), `e2e/brain-explorer.spec.ts`, `e2e/brain-style.spec.ts` (switches to Graph subtab).
- 🤖 **Automated:** `brain-explorer.spec.ts` — 3 columns; default-first-feature record; tree selection; relations navigation; anchor glyph; Explorer↔Graph switch. **6 green** (mocks the brain API). Full suite: e2e 34✓ / vitest 140✓.
- 🧑 **Manual:** open Brain → Explorer; click features in the left tree and neighbors in the right map; confirm the center record + anchor update; toggle the Graph subtab.

### PR-06 · Backlog parity
**Scope (from [§04](./sections/04-backlog-task-sprints.md)):** 4 columns (Ready / In progress / Review / Done) with **blocked routed to an amber banner** (not a 5th column); add head actions (Filter, Suggest priority, Run sprint); align card anatomy (priority dot, feature tag, status, assignee).
**Files:** `app/backlog/page.tsx`, `components/backlog/Board.tsx`, `components/backlog/TaskCard.tsx`.
- 🤖 **Automated:** `backlog.spec.ts` — exactly 4 columns with reference labels/colors/order; an amber blocked banner appears when a blocked task exists; head action buttons present; card shows priority+feature+assignee.
- 🧑 **Manual:** compare board columns and a card vs reference; confirm blocked banner styling.

### PR-07 · Task detail: evidence + rail + head actions
**Scope:** add the `.feedback-strip` 4-stat tiles, `.quote-card` verbatim quotes, `.lr-meta` right column, tracked-metric + sparkline card, "Will write back" prose, head actions; rail meta rows (Assignee/Sprint/Estimate/Branch).
**Files:** `app/task/[id]/page.tsx`, `components/task/*` (+ new `FeedbackStrip.tsx`, `QuoteCard.tsx`, `Sparkline.tsx`).
- 🤖 **Automated:** `task-detail.spec.ts` — feedback strip renders 4 stat tiles; ≥1 quote card; right rail shows Assignee/Sprint/Estimate/Branch; sparkline svg present.
- 🧑 **Manual:** open task SPD-142; compare evidence block, rail, and head actions vs reference.

### PR-08 · Orchestrator: table rewrite + expanding detail + live log *(large)*
**Scope (from [§05](./sections/05-orchestrator.md)):** replace card-list + side terminal with the reference **full-width sortable table** (priority dot / title / cost / ETA), **inline-expanding detail** (progress bar, Context + Files-touched cards, animated streaming Live-log terminal with colored `lvl-*` lines + blinking cursor), and a **6-cell KPI strip with sub-lines**. Reuse the already-matching `orch-d-stage` and `stages-mini` markup.
**Files:** `app/orchestrator/page.tsx`, `components/orchestrator/*` (+ new `PipelineTable.tsx`, `LiveLog.tsx`, expand KPI strip).
- 🤖 **Automated:** `orchestrator.spec.ts` — KPI strip has 6 cells with sub-lines; table rows sortable; clicking a row expands inline detail with progress bar + live-log lines; log lines carry `lvl-*` color classes.
- 🧑 **Manual:** sort the table; expand a pipeline; watch the live log animate; compare to reference.

### PR-09 · Active Tasks view *(depends on PR-08 components)*
**Scope:** add `/active` route (ActiveCard, progress-rail/shimmer) for live pipelines.
**Files:** `app/active/page.tsx`, `components/orchestrator/ActiveCard.tsx`.
- 🤖 **Automated:** `active-tasks.spec.ts` — route renders only non-shipped pipelines; each card shows an animated progress rail.
- 🧑 **Manual:** open Active Tasks; confirm only live work shows with progress rails.

### PR-10 · Agent Pool: account-centric grid + executions table
**Scope (from [§06](./sections/06-agentpool-accounts.md)):** rebuild pool as **account-centric** (provider glyph avatars, role pills, usage meters, current-issue bodies) + add the **"Executions in progress"** filterable table with graph-node chips. Seed fixtures for `Account` fields (model/plan/limit/used/today/role/strengths/sessions).
**Files:** `app/agent-pool/page.tsx`, `components/agentpool/*` (+ `ProviderAvatar.tsx`, `UsageMeter.tsx`, `ExecutionsTable.tsx`), fixtures.
- 🤖 **Automated:** `agent-pool.spec.ts` — account cards show provider glyph + usage meter + role pill; executions table filters; node chips render.
- 🧑 **Manual:** compare account cards and executions table vs reference.

### PR-11 · Decisions list parity
**Scope (from [§07](./sections/07-decisions-gate.md)):** add the All/Active/Proposed/Superseded segmented filter, status pills (incl. superseded-strike), real amber ADR ids, owner, feature + conflict chips, head actions. Add a `status` field to the decisions adapter.
**Files:** `app/decisions/page.tsx`, `components/decisions/DecisionCard.tsx`, `lib/adapters.ts`.
- 🤖 **Automated:** `decisions-list.spec.ts` — filter control switches visible rows; status pills render with correct classes; ADR id is `ADR-NNN` amber; chips present.
- 🧑 **Manual:** toggle filters; compare a row vs reference.

### PR-12 · ADR detail: re-dock + structured sections *(depends on PR-11)*
**Scope:** move ADR detail from centered modal to **right-docked aside** with TOC scroll-spy + meta grid + the ~13 structured sections (Summary KV, metrics, drivers, 3-col Consequences, Alternatives, Validation, Discussion, Provenance, Changelog, Lineage, footer). Sections render from seeded narrative fixtures.
**Files:** `components/decisions/DecisionDetail.tsx`.
- 🤖 **Automated:** `adr-detail.spec.ts` — opening an ADR docks an aside (not a modal overlay); TOC links scroll to sections; Consequences renders 3 columns.
- 🧑 **Manual:** open an ADR; confirm docked aside, TOC scroll-spy, and section layout vs reference.

### PR-13 · Ask: shared ChatPanel + message anatomy *(foundation for Ask)*
**Scope (from [§08](./sections/08-ask-chat.md)):** extract a single `ChatPanel(mode='page'|'dock'|'bubble')` from `AskDock`; rich message anatomy (avatars, who+timestamp header, right-aligned user vs left assistant, citation pills); keep our thinking indicator + Markdown.
**Files:** new `components/ask/ChatPanel.tsx`, `components/ask/Message.tsx`; refactor `AskDock.tsx`, `lib/useAskDock.ts`.
- 🤖 **Automated:** `chat-panel.spec.ts` — user vs assistant messages align opposite sides; avatars + timestamps render; citation pill renders when present.
- 🧑 **Manual:** open the dock, send a message; confirm bubble alignment/avatars match reference.

### PR-14 · Ask: bubble + side-dock relocation + ⌘K *(depends on PR-13)*
**Scope:** replace top-center glass float with the reference **bottom-right accent trigger pill → 440×620 bubble**, plus the separate **⌘K right-edge side dock (480px) with overlay**.
**Files:** `components/ask/ChatBubble.tsx` (new), `components/ask/AskDock.tsx`, `lib/useAskDock.ts`.
- 🤖 **Automated:** `chat-bubble.spec.ts` — trigger pill bottom-right; click expands bubble to ~440×620; `⌘K` opens a 480px side dock with overlay; Esc closes.
- 🧑 **Manual:** click the pill (bottom-right), then `⌘K`; confirm bubble vs side-dock behaviors match reference.

### PR-15 · Ask: full page + multi-thread *(depends on PR-13)*
**Scope:** add `/ask` route — 3-column page (thread list w/ search + pin/recent groups · ChatPanel `mode=page` · project-context/model rail). Seed `chatThreads` fixtures.
**Files:** `app/ask/page.tsx`, `components/ask/ThreadList.tsx`, `components/ask/ContextRail.tsx`.
- 🤖 **Automated:** `ask-page.spec.ts` — 3 columns; thread list search filters; selecting a thread loads it into the panel; context rail shows project + model.
- 🧑 **Manual:** open Ask from sidebar; switch threads; compare layout vs reference.

### PR-16 · Ask: rich content cards + mentions *(depends on PR-13)*
**Scope:** Plan cards, Action/Diff cards, `@mention` inline + composer autocomplete.
**Files:** `components/ask/PlanCard.tsx`, `DiffCard.tsx`, `MentionInput.tsx`.
- 🤖 **Automated:** `chat-cards.spec.ts` — an assistant message with a plan renders a plan card; a diff payload renders a diff card; typing `@` shows an autocomplete menu.
- 🧑 **Manual:** trigger a plan/diff message; type `@`; confirm cards + mention menu match reference.

---

## Phase 3 — Build the missing screens

*(Ordered by the [§09](./sections/09-missing-screens.md) build order: CLI → Feedback → Settings → Integrations → Workspace → Meetings, with the other unbuilt screens interleaved. All depend on Phase 1.)*

### PR-17 · Overview screen *(per-project landing)*
**Scope (from [§02](./sections/02-home-overview.md)):** `/overview` — per-project 7-card grid (hero, KPI band, mini-charts, now-executing / provider chips, etc.). Port reference `ov-*` CSS ~1:1.
- 🤖 **Automated:** `overview.spec.ts` — route renders the card grid; KPI band + ≥1 mini-chart present; page-head buttons render.
- 🧑 **Manual:** open Overview for a project; compare card grid vs reference.

### PR-18 · Home dashboard *(full-bleed; depends on PR-03)*
**Scope:** `/` becomes the cross-project triage dashboard — derived triage feed (~13 items), KPI band, sortable projects health table. Port `tri-*` CSS.
- 🤖 **Automated:** `home.spec.ts` — `/` renders full-bleed (no sidebar); triage feed lists items; projects table sorts.
- 🧑 **Manual:** open Home; confirm full-bleed dashboard with feed + sortable table vs reference.

### PR-19 · Sprints view
**Scope:** `/sprints` — sprint hero, sprint rows, stacked progress bar, burn-down svg. Add `.sprint-*` / `.stack-bar` / `.burn-svg` CSS.
- 🤖 **Automated:** `sprints.spec.ts` — hero + ≥1 sprint row; stacked bar segments sum correctly; burn svg present.
- 🧑 **Manual:** open Sprints; compare hero + burn-down vs reference.

### PR-20 · GraphIssues view
**Scope:** `/graph-issues` — filter bar, circle graph by node type, AI-issues pane (reuses PR-04 `typeMeta`).
- 🤖 **Automated:** `graph-issues.spec.ts` — filter bar toggles node types; graph renders typed circles; issues pane lists items.
- 🧑 **Manual:** toggle filters; compare graph + issues pane vs reference.

### PR-21 · CLI / logs view *(smallest)*
**Scope:** `/cli` — recent-runs sidebar + colorized log-block renderer (faux terminal).
- 🤖 **Automated:** `cli.spec.ts` — selecting a run renders its colorized log block; `$`/output lines styled.
- 🧑 **Manual:** click runs; confirm log coloring vs reference.

### PR-22 · Feedback view
**Scope:** `/feedback` — cluster list ↔ detail, stacked source-breakdown bar, quotes, platform pills. Reuse `QuoteCard` from PR-07.
- 🤖 **Automated:** `feedback.spec.ts` — selecting a cluster loads detail; source bar segments render; platform pills present.
- 🧑 **Manual:** click a cluster; compare detail + source bar vs reference.

### PR-23 · Settings + shared Settings/Agents/Integrations tab strip
**Scope:** `/settings` — grouped per-project automation toggle rows + the **shared tab strip** that Integrations & Workspace reuse.
- 🤖 **Automated:** `settings.spec.ts` — tab strip renders 3 tabs; toggle rows reflect per-project state; toggling persists in-session.
- 🧑 **Manual:** flip toggles; switch tabs; compare vs reference.

### PR-24 · Integrations view *(dual-mode; depends on PR-23 tab strip)*
**Scope:** `/integrations` — project vs workspace `wsMode`, project-switch wiring, multi-connection cards (scope tags / health / usage dots / toggles).
- 🤖 **Automated:** `integrations.spec.ts` — project mode vs workspace mode render different sets; connection cards show scope tag + health dot + toggle.
- 🧑 **Manual:** view in a project, then at workspace level; compare both modes vs reference.

### PR-25 · Workspace shell *(depends on PR-03, PR-23, PR-24)*
**Scope:** `/workspace` — thin shell hosting global settings + the `wsMode` variants of Integrations and the agents pool.
- 🤖 **Automated:** `workspace.spec.ts` — workspace-level mode active; hosts settings + ws-variant of integrations/pool.
- 🧑 **Manual:** open Workspace; confirm it frames the ws-mode sub-views vs reference.

### PR-26 · Meetings view *(largest single screen)*
**Scope:** `/meetings` — list + 5 fidelity-specific detail layouts (transcript / summary / outcomes / metadata / processing) + auto-positioning highlight-evidence popover.
- 🤖 **Automated:** `meetings.spec.ts` — list renders; each fidelity opens its matching detail layout; clicking a highlight opens the evidence popover positioned in-viewport.
- 🧑 **Manual:** open meetings of different fidelities; trigger the highlight popover; compare vs reference.

### PR-27 · Accounts standalone + PM→worker graph
**Scope (from [§06](./sections/06-agentpool-accounts.md)):** `/accounts` — scope switcher, serif intro + stats, **orchestrator PM→workers SVG graph** (`OrchLines`), strategy selector, provider-filter tabs, handoff log, connect/import. Reachable as a Settings→Agents tab and a workspace page.
- 🤖 **Automated:** `accounts.spec.ts` — PM→worker connector svg paths render; strategy selector changes selection; provider filter tabs filter; handoff log lists entries.
- 🧑 **Manual:** view Accounts; change strategy/filter; confirm the connector graph matches reference.

### PR-28 · Gate conflict redesign  ⚠️ *needs product/design sign-off*
**Scope (from [§07](./sections/07-decisions-gate.md)):** replace the generic Allow/Skip brake-queue with the reference **bespoke conflict screen** (breadcrumb, banner actions, Task/Why cards, 2-panel ⇄ conflict, diff snippet, 3 signal cards, reviewer suggestion). **Blocked on a decision:** do we adopt the single-conflict reference model or keep our multi-brake queue? Surface before building.
- 🤖 **Automated:** `gate.spec.ts` — conflict screen shows the 2-panel diff, 3 signal cards, and approve/reject banner actions.
- 🧑 **Manual:** open Gate; walk the conflict layout vs reference.

---

## Suggested execution order

1. **PR-00** (harness) →
2. **PR-01 → PR-02 → PR-03** (shell foundation, in order) →
3. Then parallelize:
   - *Restyle track:* PR-04→05 (Brain), PR-06→07 (Backlog/Task), PR-08→09 (Orchestrator), PR-10, PR-11→12 (Decisions), PR-13→{14,15,16} (Ask).
   - *New-screens track:* PR-21 (CLI) → PR-22 (Feedback) → PR-23 (Settings) → PR-24 (Integrations) → PR-25 (Workspace) → PR-26 (Meetings); plus PR-17 (Overview), PR-18 (Home), PR-19 (Sprints), PR-20 (GraphIssues), PR-27 (Accounts) as they fit.
4. **PR-28** (Gate) last, after the product decision.

**Open decisions to resolve before their PRs:** Gate model (PR-28); how literally to mirror the Accounts orchestrator/strategy UI (PR-27); and per-screen, whether to keep building on seeded fixtures or block on real API fields.
