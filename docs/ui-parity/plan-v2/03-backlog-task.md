# Backlog + Task — full-parity plan

Reference: `docs/Spade (standalone).html` (decompiled in scratchpad as
`modules/mod_11.js` = BacklogView + TaskCard, `modules/mod_08.js` = TaskView,
`modules/mod_01.js` = SpadeData, `inner.html` = CSS).
Ours: `apps/client/app/backlog/page.tsx`, `components/backlog/{Board,TaskCard,BlockedBanner}.tsx`;
`app/task/[id]/page.tsx`, `components/task/{OriginCard,EvidenceSection,MetaRow,TimelineRail,Relations}.tsx`;
tokens + CSS in `app/globals.css`.

Goal (changed): **FULL visual + data parity** with the reference, **including the
rich demo data**. Wire real API fields where they exist; **SEED** the rest from a
demo layer that mirrors the reference `SpadeData` shape; flag genuinely-missing
backend capabilities as **BACKEND-FEATURE** with a follow-up PR + a validation
test that asserts the seam. Earlier sparse "honest empty state" subsets were
**wrong** for this goal — we now build the complete rich UI and feed it seed data
keyed off the real task so it is internally consistent.

---

## Target

Pixel/structure parity with the reference for two surfaces:

### A. Backlog board (`mod_11`)
- Page head: breadcrumb `Backlog · Sprint 26 · acme/web-app` form (context, not an
  `<h1>`) + 3 right actions: **Filter** (ghost, search icon), **Suggest priority**
  (spark icon), **Run sprint** (primary, play → `/orchestrator`).
- **Blocked banner** above the grid (amber gradient card): `⚠`, `<b>{id}</b> · {title}
  — paused at review. Reviewer flagged conflict with [ADR-014 chip]`, right-aligned
  **Open gate →** (→ `/gate`). Only when a `blocked` task exists.
- **4 full-height columns** (`ready`/`in_progress`/`review`/`shipped`; blocked is
  NOT a column). Column boxes **fill the viewport height** like the reference
  (`.backlog-grid { height: calc(100% - …); }`, `.col-body { overflow-y:auto; flex:1 }`)
  — fixing the current "too short/tight" columns.
- **Rich `TaskCard`**: priority dot + id + feature; `<h4>` title; `.intel-bar` with
  the **5-type set in reference order** (feedback·bug·decision·meeting·metric),
  omitted when empty; `.tc-meta` chips with reference wording (`N feedback`,
  `N bug`, `N ADR`, `N mtg`, `metric`); `.tc-foot` assignee **avatar** (AI `◆` /
  human initials / dashed `·` placeholder) + green-dot **`building`** indicator
  when AI & in_progress + amber **flag** text.

### B. Task detail (`mod_08`) — the COMPLETE rich layout
- Head: breadcrumb `Backlog / {id}` + status chip (`● {status}`) + **View in graph**
  (→ `/brain`) + **Resume pipeline** primary (→ `/orchestrator`). *(already present)*
- `.td-main` (left), in order:
  1. `.td-meta-row`: `[P0 dot] P0 critical` chip + feature chip + muted-mono
     `created from {origin} · {age}`.
  2. `<h2.td-title>`.
  3. **`.origin`**: eyebrow + serif blockquote + `.src` = speaker avatar +
     `{speaker} · {mono source}` + right-aligned `↗ transcript` chip.
  4. **User justification** (`.section-h` + `12 reports · 30d`) → **`.feedback-strip`**
     (4 `.fb-stat` tiles) → **`.quote-card`** list (italic quote + `— src`).
  5. **Architectural context** (`{n} ADR · 1 convention`) → decision `.link-row`s
     (amber doc icon, `id · title`, note sub, `.lr-meta` date) + a convention
     `.link-row` (pink link icon, `47 files`).
  6. **Connected bugs** (`{n} likely root-caused by this task`) → bug `.link-row`s
     (red flag icon, `auto-linked`).
  7. **Pipeline history** → `.card` wrapping `.timeline` (4 `.tl-item`s, last `.now`).
- `.td-side` (right rail):
  - **Properties** `.meta-row`s: Status / Priority / Feature / Assignee (◆ avatar) /
    Sprint / Estimate / Branch.
  - **Tracked metric** card: big value + `target X%` + label + `<Sparkline/>` +
    mono trend (`↓ 4.2pp / 30d`).
  - **Will write back** muted prose naming bugs it will resolve.

