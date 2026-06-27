# Meetings + Feedback + CLI + Settings + Integrations + Workspace — full-parity plan

Goal: **full visual + data parity** with `docs/Spade (standalone).html` for the six reference
screens our PoC has not built. Each screen is built fully (routes, components, ported reference CSS),
SEEDED with demo data that mirrors the reference `SpadeData`, and any real backend work is split into
follow-up PRs + validation tests.

Reference modules (extracted to scratchpad): `mod_17` MeetingsView, `mod_07` FeedbackView,
`mod_13` CliView, `mod_16` SettingsView, `mod_05` IntegrationsView, `mod_09` WorkspaceView,
`mod_01` SpadeData, `inner.html` CSS.

## How this maps onto our stack (read first)

- **Routing.** Next.js App Router. Each screen is `apps/client/app/<route>/page.tsx` with
  `"use client"`. Existing routes: `backlog`, `brain`, `decisions`, `gate`, `orchestrator`,
  `agent-pool`, `active`, `dev-tokens`, `task/[id]`. New routes: `meetings`, `feedback`, `cli`,
  `settings`, `integrations`, `workspace`.
- **Navigation.** The reference `goto('task'|'settings'|'accounts'|'integrations'|'workspace'|'home')`
  becomes `next/link` / `useRouter().push`. Map: `accounts` → `/agent-pool`, `task` →
  `/backlog` (no task list route; deep links to `/task/[id]` where an id is known, else `/backlog`),
  `home` → `/`. The reference `window.dispatchEvent('spade:nav')` in the HL popover → `router.push`.
- **Project switching.** The reference uses `window.SpadeProject` +
  `window.addEventListener('spade:project-changed')`. Our equivalent is `useProject()`
  (`lib/useProject.ts`, `useSyncExternalStore`-backed, persists to localStorage). Any screen that
  reads "current project" calls `useProject()`; it re-renders on switch automatically — **no window
  events**. Per-project state (Settings toggles) is keyed by `project.id`.
- **Shared primitives that already exist** (`components/ui/`): `TogglePill` (controlled `on`/`onChange`,
  renders `.toggle-pill`/`.thumb`), `Subtab` (`.subtab`, active accent border — reuse for the
  Settings/Integrations tab strip and the Workspace tabs), `PageHead`, `Btn`, `Chip`, `Avatar`,
  `Kbd`, `IconBtn`. **Reuse these — do not re-create.** `Icon` (`components/Icon.tsx`) renders the
  `#i-*` symbols by `IconName`; add any missing names (`mic`, `cal`, `term`, `link`, `flag`).
- **CSS.** All reference classes live in `inner.html` and are **absent** from
  `apps/client/app/globals.css` (verified: 0 matches for `meeting-row`, `feedback-cluster`,
  `cli-wrap`, `int-type-card`, `settings-rule`, `fid-badge`, `hl-pop`). Port the relevant blocks
  verbatim (design tokens `--accent #c9b8ff`, `--green`, `--red`, `--amber`, `--blue`, fonts already
  defined). Each PR ports only the CSS its screen needs.
- **Data layer.** Client fetches via `lib/api.ts` → proxied `/api/*` → Python FastAPI
  (`apps/api/tui_pilot`). Brain/tasks/decisions/projects/accounts are **REAL** (DB-backed + seeded
  server-side). Meetings/feedback/cli/integrations have **no backend** → seed client-side now,
  backend later (see Data sourcing + PR breakdown).
- **Testing.** Vitest + RTL unit tests in `components/<area>/__tests__`; Playwright specs in
  `apps/client/e2e/*.spec.ts` (helpers in `e2e/_helpers.ts`). Match the existing
  `decisions-detail.spec.ts` / `agent-pool.spec.ts` style.

---

## Target (each screen)

### Meetings (`mod_17`, effort **L**)
List view + five fidelity-specific detail layouts + an auto-positioning highlight popover.
- **List:** `.page-head` breadcrumb `**Meetings** · {N} ingested · last 14 days`; right ghost
  `🔗 Connected sources`, solid `🎙 Upload transcript`. `.filter-bar`: `Source` label + `.seg`
  (`All` + one button per distinct source) + muted positioning copy *"Spade does not record
  meetings…"*. `.list-wrap` of clickable `.meeting-row`: 30px avatar (≤2 caps of title), title +
  `FidelityBadge`, muted meta (`.source-badge` colored per source · date · duration ·
  `{n} participants` · optional italic serif `note`), right-aligned mono extract counts
  (`<accent>{tasks}</accent> tasks · <amber>{decisions}</amber> decisions · <text-3>{questions}</text-3> Q`;
  `processing…` when processing, else `—`), trailing ghost `Open ›`.
