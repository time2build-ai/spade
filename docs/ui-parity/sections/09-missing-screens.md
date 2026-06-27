# Missing/unbuilt screens build-specs

Reference: the Spade HTML reference app (`scratchpad/modules/*.js`). This section specs the six
reference screens our PoC most likely has **not** built, so they can be built to match.

**Verification of our app (`apps/client`):**
- Routes that exist (`app/*/page.tsx`): `page` (home), `backlog`, `decisions`, `dev-tokens`, `gate`,
  `brain`, `orchestrator`, `agent-pool`, `task/[id]`. No `meetings`, `feedback`, `cli`,
  `integrations`, `settings`, or `workspace` route exists.
- Component dirs (`components/`): `agentpool`, `ask`, `backlog`, `brain`, `decisions`, `gate`,
  `orchestrator`, `shell`, `task`, `ui`. No `meetings/`, `feedback/`, `cli/`, `integrations/`,
  `settings/`, `workspace/` dirs. `find` for any `*meeting* / *feedback* / *cli* / *integration* /
  *setting* / *workspace*` file returns nothing.
- Sidebar (`components/shell/Sidebar.tsx`): **Meetings**, **Feedback**, **CLI / logs**, **Settings**
  all have `href: "#"`, which the sidebar renders as disabled "coming soon" items (`const soon =
  item.href === "#"`). **Integrations** and **Workspace** are not in the nav at all (the project
  switcher notes "All projects (workspace scope) not yet built — see docs/backlog").