---

## Current state

**Backlog** (mostly there; needs richness + full-height + seed):
- `app/backlog/page.tsx`: uses `<PageHead title="Backlog">` (an `<h1>`, **not** the
  `Backlog · Sprint 26 · slug` breadcrumb). Only **Run sprint** action wired (Filter
  / Suggest-priority deferred). `BlockedBanner` already rendered.
- `Board.tsx`: **4 columns already correct** (blocked excluded). `.backlog-grid`
  currently `align-items: start` (no height) → **columns size to content, too short**.
- `TaskCard.tsx`: intel-bar uses the **wrong type set** (feature·decision·feedback·
  bug·metric·convention — has `convention`/`feature`, **missing `meeting`**),
  renders an **empty placeholder bar** when no links (ref omits it), chip wording is
  literal (`2 decision` vs ref `2 ADR`), footer **always** shows dashed `·` +
  "unassigned" (no AI ◆, no `building`, no flag).
- `BlockedBanner.tsx`: real id + title but **omits** the "paused at review · conflict
  with ADR-014" narrative + the ADR chip.

**Task detail** (TOO SPARSE — the main gap):
- Head actions already present ✓. `.td-meta-row` shows raw `task.id` instead of
  `created from … · age`. `OriginCard` lacks speaker + `↗ transcript` chip.
- Evidence is **6 generic `EvidenceSection`s** (Decisions/Bugs/Feedback/Metrics/
  Conventions/Features) with **"No linked X" empty states** and **no `.lr-meta`**
  right column. **Missing entirely**: `.feedback-strip`, `.quote-card`, the
  "User justification / Architectural context / Connected bugs / Pipeline history"
  framing, and the convention link-row.
- `Relations` ("Dependencies") section exists — **not in the reference at this spot**;
  keep but move below Pipeline history (or behind a flag) so it doesn't break the
  reference order.
- Rail Properties = **ID / Feature / Priority / Status / Created** (ref =
  Status/Priority/Feature/Assignee/Sprint/Estimate/Branch). **Missing**: Tracked-metric
  card + Sparkline, Will-write-back prose. Activity (`TimelineRail` from real comments)
  lives in the rail; ref puts pipeline history in the main column.

**CSS present** in `app/globals.css`: `.task-detail/.td-main/.td-side`, `.origin`,
`.section-h`, `.link-row/.lr-icon/.lr-title/.lr-sub/.lr-meta`, `.section-empty`,
`.rel-*`, `.meta-row`, `.timeline/.tl-item`, `.backlog-grid/.col/.col-head/.col-body`,
`.task-card/.tc-*/.intel-bar`, `.agent-running`, `.chip.*`, `.priority.*`, `.avatar.ai`.
**CSS MISSING** (must port from `inner.html`): `.feedback-strip`, `.fb-stat`,
`.quote-card` (+ `.q`/`.src`). (`.backlog-grid` needs a height fix, not a new rule.)

**Backend Task model** (`apps/api/tui_pilot/tasks.py`, serialized in `lib/types.ts`):
REAL fields = `id, project_id, title, feature, priority, status, origin_quote,
origin_source, description, created_at, nodes[] (grounded brain-node ids), links[]`.
NO `assignee, sprint, estimate, branch, metric, feedback stats, verbatim quotes,
pipeline history`. `comments` endpoint exists (drives the timeline).

---

## Build steps

> Strategy: one **demo seed layer** (`lib/demo.ts`) mirrors the reference SpadeData
> shapes and is **keyed off the real task** (id/title/feature/priority/status/nodes
> are passed in; seed only *augments*). Components consume a single merged
> `TaskView` view-model so swapping seed → real later is a one-line change per field.