- **FidelityBadge** (`.fid-badge fid-{tone}`): `transcript`→Transcript/mic/ok,
  `summary`→Summary only/doc/warn, `outcomes_only`→Outcomes only/check/warn,
  `metadata_only`→Calendar only/cal/stale, `processing`→Processing/spark/info; `status==="skipped"`
  → muted `.chip` "skipped".
- **Detail** (`MeetingDetail`): breadcrumb `Meetings / **{title}**` (crumb = back). Right:
  `.source-badge`, badge, `Open in {source} ↗`, and (transcript|summary only) primary `✨ Re-extract`.
  Body switches on `fidelity`:
  1. **transcript** — two-col `.meeting-grid`: left `.transcript` (header `● Full transcript ·
     {n} participants · diarized` + mono duration; diarized `.turn` rows with `<HL>` marks), right
     `.extract` (`✨ Triage agent extracted 4 items` + `ExtractCard` list).
  2. **summary** — `SummaryBanner` ("Summary only — no transcript available") + grid; left
     `.summary-list` bullets (`✓`/`?`/`·` by kind) with attribution; right `.extract` with
     "lower confidence" chip + dashed caveat + ExtractCards sourced from "AI summary".
  3. **outcomes_only** — banner + either `.empty-detail` or `{n} action items imported` + ExtractCards.
  4. **metadata_only** — banner ("Skipped — private meeting" if skipped, else "No notes captured") +
     `.meta-card` definition list + closing notetaker copy.
  5. **processing** — banner "Extraction in progress" + `.skel-row`/`.skel-card` skeletons.
- **HL popover** (`.hl-pop`, 320px): inline `<mark class="hl {kind} hl-{kind}">`, hover/focus opens a
  popover that **auto-flips above/below** via `getBoundingClientRect` (flip when `r.top < 220`),
  clamps left to viewport, 120ms close grace cancelled on popover hover. Kinds (`KIND_META`):
  `fb` Feedback/green/flag, `b` Bug/blue/flag, `f` Feature/accent/spark, `d` Decision/amber/doc.
  Header (icon + label + quoted text), `reason` body, footer = linked-task row (prio dot + mono id +
  title + arrow + "Already tracked — re-extract won't duplicate" lock) OR primary
  `+ Create task from this` + `⌘K to dismiss` hint. Task link → `router.push`.
- **ExtractCard** (`.extract-card`): color dot + `.x-type` label, `<h4>`, optional `.links` chips
  (`[kind,value]`), optional amber `warning`, optional muted `note`, `.x-from` (italic serif quote +
  `— speaker`); whole card clickable when `goto` given.

### Feedback (`mod_07`, effort **M**)
Master/detail cluster list ↔ detail with quotes + a stacked source-breakdown bar.
- `.page-head` `**Feedback** · 312 items · clustered into {N} themes`; right `.topbar-pill`
  "Intercom · Zendesk · App Store · Play" + solid `Re-cluster`. `.filter-bar` `.seg`
  (`Last 30d`/`This sprint`/`All time`) + muted sentiment legend.
- `.feedback-grid`: left `.feedback-side` list of `.feedback-cluster` (active on select) — sentiment
  dot + label + mono count; `.chip.feature` + mono trend (red if rising); `.cluster-srcs` of
  `SourceMark`; optional mono `→ linked {taskId}`. Right `.feedback-detail`: `<h2>` + `· {n} reports`;
  chip row; action (linked → `.fbq-locked-row` + task button, else primary
  `+ Create task from this cluster`); `SourceBreakdown` (header + stacked proportional `.src-seg` bar
  + `.src-legend`); `Quotes · showing {n} of {count}` + `FeedbackQuote` list; "What Spade did" AI
  `◆` card.
- **FeedbackQuote** (`.fbq`): `SourcePill` + author + mono when + meta + mono id + open-in icon;
  italic serif quote; actions (linked → "Rolled into {taskId}" + `View task ›`; else ghost
  `attach to existing task` + primary `+ Create task from this quote`).
- **Platform helpers** (`PLATFORM_META`): intercom/zendesk/appstore/playstore/email/twitter
  (label + 2-char short + glyph); `SourcePill` (full), `SourceMark` (compact + count); `.src-bg-{p}`.