**Shared tokens** (reference `inner.html`): bg `#0b0b0d`, text `#ecedef` / `#b9bac1` / `#82838c`,
accent `#c9b8ff` / `#8e7dff`. Other status tokens used across these screens: `--green` (#7adcc7-ish
positive), `--red` (negative), `--amber` (#e6b86a warn/decision), `--blue` (bug/info). Fonts:
Instrument Serif (display, `.serif`), Inter Tight (sans, default), JetBrains Mono (mono, `.mono`).
Common shell classes reused everywhere: `.page-head` + `.breadcrumb` + `.page-head-right`,
`.btn`/`.btn.ghost`/`.btn.primary`/`.btn.xs`, `.filter-bar` + `.seg` (segmented toggle),
`.fade-in`, `.chip`, `.sb-label` (uppercase section label), `.avatar`, `.muted`.

---

## Meetings  (status in our app: NOT IMPLEMENTED — sidebar item `Meetings` has `href:"#"`, no route/components/data)
Reference: `modules/mod_17.js` (`MeetingsView`). The richest of the six — a list view plus **five
distinct detail layouts** keyed by ingest "fidelity".

### Reference layout & components
**List view** (top-level):
- `.page-head`: breadcrumb `**Meetings** · {N} ingested · last 14 days`. Right side: ghost button
  `🔗 Connected sources`, solid button `🎙 Upload transcript`.
- `.filter-bar`: label `Source`, then a `.seg` segmented control `All` + one button per distinct
  source (granola / fathom / otter / fireflies / zoom). Far right, muted note (key product
  positioning copy): *"Spade **does not record** meetings — it ingests from your existing AI
  notetakers."*
- `.list-wrap` of `.meeting-row` (clickable → opens detail). Each row:
  - `.avatar` (30px) showing up to 2 capital letters from the title.
  - Title (13.5px, 500) + inline **FidelityBadge**.
  - Meta line (muted, 11.5px): `.source-badge` (colored per source) · date · duration ·
    `{participants} participants` · optional italic serif `note`.
  - Right-aligned mono extract counts: `<accent>{tasks}</accent> tasks · <amber>{decisions}</amber>
    decisions · <text-3>{questions}</text-3> Q`. If `status==="processing"` show accent
    `processing…`; else `—`.
  - Trailing ghost `Open ›` button.

**FidelityBadge** (`.fid-badge fid-{tone}`): icon + label. Map (`FIDELITY_META`):
`transcript`→"Transcript"/mic/ok, `summary`→"Summary only"/doc/warn,
`outcomes_only`→"Outcomes only"/check/warn, `metadata_only`→"Calendar only"/cal/stale,
`processing`→"Processing"/spark/info. If `status==="skipped"` render a muted `.chip` "skipped".

**Detail view** (`MeetingDetail`): `.page-head` breadcrumb `Meetings / **{title}**` (the "Meetings"
crumb is the back button). Right side: `.source-badge`, FidelityBadge, `Open in {source} ↗`, and —
only for transcript/summary — primary `✨ Re-extract`. Body switches on fidelity:

1. **transcript** (`DetailTranscript`) — two-column `.meeting-grid`:
   - Left `.transcript`: header `● Full transcript · {N} participants · diarized` + mono duration.
     Then diarized `.turn` rows (avatar 24px, name `.who`, timestamp `.ts`, body). Body text contains
     inline `<HL>` highlight marks (see below).
   - Right `.extract`: header `✨ Triage agent extracted 4 items`, then `ExtractCard` list.
2. **summary** (`DetailSummary`) — `SummaryBanner` ("Summary only — no transcript available") +
   `.meeting-grid`. Left is a `.summary-list` of bulleted items (bullet glyph `✓`/`?`/`·` by kind
   decision/question/other) with attribution. Right `.extract` shows a "lower confidence" chip and a
   dashed-border caveat: *"Without a transcript, Spade can't quote the exact source line…"*, then
   ExtractCards sourced from "AI summary".
3. **outcomes_only** (`DetailOutcomes`) — banner "Action items only — no transcript or summary".
   Either an `.empty-detail` ("No action items recorded…") or `{N} action items imported` +
   ExtractCards.
4. **metadata_only** (`DetailMetadata`) — banner ("Skipped — private meeting" if skipped, else "No
   notes captured") + a `.meta-card` definition list (`Title / When / Duration / Participants /
   Source`) + closing copy about connecting a notetaker.
5. **processing** (`DetailProcessing`) — banner "Extraction in progress" + skeleton rows
   (`.skel-row`, `.skel-card`).

**HL (highlight)** — inline `<mark className="hl {kind} hl-{kind}">` with a hover/focus popover.
Kinds (`KIND_META`): `fb`=Feedback signal/green/flag, `b`=Bug mention/blue/flag,
`f`=Feature mention/accent/spark, `d`=Decision flag/amber/doc. Popover (`.hl-pop`, 320px,
auto-flips above/below based on viewport position) shows: colored header (icon + kind label + the
quoted text), a `reason` body (the agent's rationale), and a footer that is either: a **linked task**
row (prio dot + mono id + title + arrow, plus a "Already tracked — re-extract won't duplicate" lock
note) OR a primary `+ Create task from this` button with `⌘K to dismiss` hint. The task link fires
`window.dispatchEvent(new CustomEvent('spade:nav',{detail:'task'}))`.

**ExtractCard** (`.extract-card`): dot (color) + `.x-type` label (e.g. "Task created · P0"), `<h4>`
title, optional `.links` chips (`[kind,value]` → `.chip {kind}`), optional amber `warning` box,
optional muted `note`, and `.x-from` footer = italic serif quote + `— speaker`. Whole card clickable
when `goto` provided.

### Data shown
`window.SpadeData.meetings` (10 records). Shape:
`{ id, title, source, duration, date, participants, extracted:{tasks,decisions,questions}, status, fidelity, note?, summarySource?, processingNote? }`.
Statuses: `ingested | processing | skipped`. Fidelities cover all 5 detail variants (sample data has
one of each). The transcript turns, HL highlights, and ExtractCards in `DetailTranscript`/
`DetailSummary` are **hard-coded in the component**, not in the data — to build faithfully you can
keep them as static sample content keyed by meeting id, or wire to a real extraction payload.

### Interactions/states
- Row click → detail (`openId`). Breadcrumb "Meetings" → back. Source `.seg` filter (`all` + each
  source). HL marks: hover/focus opens popover (120ms close grace; cancels on popover hover);
  popover repositions on open via `getBoundingClientRect`. Create-task button (stub). Re-extract
  button (stub). Detail body entirely driven by `fidelity`.

### Component breakdown to build (suggested React components + props)
- `MeetingsView` — owns `openId`, `sourceFilter`.
- `MeetingRow({ meeting, onOpen })`
- `FidelityBadge({ fidelity, status })`
- `MeetingDetail({ meeting, onBack })` → dispatches to:
  - `MeetingDetailTranscript({ meeting, turns, extracts })`
  - `MeetingDetailSummary({ meeting, summary, extracts })`
  - `MeetingDetailOutcomes({ meeting, extracts })`
  - `MeetingDetailMetadata({ meeting })`
  - `MeetingDetailProcessing({ meeting })`
- `SummaryBanner({ title, body, actions:[{label,icon}] })`
- `ExtractCard({ label, color, title, from, speaker, chips, note, warning, onClick })`
- `Highlight({ kind, reason, task, children })` (the HL popover — reusable; consider sharing with
  brain/decisions evidence popovers)
- `SourceBadge({ source })`

### Severity / effort: **L** — five detail variants + a non-trivial auto-positioning highlight
popover + the list. Highest single-screen cost after Integrations.

---

## Feedback  (status in our app: NOT IMPLEMENTED — sidebar item `Feedback` has `href:"#"`, no route/components/data)
Reference: `modules/mod_07.js` (`FeedbackView`). Master/detail: cluster list ↔ cluster detail with
quotes and source breakdown.

### Reference layout & components
- `.page-head`: breadcrumb `**Feedback** · 312 items · clustered into {N} themes`. Right:
  `.topbar-pill` "Intercom · Zendesk · App Store · Play", solid `Re-cluster`.
- `.filter-bar`: `.seg` time range `Last 30d` / `This sprint` / `All time`. Far right muted
  sentiment legend: `● pos` (green) `● neg` (red) `● request` (accent).
- `.feedback-grid` two columns:
  - **Left `.feedback-side`** — list of `.feedback-cluster` (active state on select). Each:
    sentiment dot + label (13px) + mono count; second line: a `.chip.feature` (feature tag) and a
    mono trend (`+5 / 7d` red if rising, else text-3); a `.cluster-srcs` row of `SourceMark`
    (platform short code + count); and if linked, mono `→ linked {taskId}`.
  - **Right `.feedback-detail`** — `<h2>` label + `· {count} reports`; chip row (feature, sentiment
    colored, mono trend); right-aligned action: if `linkedTask` show a `.fbq-locked-row` ("Already
    tracked — auto-triage won't create a duplicate" + button to the task) else primary
    `+ Create task from this cluster`.
    - **Source breakdown** (`.src-breakdown`): header + a stacked proportional bar (`.src-seg`
      flex-weighted by count, colored per platform) + a legend (`.src-legend-item`: dot + platform
      name + mono count).
    - **Quotes** section (`.section-h` "Quotes · showing {n} of {count}") → `FeedbackQuote` list.
    - **What Spade did** section: a `.card` with an AI `◆` avatar describing how N reports were
      mapped to the feature and rolled into the backlog item.

**FeedbackQuote** (`.fbq`): source line = `SourcePill` (platform) + author + mono `when` + `· meta`
+ mono id + open-in-platform icon button; the quote in italic serif (`.fbq-text`); actions row —
if cluster already linked: "Rolled into {taskId}" lock + `View task ›`; else ghost `attach to
existing task` + primary `+ Create task from this quote`.

**Platform helpers** (`PLATFORM_META`): intercom/zendesk/appstore/playstore/email/twitter, each with
`label` + 2-char `short` + glyph. `SourcePill` = full pill (short mark + label), `SourceMark` =
compact (short + count). Color classes `.src-bg-{platform}`.

### Data shown
- `feedbackClusters` (7): `{ id, label, feature, count, sentiment(pos|neg|feature), trend, linkedTask|null, breakdown:[[platform,count],…] }`.
- `feedbackQuotes` (keyed by cluster id; sample only populates `fc-1`, `fc-2` — others fall back to
  `fc-1`): `{ q, platform, author, when, meta, id }`.

### Interactions/states
- Cluster select (`sel`, default `fc-1`). Linked vs unlinked cluster → different action row +
  per-quote action set. Time-range `.seg` (visual only in reference). Create/attach buttons stub.
  `goto('task')` from linked rows.

### Component breakdown to build
- `FeedbackView` — owns `selectedClusterId`, `timeRange`.
- `ClusterListItem({ cluster, active, onSelect })`
- `ClusterDetail({ cluster, quotes })`
- `SourceBreakdown({ breakdown, total })` (stacked bar + legend)
- `FeedbackQuote({ quote, clusterLinkedTask })`
- `SourcePill` / `SourceMark` ({ platform, count? }) + a `platformMeta` map module.

### Severity / effort: **M** — single list+detail, one stacked-bar viz, lots of platform styling, but
no mode-switching or deep variants.

---

## CLI / logs  (status in our app: NOT IMPLEMENTED — sidebar item `CLI / logs` has `href:"#"`, no route/components/data)
Reference: `modules/mod_13.js` (`CliView`). A faux terminal: recent-runs sidebar + a colorized log
transcript pane. Simplest of the six.

### Reference layout & components
- `.page-head`: breadcrumb `**CLI** · <mono muted>~/.spade</mono>`. Right: ghost `Copy session ID`,
  `Open in terminal`, primary `⌨ Spawn shell`.
- `.cli-wrap` two columns:
  - **`.cli-side`** — `.sb-label` "Recent runs", then a `.cmd` row per `cliRuns` entry (command text
    + status glyph `✓`/`✗`/`●` colored green/red/blue; sub-line mono `{ts} · {who}`); active row
    highlighted. Then `.sb-label` "Quick commands" with a fixed list (`run --sprint`, `run --task`,
    `brain init`, `brain ingest`, `brain status`, `brain search`, `task list`, `task next`,
    `sessions`, `sync --jira`, `config set`) each rendered as muted `spade` + command.
  - **`.cli-main`** — renders the selected command's log block line-by-line, plus a trailing blinking
    prompt `$ ▌`. Each log line is a sequence of optional spans with distinct colors:
    `p` dim prompt prefix, `c` `.prompt` command, `d`/`d2` default text, `o` accent operand,
    `arg` `.arg` argument, `ok` green success, `err` red error.

### Data shown
- `cliRuns` (6): `{ ts, cmd, status(running|ok|err), who }`.
- Four hard-coded log blocks in the component: `run --sprint`, `brain ingest`, `brain status`,
  `sync --linear` (the last shows an auth-failed error path). Selecting a run/quick-command sets
  `active`; commands not having a block fall back to `run --sprint`.

### Interactions/states
- `active` block selection from either sidebar list. Running/ok/err glyph coloring. Static blinking
  cursor. Top-right buttons are stubs.

### Component breakdown to build
- `CliView` — owns `activeCommand`.
- `RunListItem({ run, active, onSelect })`
- `QuickCommand({ command, onSelect })`
- `LogBlock({ lines })` + `LogLine({ line })` (the multi-span colorizer)
- A `cliBlocks` data module (or generate from real run logs later).

### Severity / effort: **S** — static layout, one colorizer, no real terminal. Mostly styling +
sample data.

---

## Integrations  (status in our app: NOT IMPLEMENTED — no nav item, no route/components/data; workspace scope explicitly "not yet built")
Reference: `modules/mod_05.js` (`IntegrationsView`). The most structurally complex: **dual-mode**
(project scope vs workspace scope, `wsMode` prop), reacts to project switching, groups integrations
by category, and renders multi-connection cards with scope tags, health states, usage dots, and
per-project toggles.

### Reference layout & components
- **Project mode** (`!wsMode`): `.page-head` breadcrumb `**{project.name}** / Integrations · {N} in
  use`; right: ghost `Sync now`, primary `+ Add private connection`. Then a `.settings-tabs` bar
  (`Automations` → settings, `Agents` → accounts, **`Integrations`** active). This screen shares the
  tab strip with Settings and the Agents/Accounts pool.
- **Workspace mode** (`wsMode`, rendered inside `WorkspaceView`): no page-head/tabs (the workspace
  shell provides them).
- **`.int-banner`** — context banner. Project mode: project glyph + "Integrations for {project}" +
  copy on inherited workspace connections vs private ones. Workspace mode: link icon +
  "Workspace-shared connections" + counts of shared vs project-local.
- **Category groups** — `[...new Set(cat)]`: `Meetings`, `Feedback`, `Code`, `PM`, `Observability`,
  `Analytics`. Each: `.sb-label` category header + `.int-stack` of `IntegrationTypeCard`. Visibility
  differs by mode (workspace shows all incl. unconnected; project shows only those with a workspace
  or this-project connection, plus unconnected types so you can add).

**IntegrationTypeCard** (`.int-type-card has|empty`):
- Header: `.int-icon` (integration `mark` glyph, tinted by `color`), name + optional pills
  (`in use here` project mode, `{n} connections` workspace mode), `cat · desc` subline, and an action
  button (`+ Add connection` workspace / `+ Add private` project).
- If it has connections, an `.int-conn-list` of `.int-conn {status}` rows, each:
  - `.int-conn-id`: connection label + mono identity.
  - `.int-conn-scope`: either a `workspace` scope-tag (graph icon) or a project scope-tag (project
    glyph + name, tinted by project color).
  - `.int-conn-usage`: workspace mode → `UsageDots` (per-project glyph chips, +N overflow);
    project mode → `.int-state-pill` healthy/needs attention/stale.
  - `.int-conn-meta`: mono `last` sync; project mode + workspace-scoped connection → a `toggle-pill`
    to enable/disable for this project; gear `Configure` icon button.
- If empty: "Not connected." + `Connect {name}` button.

**UsageDots({ projects, projectsById })** — up to 5 project glyph chips (tinted) + `+N`; tooltip
lists project names; "not used yet" when empty.

### Data shown
`integrations` (12) with shape
`{ id, name, cat, connected, mark, color, last, desc, connections:[ { id, label, identity, scope("workspace"|projectId), status("healthy"|"warn"|"stale"), last, usedBy:[projectId] } ] }`,
and `projects` (for scope tags, usage dots, current project). Listens to
`window.addEventListener('spade:project-changed', …)` to re-render on project switch.

### Interactions/states
- Reads/sets `project` from `window.SpadeProject` and the `spade:project-changed` event.
- `wsMode` toggles entire layout (header/tabs vs none; visible set; usage vs health; toggle pills).
- Per-connection: health state class, scope tag, enable/disable toggle (project mode, workspace
  connection only), configure (stub). Tabs route via `goto('settings'|'accounts'|'integrations')`.

### Component breakdown to build
- `IntegrationsView({ wsMode })` — owns `project` (subscribed to project-changed).
- `SettingsTabs({ active, onNavigate })` (shared with Settings — see below).
- `IntegrationBanner({ wsMode, project, totals })`
- `IntegrationTypeCard({ integration, wsMode, project, projectsById })`
- `ConnectionRow({ conn, wsMode, project, projectsById })`
- `ScopeTag({ scope, project })`, `UsageDots({ projectIds, projectsById })`,
  `ConnectionStatePill({ status })`, `TogglePill({ on, onToggle, disabled })` (shared with Settings).

### Severity / effort: **L** — dual-mode rendering, project-switch wiring, multi-connection cards with
scope/usage/health/toggle permutations, plus it's the entry point for the shared Settings/Agents/
Integrations tab strip and the Workspace shell. **Largest build of the six.**

---

## Settings (project Automations)  (status in our app: NOT IMPLEMENTED — sidebar item `Settings` has `href:"#"`, no route/components/data)
Reference: `modules/mod_16.js` (`SettingsView`). Per-project automation rules grouped into sections,
each a toggle row; reacts to project switching and shows per-project defaults.

### Reference layout & components
- `.page-head`: breadcrumb = project glyph + `**{project}** / Settings / Automations`. Right: ghost
  `[graph] Workspace settings` (→ `goto('workspace')`), ghost `Reset to defaults`, primary
  `All changes saved ✓`.
- `.settings-tabs`: **`Automations`** active, `Agents (project)` → accounts, `Integrations` →
  integrations. (Same tab strip as Integrations.)
- `.settings-wrap`:
  - `.scope-banner` — project-tinted `project scope` pill + copy ("These settings only affect
    {project}. Switching projects… will load that project's automations.") + ghost
    `Workspace-wide settings →`.
  - `.settings-intro` — serif headline "Automations for {project}." + paragraph, plus a
    `.settings-summary` of three `.summary-stat` tiles: `{on}/{total}` rules on, project glyph/slug,
    amber `4` Hard gates active.
  - Four `.settings-group` sections, each a header (`<h3>` + `<p>`) and a `.settings-rules` list of
    `.settings-rule on|off`:
    1. **Promote to backlog** (`task_from_meeting`, `task_from_feedback`, `task_from_bugs`)
    2. **Pipeline execution** (`auto_run`, `auto_review`, `auto_merge`, `auto_doc`)
    3. **Human gates** (`gate_adr_conflict`, `gate_security`*, `gate_schema`, `gate_p0`,
       `gate_first_deploy`) — `gate_security` is `mandatory` (disabled toggle, `required` tag)
    4. **Spend & limits (this project)** (`daily_cap` $25, `per_task_cap` $1.50, `concurrency` 8,
       `working_hours` 09–18 PT) — these carry a `knob` value shown as a mono pill when on.
  - `.settings-footer` — italic serif aphorism "Automate the mechanics, keep the judgement."

**Settings rule row** (`.settings-rule`): a `TogglePill` (`.toggle-pill on`, `.thumb`); body =
`.sr-label` (label + optional `required` tag + optional mono `knob` when on) + `.sr-desc`; when the
rule is **off** and has `manualWhereUsed`, a `.sr-manual` hint ("Manual action available in
**{location}**"); right `.sr-state` pill: `● auto` (on) / `○ manual` (off). Mandatory rules can't be
toggled.

### Data shown
Rule groups are defined in-component (`projectGroups`). Per-project default overrides live in
`projectDefaults` keyed by project id (`acme`/`mobile`/`tools`/`labs`) — e.g. Internal Tools runs
full-auto, Mobile gates everything. State is held per project (`stateMap[`proj:{id}`]`), seeded from
defaults, recomputed live from `window.SpadeData.projects` current project + `spade:project-changed`.

### Interactions/states
- Toggle each non-mandatory rule (updates per-project state). `onCount/totalCount` live in the
  summary tile. `knob` pill appears only when rule is on; `manual` hint only when off. Project switch
  reloads that project's toggle state. Tab + workspace buttons navigate.

### Component breakdown to build
- `SettingsView` — owns per-project `stateMap`; subscribes to project-changed.
- `SettingsTabs` (shared with Integrations), `ScopeBanner({ project, onWorkspace })`,
  `SettingsSummary({ on, total, project })`
- `SettingsGroup({ group, state, onToggle })` → `SettingsRule({ rule, on, onToggle })`
- `TogglePill({ on, disabled, onToggle })` (shared)

### Severity / effort: **M** — straightforward grouped toggle list, but real per-project state
seeding + project-switch wiring + the shared tab strip add weight. Data model is mostly static.

---

## Workspace  (status in our app: NOT IMPLEMENTED — no nav item; project switcher notes workspace scope "not yet built")
Reference: `modules/mod_09.js` (`WorkspaceView` + `WorkspaceSettingsPanel`). The workspace-scope
shell: its own header + a 3-tab strip that hosts global settings, the agents pool (workspace mode of
AccountsView), and integrations (workspace mode of IntegrationsView).

### Reference layout & components
- `.ws-shell-head` — `.ws-mark` graph glyph + `.ws-title` "Workspace" + sub "Settings, agents and
  integrations shared across **{N} projects**"; right ghost `← Back to home` (`goto('home')`).
- `.ws-tabs` — three `.ws-tab` buttons (active state):
  - **Settings** (cog)
  - **Agents pool** (spark) + `.ws-tab-count` = `accounts.length` → renders `window.AccountsView`
    with `wsMode={true}`.
  - **Integrations** (link) + count = connected integrations → renders `window.IntegrationsView`
    with `wsMode={true}`.
- Body switches on `tab` (default `settings`, can be preset via `window.SpadeWorkspaceTab`).

**WorkspaceSettingsPanel** — same `.settings-wrap` / `.settings-group` / `.settings-rule` vocabulary
as the project Settings screen, but workspace-global state (single `stateMap`, no per-project keying):
- `.ws-banner` — graph icon + "Workspace-wide settings" + copy ("These apply across {N} projects…")
  + `.ws-projects-strip` of project glyph chips.
- `.settings-intro` serif headline "The defaults that govern your whole workspace." + summary tiles
  (`{on}/{total}` rules on, `{N}` projects affected, green `$48` today · $250 cap).
- Four groups:
  1. **Ingestion** (`meet_ingest`, `meet_extract`, `feedback_cluster`, `bug_extract`)
  2. **Notifications** (`notif_gate` knob "DM", `notif_p0` "DM", `notif_shipped`, `notif_daily`
     "09:00 PT", `notif_account`)
  3. **Workspace spend caps** (`global_daily` "$250", `global_monthly` "$4,000", `prefer_byo`)
  4. **CLI defaults** (`sandbox`, `redact_logs`* mandatory/required, `telemetry`)
- `.settings-footer` aphorism "Workspace sets the floor. Each project picks its own ceiling."

### Data shown
`window.SpadeData.projects` (count + glyph strip), `accounts` (tab count), `integrations` (connected
count). Rule groups static in-component. Knob values shown as mono pills when on.

### Interactions/states
- `tab` state (settings/agents/integrations), seeded from `window.SpadeWorkspaceTab`. Toggle rules
  (single global state map; `redact_logs` mandatory). Agents/Integrations tabs delegate to the
  `wsMode` variants of those views — so Workspace cannot be fully built until AccountsView/agent-pool
  and IntegrationsView support `wsMode`.

### Component breakdown to build
- `WorkspaceView` — owns `tab`; renders header + `WorkspaceTabs` + body.
- `WorkspaceTabs({ tab, onChange, counts })`
- `WorkspaceSettingsPanel({ projects })` — reuses `SettingsGroup`/`SettingsRule`/`TogglePill`.
- `WorkspaceBanner({ projects })`, `SettingsSummary` (shared with Settings).
- Depends on: `IntegrationsView({ wsMode })` and our agent-pool/AccountsView gaining a `wsMode`.

### Severity / effort: **M** (its own code) but **L in practice** — it's a thin shell that *requires*
the workspace (`wsMode`) variants of Integrations and the agents pool to exist. Sequence after
Integrations.

---

## Build order suggestion
1. Shared primitives first: `TogglePill`, `SettingsGroup`/`SettingsRule`, `SettingsTabs`,
   `SourcePill`/`SourceMark`, the `Highlight` popover, project-switch subscription helper.
2. **CLI** (S) — fastest win, no shared deps.
3. **Feedback** (M) — self-contained.
4. **Settings** (M) — establishes the tab strip + per-project state pattern.
5. **Integrations** (L) — biggest; also unlocks workspace mode.
6. **Workspace** (M/L) — depends on Integrations + agents `wsMode`.
7. **Meetings** (L) — largest single screen; five detail variants + highlight popover.