### Step 0 — Demo seed layer + view-model  *(new: `lib/demo.ts`, `lib/taskView.ts`)*
- `lib/demo.ts`: export typed seed mirroring `mod_01` SpadeData:
  - `SeedAssignee = { name: string; ai: boolean }`
  - `SeedLinkCounts = { feedback; bugs; decisions; meetings; metrics }` (for intel-bar)
  - `SeedFeedbackStat = { value: string; label: string; tone: "bad"|"good" }`
  - `SeedQuote = { q: string; src: string }`
  - `SeedDecision = { id; title; date; note }`, `SeedBug = { id; title }`
  - `SeedTimelineItem = { text: ReactNode|string; when: string; now?: boolean }`
  - `SeedMetric = { value; target; label; trend; points: number[] }`
  - `SeedProps = { sprint; estimate; branch }`
  - `SeedWriteBack = string` / `{ bugs: string[]; prose: string }`
  - A `DEMO_TASKS: Record<string, TaskSeed>` map keyed by real task id, plus a
    **deterministic fallback generator** `seedForTask(task)` so every task (not just
    SPD-142) gets internally-consistent rich data derived from its real
    `nodes`/`feature`/`priority`/`status`. Mirror `mod_01.tasks[SPD-142]` exactly for
    the canonical task.
- `lib/taskView.ts`: `buildTaskView(task, nodesById, comments, seed)` → a single
  view-model exposing `{ meta, origin, justification:{stats,quotes}, architecture:
  {adrs,convention}, bugs, pipelineHistory, properties, metric, writeBack }`. Each
  field tagged with a `source: "api"|"seed"` so tests + future wiring can assert it.

### Step 1 — Port missing CSS  *(`app/globals.css`)*
Copy verbatim from `inner.html` (tokens already match):
```css
.feedback-strip { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:10px; }
.fb-stat { background:var(--bg-1); border:1px solid var(--line); padding:10px 12px; border-radius:7px; }
.fb-stat .num { font-size:20px; font-weight:600; letter-spacing:-0.02em; }
.fb-stat .num.bad { color:var(--red); }  .fb-stat .num.good { color:var(--green); }
.fb-stat .lbl { font-size:11px; color:var(--text-3); margin-top:2px; }
.quote-card { background:var(--bg-1); border:1px solid var(--line); border-radius:7px; padding:10px 12px; margin-bottom:6px; font-size:12.5px; }
.quote-card .q { color:var(--text-2); }
.quote-card .src { font-size:11px; color:var(--text-4); margin-top:5px; font-family:var(--mono); }
```
And **fix the column-height regression** so columns fill height (match `mod_11`):
```css
.backlog-grid { height: calc(100% - <page-head+banner offset>); overflow:hidden; }   /* drop align-items:start */
.col { overflow:hidden; }                 /* already flex column */
.col-body { overflow-y:auto; flex:1; }    /* add flex:1 + remove min-height clamp */
```
Use a `data-has-banner` attribute (or a CSS var) on `.backlog-grid` so the height
subtracts the banner row when present. Keep `.link-row` `cursor:pointer` + `:hover`
(reference has it; ours dropped the hover — re-add).

### Step 2 — Backlog page head  *(`app/backlog/page.tsx`)*
- Replace `<PageHead title="Backlog">` with the **breadcrumb-context** form
  (`PageHead` already supports `children`): `Backlog · Sprint {n} · {slug}`
  (`n` from seed sprint / `slug` from `projectSlug(project)`).
- Add the 3 actions: **Filter** (`btn ghost`, `search` icon — wire to a client-side
  status/feature filter; even a no-op-with-tooltip matches the reference visually),
  **Suggest priority** (`btn`, `spark` — **BACKEND-FEATURE** stub that opens the Ask
  dock prefilled, or disabled-with-title), **Run sprint** (`btn primary`, `play` →
  `/orchestrator`, already wired). Keep markup identical to `mod_11`.