### CLI / logs (`mod_13`, effort **S**)
Faux terminal — recent-runs sidebar + colorized log pane.
- `.page-head` `**CLI** · <mono muted>~/.spade</mono>`; right ghost `Copy session ID`,
  `Open in terminal`, primary `⌨ Spawn shell`. `.cli-wrap`: `.cli-side` (`Recent runs` `.cmd` rows
  with status glyph `✓`/`✗`/`●` colored + mono `{ts} · {who}`, active highlighted; `Quick commands`
  fixed list) + `.cli-main` (selected block rendered line-by-line via the multi-span colorizer +
  trailing blinking `$ ▌`).
- **LogLine** spans: `p` dim prompt, `c` `.prompt` command, `d`/`d2` default, `o` accent operand,
  `arg` `.arg` argument, `ok` green, `err` red. Four hard-coded blocks (`run --sprint`,
  `brain ingest`, `brain status`, `sync --linear` w/ auth-fail path); unknown commands fall back to
  `run --sprint`.

### Settings — project Automations (`mod_16`, effort **M**)
Per-project automation rules grouped into four sections of toggle rows + shared tab strip.
- `.page-head` breadcrumb = project glyph + `**{project}** / Settings / Automations`; right ghost
  `[graph] Workspace settings` (→ `/workspace`), ghost `Reset to defaults`, primary
  `All changes saved ✓`. `.settings-tabs`: **Automations** active, `Agents (project)` → `/agent-pool`,
  `Integrations` → `/integrations`.
- `.settings-wrap`: `.scope-banner` (project-tinted `project scope` pill + copy +
  `Workspace-wide settings →`); `.settings-intro` (serif "Automations for {project}." + para +
  3 `.summary-stat` tiles: `{on}/{total}` rules, project glyph/slug, amber `4` hard gates); four
  `.settings-group`s:
  1. **Promote to backlog**: `task_from_meeting`, `task_from_feedback`, `task_from_bugs`.
  2. **Pipeline execution**: `auto_run`, `auto_review`, `auto_merge`, `auto_doc`.
  3. **Human gates**: `gate_adr_conflict`, `gate_security`(mandatory/required, disabled),
     `gate_schema`, `gate_p0`, `gate_first_deploy`.
  4. **Spend & limits (this project)**: `daily_cap`($25), `per_task_cap`($1.50), `concurrency`(8),
     `working_hours`(09–18 PT) — `knob` mono pill when on.
- **Rule row** (`.settings-rule on|off`): `TogglePill` + body (`.sr-label` + `required` tag + `knob`
  when on; `.sr-desc`; `.sr-manual` hint when off and `manualWhereUsed` set) + `.sr-state`
  (`● auto`/`○ manual`). Mandatory rules can't toggle. `.settings-footer` aphorism.
- Per-project defaults (`projectDefaults`) keyed by project id make scoping feel real (tools
  full-auto, mobile gates everything).

### Integrations (`mod_05`, effort **L** — largest)
Dual-mode (project vs workspace `wsMode`), grouped by category, multi-connection cards.
- **Project mode:** `.page-head` `**{project}** / Integrations · {N} in use`; right ghost `Sync now`,
  primary `+ Add private connection`; `.settings-tabs` (Automations→`/settings`, Agents→`/agent-pool`,
  **Integrations** active). **Workspace mode:** no head/tabs (Workspace shell provides them).
- `.int-banner` context banner (project: glyph + inherited-vs-private copy; workspace: link icon +
  shared/local counts). Category groups (`Meetings`/`Feedback`/`Code`/`PM`/`Observability`/
  `Analytics`): `.sb-label` + `.int-stack` of `IntegrationTypeCard`. Visible set differs by mode
  (workspace: all incl. unconnected; project: only types with a workspace/this-project connection,
  plus unconnected types so you can add).
- **IntegrationTypeCard** (`.int-type-card has|empty`): header `.int-icon` (mark tinted by color),
  name + pill (`in use here` project / `{n} connections` workspace), `cat · desc`, action button
  (`+ Add connection` workspace / `+ Add private` project). `.int-conn-list` of `.int-conn {status}`
  rows: `.int-conn-id` (label + mono identity); `.int-conn-scope` (`workspace` tag w/ graph icon OR
  project tag tinted); `.int-conn-usage` (workspace → `UsageDots`; project → `.int-state-pill`
  healthy/needs attention/stale); `.int-conn-meta` (mono `last` + project+workspace-scoped →
  enable/disable `toggle-pill` + gear). Empty → "Not connected." + `Connect {name}`.
- **UsageDots**: ≤5 project glyph chips (tinted) + `+N`; tooltip = project names; "not used yet"
  when empty.

### Workspace (`mod_09`, effort **M** code / **L** in practice — depends on Settings + Integrations)
Workspace-scope shell: own header + 3-tab strip hosting global settings, agents pool (wsMode), and
integrations (wsMode).
- `.ws-shell-head`: `.ws-mark` graph glyph + "Workspace" + sub "…shared across **{N} projects**";
  right ghost `← Back to home` (→ `/`). `.ws-tabs`: **Settings**(cog), **Agents pool**(spark) +
  count = `accounts.length` → renders agent-pool in `wsMode`, **Integrations**(link) + count =
  connected integrations → renders `IntegrationsView` `wsMode`. Tab default `settings`.
- **WorkspaceSettingsPanel**: same `.settings-wrap`/`.settings-group`/`.settings-rule` vocabulary but
  single global state map (no per-project keying). `.ws-banner` (graph icon + copy +
  `.ws-projects-strip` of project glyph chips); `.settings-intro` (serif "The defaults that govern
  your whole workspace." + tiles `{on}/{total}`, `{N}` projects, green `$48 today · $250 cap`); four
  groups: **Ingestion** (`meet_ingest`, `meet_extract`, `feedback_cluster`, `bug_extract`),
  **Notifications** (`notif_gate`"DM", `notif_p0`"DM", `notif_shipped`, `notif_daily`"09:00 PT",
  `notif_account`), **Workspace spend caps** (`global_daily`"$250", `global_monthly`"$4,000",
  `prefer_byo`), **CLI defaults** (`sandbox`, `redact_logs`*mandatory, `telemetry`). Footer aphorism
  "Workspace sets the floor. Each project picks its own ceiling."

---

## Current state (unbuilt)

Verified against `apps/client`:
- **No routes** for meetings/feedback/cli/settings/integrations/workspace (`app/*/page.tsx` has none).
- **No components** dirs for any of them (`components/` has agentpool/ask/backlog/brain/decisions/
  gate/orchestrator/shell/task/ui only).
- **No CSS** — 0 matches in `globals.css` for `meeting-row`, `feedback-cluster`, `cli-wrap`,
  `int-type-card`, `settings-rule`, `fid-badge`, `hl-pop`, `src-breakdown`, `ws-tab`, `scope-banner`.
  All reference styling must be ported from `inner.html`.
- **Sidebar** (`components/shell/Sidebar.tsx`): `Meetings`, `Feedback`, `CLI / logs`, `Settings`
  exist as `href:"#"` (rendered disabled/"Próximamente"). `Integrations` and `Workspace` are **not in
  the nav at all**.
- **No data API** for meetings/feedback/cli/integrations (`lib/api.ts` covers projects, sessions,
  accounts, brain, tasks, comments, settings).
- **Real fields that DO exist** for Settings: `Project` has `autopilot:number`,
  `account_strategy:string`, `model_ceiling:string|null` (DB-backed). `PATCH /projects/{id}` already
  accepts those three (`registry_server.py:282`), and there's a global `GET/PUT /settings`
  (force_bypass only). The client has **no `updateProject` helper** yet, and none of the reference's
  ~16 per-project rules / 4 workspace groups map to those three columns.

---

## Build steps

Order respects dependencies: shared primitives → CLI → Feedback → Settings → Integrations →
Workspace → Meetings. (Workspace depends on Settings + Integrations + agent-pool `wsMode`.)

### Step 0 — Shared primitives & fixtures scaffolding (PR-0)
- **CSS base.** Port the shared blocks from `inner.html` into `globals.css` (or a co-located module):
  `.page-head`/`.breadcrumb`/`.page-head-right` (confirm parity), `.filter-bar`/`.seg`,
  `.settings-tabs`/`.settings-tab`, `.fade-in`, `.sb-label`, `.source-badge`, `.topbar-pill`,
  `.chip` variants (`feature`/`feedback`/`bug`/`decision`/`metric`), `.proj-glyph`, `.scope-pill`/
  `.scope-tag`, `.toggle-pill`/`.thumb` (verify our existing rule matches reference). Most tab/toggle
  styling can reuse our `Subtab`/`TogglePill`.
- **Icons.** Ensure `Icon` supports `mic`, `cal`, `term`, `link`, `flag`, `spark`, `doc`, `check`,
  `cog`, `graph`, `plus`, `arrow`, `tasks`, `gate`. Add missing `#i-*` symbols.
- **Fixtures module** `lib/fixtures/spade.ts` — typed mirror of the seed data (see Data sourcing).
  All four un-backed screens import from here so a later backend swap is a one-line change in
  `lib/api.ts`.
- **Nav helper.** A small `goto`-equivalent: a `useSpadeNav()` wrapping `useRouter().push` with the
  route map (`accounts→/agent-pool`, `task→/backlog`, `home→/`, etc.) so components mirror the
  reference `goto(...)` calls 1:1.

### Step 1 — CLI (`app/cli/page.tsx`, `components/cli/`)
- Components: `CliView` (owns `activeCommand`), `RunListItem`, `QuickCommand`, `LogBlock`,
  `LogLine` (the multi-span colorizer). Data module `cliBlocks` (the 4 hard-coded blocks) +
  `cliRuns` fixture.
- Port `mod_13` logic verbatim: run/quick-command selection sets `active`; commands without a block
  fall back to `run --sprint`; status glyph coloring; static blinking cursor. Top-right buttons are
  stubs.
- Port CSS: `.cli-wrap`, `.cli-side`, `.cmd`, `.cli-main`, `.prompt`, `.arg`, `.dim`, `.ok`, `.err`.
- Wire Sidebar `CLI / logs` `href` → `/cli`.

### Step 2 — Feedback (`app/feedback/page.tsx`, `components/feedback/`)
- Components: `FeedbackView` (owns `selectedClusterId` default `fc-1`, `timeRange`),
  `ClusterListItem`, `ClusterDetail`, `SourceBreakdown` (stacked bar + legend),
  `FeedbackQuote`, `SourcePill`/`SourceMark`, + `platformMeta` map module.
- Port `mod_07` logic: cluster select; linked vs unlinked → different action row + per-quote action
  set; time-range `.seg` (visual only); `goto('task')` from linked rows → nav helper; quotes keyed by
  cluster id with `fc-1` fallback.
- CSS: `.feedback-grid`, `.feedback-side`, `.feedback-cluster`, `.cluster-srcs`, `.feedback-detail`,
  `.src-breakdown`/`.src-seg`/`.src-legend-item`, `.fbq`/`.fbq-*`, `.src-pill`/`.src-mark`/
  `.src-bg-{platform}`, `.fbq-locked-row`.
- Wire Sidebar `Feedback` → `/feedback`.

### Step 3 — Settings (`app/settings/page.tsx`, `components/settings/`)
- Components: `SettingsView` (owns per-project `stateMap`, reads `useProject()`), `SettingsTabs`
  (built on `Subtab` — **shared with Integrations**), `ScopeBanner`, `SettingsSummary`,
  `SettingsGroup` → `SettingsRule` (uses `TogglePill`). Reuse for Workspace.
- Port `mod_16` logic: `projectGroups` (4 groups, in-component), `projectDefaults` keyed by
  `acme/mobile/tools/labs`, per-project `stateMap` seeded from defaults, recomputed on project switch
  via `useProject()`. Toggle non-mandatory rules; `onCount` live; `knob` pill only when on;
  `.sr-manual` only when off; `gate_security` mandatory. Tab + workspace buttons → nav helper.
- CSS: `.settings-wrap`, `.scope-banner`/`.scope-pill`, `.settings-intro`/`.summary-stat`,
  `.settings-group`/`.settings-group-h`, `.settings-rules`/`.settings-rule`, `.sr-*`,
  `.settings-footer`.
- **Real-field bridge:** show the REAL `project.autopilot`/`account_strategy`/`model_ceiling` (read
  from `useProject()`) somewhere honest — e.g. drive `auto_run`'s default and the summary tile from
  `project.autopilot`, and surface `model_ceiling`/`account_strategy` as read-only context in the
  scope banner. The 16 toggle states themselves are SEED/in-memory until the backend lands (see Data
  sourcing). Wire Sidebar `Settings` → `/settings`.

### Step 4 — Integrations (`app/integrations/page.tsx`, `components/integrations/`)
- Components: `IntegrationsView({ wsMode })` (reads `useProject()`), `SettingsTabs` (shared from
  Step 3), `IntegrationBanner`, `IntegrationTypeCard`, `ConnectionRow`, `ScopeTag`, `UsageDots`,
  `ConnectionStatePill`, plus per-project enable/disable `TogglePill`.
- Port `mod_05` logic exactly: category grouping (`[...new Set(cat)]`); `wsMode` visibility filter;
  totals (`totalWs`/`totalLocal`/`inProjectCount`); per-connection scope tag, usage dots vs health
  pill, enable/disable toggle (project mode + workspace-scoped only), configure stub; project-switch
  re-render via `useProject()` (replaces the reference's `spade:project-changed` listener).
- The `wsMode` page wrapper renders only when reached via Workspace; the standalone `/integrations`
  route renders project mode (head + tabs).
- CSS: `.int-banner`, `.int-stack`, `.int-type-card has|empty`, `.int-icon`, `.int-pill`,
  `.int-conn`/`.int-conn-*`, `.scope-tag ws|proj`, `.int-state-pill`, `.usage-dots`/`.usage-dot`,
  `.int-conn-empty`.
- Add `Integrations` to the Sidebar nav (it is currently absent).

### Step 5 — Workspace (`app/workspace/page.tsx`, `components/workspace/`)
- Components: `WorkspaceView` (owns `tab`, default `settings`), `WorkspaceTabs` (built on `Subtab`),
  `WorkspaceSettingsPanel` (reuses `SettingsGroup`/`SettingsRule`/`TogglePill` from Step 3),
  `WorkspaceBanner`, reuse `SettingsSummary`.
- Port `mod_09`: tab state; global single `stateMap` (no per-project keying); `redact_logs`
  mandatory; the four `globalGroups`; knob pills; `← Back to home` → `/`. **Agents pool** tab renders
  the existing agent-pool view in `wsMode` (requires agent-pool to accept a `wsMode` prop — small
  add, see Backend/feature notes); **Integrations** tab renders `IntegrationsView wsMode`.
- CSS: `.ws-shell-head`/`.ws-shell-head-inner`/`.ws-title-block`/`.ws-mark`/`.ws-title`/`.ws-sub`,
  `.ws-tabs`/`.ws-tab`/`.ws-tab-count`, `.ws-banner`/`.ws-projects-strip`/`.ws-proj-chip`.
- Add `Workspace` to nav (or wire the existing project-switcher "workspace scope" affordance → it).

### Step 6 — Meetings (`app/meetings/page.tsx`, `components/meetings/`)
- Components: `MeetingsView` (owns `openId`, `sourceFilter`), `MeetingRow`, `FidelityBadge`,
  `MeetingDetail` → `MeetingDetailTranscript`/`Summary`/`Outcomes`/`Metadata`/`Processing`,
  `SummaryBanner`, `ExtractCard`, `SourceBadge`, and **`Highlight`** (the `<HL>` popover).
- Port `mod_17` logic: source `.seg` filter; row → detail (`openId`); breadcrumb back; fidelity
  dispatch; transcript turns + HL marks + ExtractCards are **static sample content keyed by meeting
  id** (as in the reference) — keep them in `components/meetings/sampleContent.ts`. Build the HL
  popover faithfully: `getBoundingClientRect` placement, flip when `r.top < 220`, left-clamp, 120ms
  close grace cancelled on popover hover, `⌘K` dismiss hint, linked-task row vs create button,
  task link → nav helper.
- CSS: `.meeting-row`, `.avatar`, `.source-badge`, `.fid-badge fid-{tone}`, `.meeting-grid`,
  `.transcript`/`.turn`/`.who`/`.ts`/`.body`, `.extract`/`.extract-card`/`.x-*`/`.links`,
  `.summary-list`/`.sum-*`, `.fid-banner`/`.fid-banner-*`, `.meta-card`/`.meta-dl`, `.empty-detail`,
  `.skel-row`/`.skel-card`, `.hl`/`.hl-{kind}`/`.hl-pop`/`.hl-pop-*`/`.prio-dot`.
- Wire Sidebar `Meetings` → `/meetings`.
- **Reuse opportunity:** the `Highlight` popover is conceptually shared with brain/decisions evidence
  popovers — consider extracting to `components/ui/EvidencePopover` if it converges; otherwise keep
  local to meetings to avoid premature abstraction.

---

## Data sourcing (REAL | SEED | BACKEND-FEATURE)

| Screen | Data | Sourcing |
|---|---|---|
| **Meetings** | `meetings` (10 records), transcript turns, HL marks, ExtractCards | **SEED**. Records → `lib/fixtures/spade.ts`; turns/HL/extracts are reference-hardcoded → `components/meetings/sampleContent.ts` keyed by meeting id. **BACKEND-FEATURE:** meetings ingest + extraction API (see below). |
| **Feedback** | `feedbackClusters` (7), `feedbackQuotes` (fc-1/fc-2 + fallback) | **SEED** → fixtures. **BACKEND-FEATURE:** feedback clustering API. |
| **CLI** | `cliRuns` (6) + 4 hardcoded log blocks | **SEED** → fixtures + `cliBlocks` module. **BACKEND-FEATURE (optional):** real session logs. |
| **Settings** | `project.autopilot` / `account_strategy` / `model_ceiling`; the 16 automation toggles; per-project defaults | **REAL (read)** for the 3 project columns via `useProject()`. **SEED** for the 16-toggle UI state (in-memory `stateMap` seeded from `projectDefaults`). **BACKEND-FEATURE:** project-settings UPDATE/persistence for the full rule set. |
| **Integrations** | `integrations` (12, with connections), `projects` | `integrations` **SEED** → fixtures; `projects` **REAL** (`useProject()`/`api.projects()`) for scope tags/usage dots/current project. **BACKEND-FEATURE:** integrations connection API. |
| **Workspace** | `projects` count + glyph strip (**REAL**), `accounts.length` (**REAL**), connected-integrations count (**SEED**), 4 global rule groups | **REAL** for projects/accounts counts; **SEED** for integration count + global toggle state. **BACKEND-FEATURE:** workspace-settings persistence. |

**Fixture authoring rule:** mirror the exact `mod_01` `SpadeData` shapes and values (ids, labels,
counts, colors, scopes) so the screens are pixel/behaviour-faithful. Type every fixture in
`lib/types.ts` (add `Meeting`, `FeedbackCluster`, `FeedbackQuote`, `CliRun`, `Integration`,
`IntegrationConnection`, `AutomationRule`). The four un-backed screens read fixtures through a thin
`lib/api.ts` shim (e.g. `api.meetings()` returns the fixture as a resolved promise) so swapping to a
real endpoint later is a one-function change and SWR keys stay identical.

---

## Backend features (planned follow-up PRs + validation tests)

| Feature | Screen(s) | Scope | Validation |
|---|---|---|---|
| **B1 — Project-settings UPDATE/persistence** | Settings, Workspace | Extend `PATCH /projects/{id}` (already accepts the 3 columns) with a JSON `automations` blob, or add an `automation_rules` table keyed by project + a `GET/PUT /projects/{id}/automations`. Add `api.updateProject()` / `api.projectAutomations()` to `lib/api.ts`. Workspace global rules → extend `GET/PUT /settings` (currently force_bypass only). | API integration test (pytest) for round-trip persistence + per-project isolation; client unit test for optimistic toggle + save indicator. |
| **B2 — Meetings ingest + extraction** | Meetings | `meetings` table + `GET /meetings?project_id`, `GET /meetings/{id}` (turns/extracts/HL evidence), `POST /meetings/{id}/reextract`, `POST /meetings/upload`. | pytest CRUD + extraction-payload shape; client swap test (fixtures → API parity). |
| **B3 — Feedback clustering** | Feedback | `feedback_clusters`/`feedback_quotes` tables + `GET /feedback/clusters`, `GET /feedback/clusters/{id}/quotes`, `POST /feedback/recluster`, `POST /feedback/clusters/{id}/task`. | pytest cluster + quote shape; client list/detail parity test. |
| **B4 — Integrations connections** | Integrations, Workspace | `integrations`/`integration_connections` tables + `GET /integrations`, scope/usedBy model, `POST /integrations/{id}/connections`, `PUT .../enable` (per-project toggle). | pytest scope/usage/health model; client wsMode vs project-mode parity test. |
| **B5 — CLI session logs (optional)** | CLI | Stream real run logs into the colorizer instead of the 4 static blocks. Lowest priority. | pytest log-line schema; client colorizer snapshot. |

Each Bn ships **after** its screen's UI PR (UI is fully usable on fixtures first), and each Bn PR
includes the `lib/api.ts` swap + a Playwright spec proving the screen renders identically against the
real endpoint.

---

## Validation

### Playwright (`apps/client/e2e/*.spec.ts`, mirror `decisions-detail.spec.ts` style)
- `cli.spec.ts` — recent-run selection swaps the log block; quick-command fallback to `run --sprint`;
  status glyph colors; blinking cursor present.
- `feedback.spec.ts` — default cluster `fc-1` selected; selecting a cluster updates detail + quotes;
  stacked bar segment count matches breakdown; linked cluster shows lock row, unlinked shows
  create button; `View task ›` navigates.
- `settings.spec.ts` — four groups render; toggling a non-mandatory rule flips `.sr-state` +
  updates the `{on}/{total}` tile; `gate_security` toggle is disabled; switching project (via
  topbar) reloads that project's defaults; knob pill appears only when on.
- `integrations.spec.ts` — project mode shows tabs + banner + only relevant categories; per-project
  enable/disable toggle present on workspace-scoped connections; health pill states render; switching
  project re-renders usage; workspace mode (reached via `/workspace`) shows usage dots, no tabs.
- `workspace.spec.ts` — three tabs; tab counts = accounts/connected-integrations; Settings panel
  toggles; Agents/Integrations tabs mount their `wsMode` views; `← Back to home` → `/`.
- `meetings.spec.ts` — list renders N rows + source `.seg` filter; opening each fidelity shows the
  correct detail variant (transcript grid, summary banner, outcomes, metadata card, processing
  skeletons); HL hover opens popover, repositions/flips near top of viewport, closes on leave with
  grace, linked-task row vs create button; breadcrumb back returns to list.
- `shell-nav.spec.ts` (extend) — the six sidebar items now navigate (no longer "Próximamente");
  Integrations + Workspace appear in nav.

### Unit (Vitest + RTL, `components/<area>/__tests__`)
- `LogLine` colorizer (each span class), `FidelityBadge` mapping (5 fidelities + skipped),
  `Highlight` placement math (flip threshold, left-clamp), `SourceBreakdown` flex weights,
  `SettingsRule` (mandatory disables toggle; knob/manual conditional render), `UsageDots`
  (≤5 + overflow + empty), `IntegrationTypeCard` visibility filter (project vs wsMode).

### Manual checklist
- Visual diff each screen against `docs/Spade (standalone).html` at the same project (Acme) — tokens,
  spacing, fonts (Instrument Serif / Inter Tight / JetBrains Mono).
- Switch projects in the topbar → Settings + Integrations reflect the new project's
  defaults/connections.
- Tab strip round-trips Automations ↔ Agents ↔ Integrations ↔ Workspace without losing state.
- Meetings HL popover keyboard-accessible (focus opens, blur closes, `⌘K` hint shown).

---

## PR breakdown (ordered; dependencies noted)

UI PRs first (fully usable on fixtures), backend PRs after each screen.

1. **PR-0 Shared foundation** — port shared CSS blocks, extend `Icon`, add `lib/fixtures/spade.ts`
   types + data, `useSpadeNav()` helper. *(blocks all others)*
2. **PR-1 CLI** — `app/cli` + `components/cli` + `cliBlocks`; Sidebar wire; `cli.spec.ts`. *(dep: PR-0)*
3. **PR-2 Feedback** — `app/feedback` + `components/feedback` + `platformMeta`; Sidebar wire;
   `feedback.spec.ts`. *(dep: PR-0)*
4. **PR-3 Settings** — `app/settings` + `components/settings` (incl. shared `SettingsTabs`/`ScopeBanner`/
   `SettingsSummary`/`SettingsGroup`/`SettingsRule`); reads real project fields; Sidebar wire;
   `settings.spec.ts`. *(dep: PR-0)*
5. **PR-4 Integrations** — `app/integrations` + `components/integrations` (dual-mode); reuses
   `SettingsTabs`; add to nav; `integrations.spec.ts`. *(dep: PR-0, PR-3 for shared tabs)*
6. **PR-5 agent-pool wsMode** — small: teach the existing agent-pool view to accept `wsMode` so
   Workspace can host it. *(dep: existing agent-pool)*
7. **PR-6 Workspace** — `app/workspace` + `components/workspace`; reuses Settings primitives + renders
   wsMode Integrations + wsMode agent-pool; nav wire; `workspace.spec.ts`.
   *(dep: PR-3 Settings, PR-4 Integrations, PR-5 agent-pool wsMode)*
8. **PR-7 Meetings** — `app/meetings` + `components/meetings` (5 detail variants + `Highlight`
   popover + `sampleContent.ts`); Sidebar wire; `meetings.spec.ts`. *(dep: PR-0)*
9. **PR-B1 Settings/Workspace persistence backend** — project-automations + workspace-settings API +
   client swap + pytest/Playwright. *(dep: PR-3, PR-6)*
10. **PR-B2 Meetings backend** — ingest/extraction API + swap. *(dep: PR-7)*
11. **PR-B3 Feedback backend** — clustering API + swap. *(dep: PR-2)*
12. **PR-B4 Integrations backend** — connections API + swap. *(dep: PR-4)*
13. **PR-B5 CLI logs backend (optional, lowest priority)** — real logs into the colorizer. *(dep: PR-1)*

PRs 1–8 are independent except where noted and can be parallelized after PR-0 (with PR-4→PR-6 and
PR-3→PR-4/PR-6 ordering). Backend PRs (B1–B5) follow their screen and are independent of each other.