### Step 3 — Rich `TaskCard`  *(`components/backlog/TaskCard.tsx`, `lib/adapters.ts`)*
- Intel-bar + chips: switch to `mod_11`'s segment set/order
  **feedback(blue)·bug(red)·decision(amber)·meeting(#c9c9c9)·metric(teal)** from
  `seed.linkCounts` (REAL counts where derivable from `task.nodes` by type; SEED
  `meetings` which has no node type). **Omit the bar when total===0** (delete the
  empty-placeholder branch). Chip wording → `N feedback` / `N bug` / `N ADR` /
  `N mtg` / `metric` (no count word), only non-zero, in that order.
- Footer: render `seed.assignee` via `<Avatar ai={a.ai}>` (`◆` for AI else 2-letter
  initials; dashed `·` when null). When `a.ai && task.status==='in_progress'` →
  `<span className="agent-running"><span dot/>building</span>`. Right side: amber
  `seed.flag` (e.g. `conflicts ADR-014`) when present.
- Add `linkCountsForTask(task, nodesById, seed)` to `lib/adapters.ts` (counts by
  node type + seed `meetings`).

### Step 4 — Blocked banner narrative  *(`components/backlog/BlockedBanner.tsx`)*
- Match `mod_11`: `<b>{id}</b> · {title} — paused at review.` +
  `Reviewer flagged conflict with` + `<span className="chip decision"><span className="d"/>{seed.conflictAdr}</span>`.
  `conflictAdr` from seed (the real blocked task's `flag`/seeded ADR ref). Keep
  **Open gate →** → `/gate`.

### Step 5 — Task detail main column  *(`app/task/[id]/page.tsx` + components)*
- `.td-meta-row`: trailing text → `created from {seed.createdFrom} · {age(created_at)}`
  (age REAL from `created_at`; the "sprint planning" label SEED).
- **`OriginCard`** (`components/task/OriginCard.tsx`): add the speaker segment
  (`{origin_source.split('·')[0]}` already → speaker; render `{speaker} · {mono source}`)
  + the right-aligned `↗ transcript` chip (`<span className="chip" title="Open transcript">↗ transcript</span>`).
  Keep serif blockquote. (Quote/source REAL from `origin_quote/origin_source`;
  transcript link is a SEED/BACKEND-FEATURE href.)
- **New `JustificationSection`** (`components/task/JustificationSection.tsx`):
  `.section-h` `User justification` + `{seed.reportCount} reports · 30d` → render
  `.feedback-strip` from `seed.feedbackStats` (4 `.fb-stat`, `.num.bad/.good`) then
  the `.quote-card` list from `seed.quotes`. (All SEED; mirror SPD-142 stats.)
- **New `LinkRows`** reuse: replace the 6 `EvidenceSection`s with two reference
  sections built from the merged view-model:
  - **`ArchitectureSection`**: `.section-h` `Architectural context` +
    `{adrs.length} ADR · 1 convention` → decision `.link-row`s (amber `doc` icon,
    `{id} · {title}`, `{note}` sub, **`.lr-meta` = date**) + the convention
    `.link-row` (pink `link` icon, sub "All new components must consume tokens…",
    `.lr-meta` = `47 files`). ADRs: prefer REAL `grouped.decision` brain nodes
    (`label`→title, `detail`→note); fall back to `seed.decisions`. Convention is SEED.
  - **`ConnectedBugsSection`**: `.section-h` `Connected bugs` +
    `{bugs.length} likely root-caused by this task` → bug `.link-row`s (red `flag`
    icon, sub "root-causes overlap — would resolve on merge", `.lr-meta` `auto-linked`).
    Prefer REAL `grouped.bug`; fall back to `seed.bugs`.
  - **Extend `EvidenceSection`/`link-row`** to accept an optional `meta` (right
    column) so we don't fork the markup — or add a small `LinkRow` primitive
    (`components/task/LinkRow.tsx`) consumed by both sections.
- **Pipeline history**: new `PipelineHistory` block — `.section-h` `Pipeline history`
  → `.card` > `.timeline`. Build items from `comments` (REAL) when present, else from
  `seed.timeline` (mirror the 4 `mod_08` items, last `.now` "live · 412 lines
  streamed"). Move the existing `TimelineRail` logic here (main column) and keep the
  rail's Activity only if comments exist.
- **Relations**: keep `Relations` but render it **after** Pipeline history (it's an
  extra, not in the reference); acceptable since it's driven by real `links` and adds
  value. (If strict order parity is required, gate it behind `links.length>0`.)

### Step 6 — Task detail right rail  *(`app/task/[id]/page.tsx`, new `Sparkline.tsx`)*
- Properties `.meta-row`s in reference order/content:
  - **Status** `● {status}` (dot color via existing `STATUS_COLOR`). REAL.
  - **Priority** `P{p} · {label}`. REAL.
  - **Feature** accent `{feature}`. REAL.
  - **Assignee** `<Avatar ai={a.ai} 16px>◆</Avatar> {a.name}`. SEED.
  - **Sprint** mono `{seed.sprint}`. SEED.
  - **Estimate** mono `{seed.estimate}` (e.g. `~25 min`). SEED.
  - **Branch** mono `{seed.branch}` (e.g. `spd/142-mobile-lcp`). SEED.
- **Tracked metric** card (`<h6>` + `.card`): big `{metric.value}` + muted
  `target {metric.target}` + label + **`<Sparkline points={metric.points}/>`** +
  mono trend colored by sign. New `components/task/Sparkline.tsx` ports `mod_08`'s
  `Sparkline` (pure SVG path from points, endpoint circle; default 220×36). SEED
  (prefer REAL `grouped.metric` node label for the metric name when present).
- **Will write back** (`<h6>` + muted prose): `seed.writeBack` paragraph naming the
  bugs it resolves (bold `<b>BUG-…</b>`). SEED / BACKEND-FEATURE.

### Step 7 — Wire seed selection
- In both pages, compute `seed = DEMO_TASKS[task.id] ?? seedForTask(task)` and build
  the view-model. Gate seed behind a `NEXT_PUBLIC_DEMO_SEED` flag (default **on** for
  this parity milestone) so production can later disable fabrication per field as the
  backend grows. Document the flag in the page header comment.

---

## Data sourcing

| Field / block | Source | Notes |
|---|---|---|
| Task id / title / feature / priority / status | **REAL** `api:tasks[].{id,title,feature,priority,status}` | never seeded |
| Grounded nodes (decisions/bugs/feedback/metric/feature) | **REAL** `api:tasks[].nodes` → `api:brainNodes` | resolve via `indexNodesById`; drive intel-bar/chip counts + ADR/bug link-rows |
| Origin quote / source | **REAL** `api:tasks[].{origin_quote,origin_source}` | speaker = `source.split('·')[0]` |
| Created age | **REAL** `api:tasks[].created_at` | `created from …` label is SEED |
| Comments → pipeline timeline | **REAL** `api:tasks/{id}/comments` | fall back to SEED timeline when empty |
| Task links → Relations | **REAL** `api:tasks[].links` | extra section |
| intel-bar `meeting` count | **SEED** `{ meetings: n }` | no `meeting` brain-node type exists |
| Assignee (◆ / name / building) | **SEED** `{ name, ai }` | BACKEND-FEATURE: no assignee column |
| Card flag / blocked-banner ADR ref | **SEED** `{ flag, conflictAdr }` | BACKEND-FEATURE: no gate-conflict link |
| `.feedback-strip` 4 stats | **SEED** `seed.feedbackStats[]` | mirror SPD-142 (12 / ★2.3 / 34% / 8.4s) |
| `.quote-card` verbatim quotes | **SEED** `seed.quotes[]` | BACKEND-FEATURE: no per-task feedback quotes endpoint |
| ADR `.lr-meta` date / note | **REAL-ish** node `detail`, else **SEED** | SEED date if node has none |
| Convention link-row (`47 files`) | **SEED** | BACKEND-FEATURE: no convention-usage count |
| Sprint / Estimate / Branch | **SEED** | BACKEND-FEATURE: columns don't exist |
| Tracked-metric value/target/trend/points | **SEED** (name from REAL metric node when present) | BACKEND-FEATURE: no metric timeseries |
| Will-write-back prose | **SEED** | BACKEND-FEATURE: no write-back plan endpoint |
| `created from` label, `↗ transcript` href | **SEED / BACKEND-FEATURE** | meeting/transcript linkage |

**BACKEND-FEATURE follow-ups** (each → its own deferred PR + a validation test that
asserts the UI reads the seam, so swap-in is a data change only):
1. `tasks.assignee` (account/agent id + ai flag) — drives card footer + rail Assignee.
2. `tasks.sprint_id` + sprint table — rail Sprint, page-head `Sprint N`.
3. `tasks.estimate`, `tasks.branch` — rail rows.
4. Per-task **feedback quotes + stats** (from feedback clusters) — Justification block.
5. **Metric timeseries** per task (Amplitude link) — Tracked-metric Sparkline.
6. **Gate-conflict link** (blocked task → conflicting ADR) — banner + card flag.
7. **Write-back plan** (bugs auto-resolved on merge) — Will-write-back prose.
8. **Pipeline history** events table (beyond free-text comments) — timeline fidelity.

---

## Validation

### Playwright (extend `e2e/backlog.spec.ts`, `e2e/task-detail.spec.ts`; mock API per `e2e/_helpers.ts` pattern)
**Backlog:**
- `data-testid="task-card"` renders; for a task with links, `.intel-bar` has spans
  with `data-intel-type` in order `feedback,bug,decision,meeting,metric` and **no
  bar** for a zero-link task.
- chips read `N ADR` / `N mtg` / `metric` (assert text, not `decision`/`meeting`).
- AI in_progress card shows `.agent-running` "building"; blocked task absent from
  columns; `[data-testid="blocked-banner"]` shows id + title + **ADR chip** + Open gate.
- **Full-height**: `.col` bounding box height ≈ grid height (assert `col` height >
  some fraction of viewport so the regression can't return).
- Page head shows `Filter`, `Suggest priority`, `Run sprint`; Run sprint → `/orchestrator`.

**Task detail (mock a task incl. `origin_*`, `nodes`, `comments`):**
- `.origin` shows speaker + `↗ transcript` chip.
- `.feedback-strip` has **4** `.fb-stat`; at least one `.quote-card`.
- "Architectural context" section + decision `.link-row` with `.lr-meta`; convention
  row with `47 files`.
- "Connected bugs" section + bug `.link-row` with `auto-linked`.
- "Pipeline history" `.timeline` with a `.tl-item.now`.
- Rail has `Assignee`, `Sprint`, `Estimate`, `Branch` rows; `Tracked metric` card with
  an `<svg>` (Sparkline) + trend; `Will write back` prose mentioning a `BUG-` id.
- **Seed seam test**: assert a `data-source="seed"` attr on seeded blocks (assignee,
  metric, quotes) so a future real-data PR flips them to `data-source="api"` and the
  test still passes by reading the attribute.

### Manual (`/run` the app against a seeded project)
- Backlog: columns reach the bottom of the viewport; cards show avatars/building/flag;
  blocked banner present; head actions clickable.
- SPD-142 (or the canonical seeded task): matches `mod_08` section-by-section
  (origin → justification → architecture → bugs → pipeline → rail metric/write-back).
- A non-canonical task: `seedForTask` produces coherent (not empty, not absurd) data.
- `npm run lint && npm run build` clean; `npx playwright test e2e/backlog.spec.ts
  e2e/task-detail.spec.ts` green.

---

## PR breakdown

- **PR-1 — Seed layer + view-model + CSS port** (`lib/demo.ts`, `lib/taskView.ts`,
  `lib/adapters.ts` count helper; `globals.css`: `.feedback-strip/.fb-stat/.quote-card`
  + **backlog full-height fix** + `.link-row` hover). Foundation; unit-test the
  view-model + `seedForTask` determinism. No visual change yet beyond column height.
- **PR-2 — Backlog parity** (`page.tsx` head + actions, `Board` height wiring,
  rich `TaskCard` intel/chips/footer, `BlockedBanner` narrative). Extends
  `e2e/backlog.spec.ts`.
- **PR-3 — Task detail MAIN column** (`OriginCard` speaker+transcript, new
  `JustificationSection` + `feedback-strip`/`quote-card`, `ArchitectureSection` +
  `ConnectedBugsSection` with `.lr-meta` via a shared `LinkRow`, `PipelineHistory`).
  Largest. Extends `e2e/task-detail.spec.ts`.
- **PR-4 — Task detail RIGHT rail** (Properties → Status/Priority/Feature/Assignee/
  Sprint/Estimate/Branch, `Sparkline` + Tracked-metric card, Will-write-back prose).
- **PR-5 — BACKEND-FEATURE seams (follow-up, deferred)**: schema migrations +
  endpoints for assignee/sprint/estimate/branch/metric-timeseries/feedback-quotes/
  write-back/gate-conflict, each flipping a seeded block from `data-source="seed"` to
  `"api"`. Ships behind tests written in PR-2/3/4 so the swap is data-only.

Ordering: PR-1 → PR-2 ∥ (PR-3 → PR-4); PR-5 trails. PR-2/3/4 are independent given
PR-1's view-model, so PR-3 and PR-4 can be parallel agents.
