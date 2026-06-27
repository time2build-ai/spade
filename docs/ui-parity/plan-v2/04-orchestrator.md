# Orchestrator + Active — full-parity plan

Goal: FULL visual + data parity with `docs/Spade (standalone).html` for the
Orchestrator pipeline view and the Active-tasks view, **including the rich demo
data** (cost / ETA / tokens / spent / files-touched / animated live-log /
6-cell KPIs with sub-lines). Wire REAL data where the backend exposes it; SEED
(mirror the reference `SpadeData.pipelines`) where it does not; flag genuine
backend gaps as a planned follow-up PR + test.

Reference: `modules/mod_18.js` (OrchestratorView + PipelineDetail),
`modules/mod_21.js` (ActiveTasksView + ActiveCard), `modules/mod_01.js`
(`SpadeData.pipelines` demo shape), `inner.html` (CSS).
Note: `mod_23.js` / `OrchLines` / `orch-graph` lives in **Settings → Agents**
(AccountsView), NOT in this cluster — it is out of scope here and is covered by
the Accounts parity plan.

---

## Target

### Orchestrator (`mod_18.js`)

1. **Page head**: breadcrumb `**Orchestrator** · spade run --sprint` (mono muted).
   Right: `topbar-pill` (green `pulse-dot`) "N sessions live · 3 accounts", then
   buttons `1 gate ⏸` (ghost → gates), `Pause all`, `Spawn task` (primary + play icon).

2. **6-cell summary strip** (`orch-summary-strip`), every cell has `lbl` + `val` + `sub`:
   - Active — `7` / "7 sessions"
   - Shipped today — `3` green / "since 06:00"
   - Awaiting human — `1` amber / "SPD‑144"
   - Tokens · 24h — `2.1M` / `≈ $14.20` (sub mono)
   - Throughput — `5 / day` / "7d avg"
   - Concurrency cap — `8 / 12` / "CPU 41%"

3. **Filter bar** (`filter-bar`): "Filter" + `seg` `All (N) / Running / Paused / Shipped`
   + right muted hint "click any row to expand pipeline details ↓".

4. **Pipeline table** (`orch-table`, grid `24px 110px 1fr 1.4fr 110px 80px 90px`):
   sticky `th` header `"" / Task / Title / Pipeline / Account / Cost / ETA`.
   Each row = `display:contents`. Columns: chevron (rotates 90° + accent when open);
   `priority pN` dot + mono task id; truncated title; `stages-mini` (4 segs) +
   "step N/4" / "shipped" / "paused"; mono account; **mono Cost (`spent`)**;
   **mono ETA** colored amber(paused) / green(shipped) / text-2. Open rows get a
   `rgba(201,184,255,.04)` wash.

5. **PipelineDetail** (`orch-detail`, spans full grid, accent top-border):
   - **Progress bar** `orch-d-progress`: 4px rail, blue→accent fill at `progress%`
     + mono "`{progress}% · {eta}`".
   - **4 stage cards** `orch-d-stages` (`repeat(4,1fr)`): `role-mini` (uppercase) +
     colored state glyph (✓ Done green / ● Running blue / ⏸ Gate amber / · Queued) +
     mono `meta` line.
   - **3-col grid** `orch-d-grid` (`1fr 1fr 1.2fr`):
     - **Context** `orch-d-card` `orch-d-keys`: Feature, Branch (`spd/{task}-fix`),
       Account, Tokens (`~84k in / 12k out`), Spent, Origin (`Sprint Planning · Mar 25`)
       + "Open task" / "View in brain" ghost buttons.
     - **Files touched** `orch-d-card`: rows of `orch-d-file` (path + diff stat) +
       "`+ 2 more · last edit 6s ago`" (hidden when shipped).
     - **Live log** `orch-d-card term-mini` (bg `#08080a`): an animated streaming
       terminal — `tline` rows = mono `ts` + 4-char padded colored level
       (`lvl-info`/`lvl-tool`/`lvl-ok`/`lvl-warn`/`lvl-err`) + msg, plus a blinking
       `▌` cursor. Lines append every **380ms** via `setInterval` (mod_18 logic).

### Active (`mod_21.js`)

- **Page head**: `**Active tasks** · N pipelines running` + "Group by feature"
  (ghost) / "Open orchestrator →".
- **6-cell summary strip**: Running (`N` / "M paused"), Avg ETA (`~5m` / "slowest 10m"),
  In review (`3` / "2 auto · 1 gate"), Tokens · 1h (`412k` / "≈ $2.84"),
  Accounts in use (`3 / 5` / "round‑robin on"), Gates pending (`1` amber / "SPD‑144").
- **ActiveCard** (`active-card`): `priority pN` dot, mono task + title, meta row =
  `chip feature` (with dot) + mono account + colored `● building/merging/paused` +
  mono ETA; `stages-mini` on the right; mono spent; "Open" ghost button.
  `progress-rail` under the head (blue→accent `fill` + shimmering `pulse` sweep
  when not paused). Expanded `ac-body` → `ac-stage-mini` cards (✓ Completed /
  ● Running / ⏸ Awaiting human / · Queued + mono meta).

---

## Current state

The cluster is **structurally present** (the prior `sections/05` analysis is now
stale — the table + active view exist) but **data-thin** vs. the rich reference.

`app/orchestrator/page.tsx` (table layout exists):
- Head: `PageHead title="Orchestrator"` + "Active tasks →" link + topbar-pill
  "N sessions live". MISSING `spade run --sprint` subtitle, "· 3 accounts",
  and the `1 gate ⏸` / `Pause all` / `Spawn task` buttons.
- `KpiStrip.tsx`: **4** cells (Active / Gated / Shipped / Queued), **no sub-lines**.
- `filter-bar`: present; label "Active" (ref "Running").
- `PipelineTable.tsx`: `orch-table` grid `24px 110px 1fr 1.4fr 110px 90px` (**6 cols**)
  header `"" / Task / Title / Pipeline / Account / Status`. MISSING **Cost** + **ETA**
  columns; MISSING **priority dot**. Status column is a dot+word instead of ETA.
- Expanded detail: `orch-d-stages` (4 cards, real role/state — no `meta` line) +
  Start/Advance buttons (REAL API) + a 220px **real** `Terminal` (plain-text screen
  poll). MISSING `orch-d-progress`, `orch-d-grid` (Context / Files / Live-log cards).

`app/active/page.tsx` + `ActiveCard.tsx` (exist):
- Head title OK; actions only "Open orchestrator →" (MISSING "Group by feature").
- Summary strip: **2** cells (Running / Live pipelines), with subs. Ref has **6**.
- `ActiveCard`: priority dot, task+title, `chip feature` + account + colored state
  word, `stages-mini`, `done/total` (instead of spent), Open link, `progress-rail`
  with `pulse` (when running), `ac-stage-mini` body. MISSING ETA, spent, and the
  stage `meta` line; state label is the raw run status (no building/merging derivation).

`Terminal.tsx`: plain `pre`-style screen text; no `tline`/`lvl-*`/cursor/animation.

`lib/types.ts` `PipelineRun` / `PipelineStage`: NO cost/eta/tokens/progress/
files/log fields. Backend `pipelines.py` + `schema.sql` confirm: `pipeline_runs`
has only `status, current_stage, created_at`; `pipeline_stages` only
`role, stage_order, state, session_id, account_id`. **All rich demo fields are
backend gaps.**

CSS already in `app/globals.css`: `orch-summary-strip`, `stat-cell` (+ `.sub`!),
`stages-mini`, `orch-chev`, `orch-detail`, `orch-d-stages`/`orch-d-stage`,
`orch-d-actions`, `orch-table` (6-col grid), `active-card`/`ac-head`/
`progress-rail`/`pulse`/`ac-body`/`ac-stages`/`ac-stage-mini`, `filter-bar`,
`seg`, `chip.feature`, `priority.pN`, `@keyframes shimmer`/`blink`, `.term`.
**MISSING CSS**: `orch-d-progress`(+bar/fill), `orch-d-grid`, `orch-d-card`(+`-h`),
`orch-d-keys`, `orch-d-file`, `term-mini`, `.term .tline`, `.term .ts`,
`.term .lvl-info/ok/warn/err/tool`, and the **7-col** `orch-table` grid
(currently 6-col, needs `80px 90px` Cost/ETA tail).

---

## Build steps

### Step 0 — Seed model (`lib/pipelineSeed.ts`, new)

Centralize all SEED data so REAL vs SEED is explicit and testable. Mirror the
reference `SpadeData.pipelines` keyed by `task_id` (stable across re-renders).

```ts
// REAL fields come from PipelineRun; these are SEED overlays keyed by task_id.
export type PipelineSeed = {
  priority: number;          // SEED (until tasks priority joined — priority IS real on Task)
  spent: string;             // SEED  "$0.31"
  eta: string;               // SEED  "~3m" | "paused" | "shipped"
  progress: number;          // SEED  62
  feature: string;           // REAL (from Task.feature) — fallback SEED
  tokensIn: string; tokensOut: string;     // SEED "~84k" / "12k"
  origin: string;            // SEED "Sprint Planning · Mar 25"
  files: [string, string][]; // SEED [path, "+34 −6"]
  moreFiles: number;         // SEED 2
  stageMeta: Record<string,string>; // SEED per-role meta "sess_8d2c · 1m 58s · +213 −62"
  log: { lvl: "info"|"tool"|"ok"|"warn"|"err"; t: string; msg: string }[]; // SEED
};
export const PIPELINE_SEED: Record<string, PipelineSeed>; // SPD-142, 138, 141, 144, 146, 145, 140, 137, 128
export function seedFor(taskId: string): PipelineSeed;     // returns a deterministic default if unknown
```

Copy the 9 pipeline objects verbatim from `mod_01.js` (`pl_142`…`pl_128`):
spent/eta/progress/stage meta exactly as written. Copy the `pl_142` 10-line
`initialLogs` array as the canonical demo log; for other tasks synthesize a short
4-line log from the reference fallback pattern in `mod_18` (`pipeline started` /
`product.context → 4.2 KB` / `edit {task} working` / `npm test passed (212)`).

Derive helpers (parity with mod_18/21):
- `etaColor(run, seed)` → amber if paused, green if shipped, else `--text-2`.
- `activeStateLabel(run, seed)` → "paused · awaiting human" | "merging" (progress≥88)
  | "building" (mod_21 `stateLabel`).
- `branchFor(taskId)` → `spd/{taskId.toLowerCase()}-fix` (mod_18).

### Step 1 — CSS top-up (`app/globals.css`)

Append the missing classes **verbatim from `inner.html`** (lines 944–960, 1730–1755):

```css
.orch-d-progress { display:flex; align-items:center; margin-bottom:14px; }
.orch-d-progress-bar { flex:1; height:4px; background:var(--bg-3); border-radius:2px; overflow:hidden; position:relative; }
.orch-d-progress-bar .fill { position:absolute; left:0; top:0; bottom:0; background:linear-gradient(90deg,var(--blue),var(--accent)); }
.orch-d-grid { display:grid; grid-template-columns:1fr 1fr 1.2fr; gap:10px; }
@media (max-width:1100px){ .orch-d-grid{ grid-template-columns:1fr 1fr; } .orch-d-grid > :last-child{ grid-column:1/-1; } }
.orch-d-card { background:var(--bg-1); border:1px solid var(--line); border-radius:7px; padding:12px 14px; }
.orch-d-card-h { font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--text-4); font-weight:600; margin-bottom:8px; font-family:var(--mono); }
.orch-d-keys { display:flex; flex-direction:column; }
.orch-d-keys > div { display:flex; justify-content:space-between; padding:4px 0; font-size:12px; color:var(--text-2); border-bottom:1px solid var(--line); }
.orch-d-keys > div:last-child { border-bottom:none; }
.orch-d-keys .k { color:var(--text-4); }
.orch-d-file { display:grid; grid-template-columns:1fr auto; gap:12px; padding:4px 0; align-items:center; }
.term-mini { background:#08080a; }
.term .tline { display:block; }
.term .ts { color:var(--text-4); margin-right:8px; }
.term .lvl-info { color:var(--blue); }
.term .lvl-ok { color:var(--green); }
.term .lvl-warn { color:var(--amber); }
.term .lvl-err { color:var(--red); }
.term .lvl-tool { color:var(--accent); }
```

Change `.orch-table` grid to the **7-col** reference value:
`grid-template-columns: 24px 110px 1fr 1.4fr 110px 80px 90px;` (was 6-col).
(`@keyframes blink`/`shimmer`, `.stat-cell .sub`, `.term`, `priority.pN`,
`chip.feature` already exist — no change.)

### Step 2 — `KpiStrip.tsx` → 6 cells with subs (mod_18)

Replace the 4-cell array with the reference 6. Cells: Active (`kpis.active` REAL /
sub "{N} sessions" REAL session count), Shipped today (REAL `kpis.shipped` green /
sub "since 06:00" SEED), Awaiting human (REAL `kpis.gated` amber / sub = first
gated task id REAL, else "—"), Tokens · 24h (SEED "2.1M" / sub mono "≈ $14.20"),
Throughput (SEED "5 / day" / "7d avg"), Concurrency cap (SEED "8 / 12" / "CPU 41%").
Render `<div className="sub mono?">` per cell. Accept an optional `sessionCount`
prop (passed from page) for the Active sub.

### Step 3 — `PipelineTable.tsx` → 7-col + priority + Cost + ETA + full detail (mod_18)

Header row: add `<div className="th">Cost</div><div className="th">ETA</div>`,
rename `Status`→removed (ETA replaces it). Total 7 `th`.

Row cells (in order): chevron; **priority dot** `<span className={`priority p${prio}`}/>`
+ mono task id (prio = REAL `Task.priority` joined via a new `priorityById` prop,
fallback SEED); truncated title (REAL); `stages-mini` + step label (REAL via
`runStepLabel`); mono account (REAL `accountById`); **mono Cost** `seed.spent`
(SEED); **mono ETA** `seed.eta` colored via `etaColor` (SEED).

Replace the expanded detail body with the full `PipelineDetail` (new component,
or inline). Compose, in order:
1. `orch-d-progress`: `<div className="orch-d-progress-bar"><div className="fill"
   style={{width: seed.progress+"%"}}/></div>` + mono "`{progress}% · {eta}`".
2. `orch-d-stages`: keep 4 real stage cards, ADD the SEED `meta` line per role
   (`seed.stageMeta[s.role]`) under the state line (`<div className="meta mono">`).
3. `orch-d-grid` (3 cards):
   - **Context** (`orch-d-keys`): Feature REAL, Branch SEED, Account REAL, Tokens SEED,
     Spent SEED, Origin SEED + two ghost buttons → `/task/{id}` and `/brain`.
   - **Files touched**: map `seed.files` to `orch-d-file` rows; "+N more · last edit
     6s ago" when not shipped.
   - **Live log** (`orch-d-card term-mini`): render the `<LiveLog>` component (Step 4).
4. Keep the **REAL** Start/Advance buttons (`onStart`/`onAdvance`) — place them in
   an `orch-d-actions` row above the grid (preserves real functionality alongside
   the seeded cards). Optionally drop the separate 220px real `Terminal` here, OR
   keep it as a collapsible "real session output" under the live-log card (decision:
   keep it, gated behind a small toggle, so we keep the real screen without breaking
   parity — note this divergence in the PR).

### Step 4 — `LiveLog.tsx` (new) — animated streaming terminal (mod_18 setInterval)

Port the mod_18 replay logic exactly:

```tsx
export function LiveLog({ lines }: { lines: LogLine[] }) {
  const [shown, setShown] = React.useState<LogLine[]>([]);
  React.useEffect(() => {
    setShown([]);
    const id = setInterval(() => {
      setShown(prev => prev.length < lines.length ? [...prev, lines[prev.length]] : prev);
    }, 380);
    return () => clearInterval(id);
  }, [lines]);
  return (
    <div className="term" style={{height:"auto", padding:"8px 10px", borderRadius:4, border:"none", background:"transparent", fontSize:10.5}}>
      {shown.slice(-7).map((l,i) => (
        <div className="tline" key={i}>
          <span className="ts">{l.t}</span>
          <span className={"lvl-"+l.lvl}>{l.lvl.padEnd(4)}</span>
          <span> {l.msg}</span>
        </div>
      ))}
      <div className="tline" style={{color:"var(--text-3)"}}><span className="ts">▌</span></div>
    </div>
  );
}
```

- `lines` = `seedFor(taskId).log` (SEED).
- Stops appending once all lines are shown (the cursor remains blinking via
  `stages-mini`/`blink` keyframe? No — the cursor is static glyph; the *blink* in
  the reference comes from `lvl`-less styling — keep it as the reference: a static
  `▌` row. The reference does not animate the cursor itself, only the line append.)
  (Verify against `mod_18` — it is a static `▌` ts cell. Correct.)
- Cleanup on unmount (collapse) to avoid leaked intervals — important since rows
  mount/unmount on toggle.

### Step 5 — `Terminal.tsx` → structured `tline` rendering (optional, mod_18 styling)

If we keep the real session screen anywhere, upgrade it to parse lines and render
`tline` + colored `lvl-*` when the screen text matches a `HH:MM:SS LEVEL msg`
shape; otherwise fall back to the raw `pre` text. This keeps the REAL terminal but
makes it visually consistent. (Low priority — the seeded `LiveLog` carries parity.)

### Step 6 — `app/orchestrator/page.tsx` head + actions (mod_18)

- Replace `PageHead` usage with the reference breadcrumb head: `<b>Orchestrator</b>
  · <span className="mono muted">spade run --sprint</span>`.
- Right: topbar-pill "`{liveCount} sessions live · {accountCount} accounts`"
  (account count REAL from `accountsData`), then:
  - `1 gate ⏸` ghost → `/gates` (count REAL = gated/brakes count).
  - `Pause all` — wire to REAL bulk pause if available; else disabled w/ title
    "backend: bulk pause not yet supported" (BACKEND-FEATURE, see gaps).
  - `Spawn task` primary + `#i-play` icon → opens the spawn flow (REAL if a spawn
    route exists; else link to backlog).
- Filter labels: rename "Active"→"Running" (the `filterRuns` "active" case already
  means not-shipped-not-paused; just relabel the button text).
- Pass `priorityById` + `sessionCount` to children.

### Step 7 — `app/active/page.tsx` → 6-cell strip + head action (mod_21)

- Add "Group by feature" ghost button (can be a no-op toggle that groups
  `ActiveCard`s by `feature` heading — REAL grouping over real feature field).
- Replace the 2-cell strip with the 6 reference cells: Running (REAL / "M paused"
  REAL), Avg ETA (SEED "~5m" / "slowest 10m"), In review (REAL count of runs whose
  stage is reviewer-running OR gated / "2 auto · 1 gate" SEED sub), Tokens · 1h
  (SEED "412k" / "≈ $2.84"), Accounts in use (REAL `usedAccounts/totalAccounts` /
  "round‑robin on" SEED), Gates pending (REAL gated count amber / first gate id REAL).

### Step 8 — `ActiveCard.tsx` → ETA + spent + state derivation + stage meta (mod_21)

- State label: use `activeStateLabel(run, seed)` (building/merging/paused) not raw
  status.
- Meta row: ADD mono ETA `seed.eta` after the state word.
- Right column: replace `done/total` with mono **spent** `seed.spent` (SEED);
  keep the count too if desired but match reference (spent only).
- `progress-rail` fill: use `seed.progress%` (SEED) to match the reference exactly
  (currently derived from done/total — keep derived as fallback when no seed).
- `ac-stage-mini`: ADD the SEED `meta` line (`<span className="muted mono">{seed.stageMeta[role]}</span>`).

---

## Data sourcing

| Field / element | Source | Notes |
|---|---|---|
| Run id, status, current_stage | **REAL** | `PipelineRun` |
| Stage role / state / session_id / account_id | **REAL** | `PipelineStage` |
| Task title, feature, priority | **REAL** | joined from `api.tasks` (`Task.title/feature/priority`) |
| Account label | **REAL** | joined from `api.accounts` |
| Live session count, account count | **REAL** | `api.sessions` / `api.accounts` |
| Gated count / first gate id / Awaiting-human | **REAL** | derived from runs (paused/failed) + `api.brakes` |
| Step label "step N/4" | **REAL** | `runStepLabel` |
| Start / Advance actions | **REAL** | `api.startPipeline` / `api.advancePipeline` |
| Cost (`spent`) | **SEED** | mod_01 per-task |
| ETA (`eta`) | **SEED** | mod_01 |
| Progress % | **SEED** | mod_01 (no backend progress) |
| Tokens (in/out, 24h, 1h) | **SEED** | mod_01 / mod_18 / mod_21 |
| Branch, Origin | **SEED** | mod_18 (branch derivable from task id; origin fixed string) |
| Files touched + diff stats | **SEED** | mod_18 |
| Stage `meta` lines | **SEED** | mod_01 (`sess_… · 1m 58s · +213 −62`) |
| Live-log lines + 380ms replay | **SEED** | mod_18 `initialLogs` |
| KPI subs (since 06:00, 7d avg, CPU 41%…) | **SEED** | mod_18 |
| Throughput, Concurrency cap, Avg ETA, In review subs | **SEED** | mod_18 / mod_21 |
| "Pause all" bulk action | **BACKEND-FEATURE** | no endpoint; disable + follow-up |
| "Spawn task" from orchestrator | **BACKEND-FEATURE** if no create-run route | else REAL via `create_run` |
| Real per-token cost / real ETA / real progress / real files / real structured logs | **BACKEND-FEATURE** | follow-up PR (see below) |

**Backend follow-up (separate PR + test):** extend `pipeline_runs` with
`progress`, `eta_seconds`, `cost_cents`, `tokens_in`, `tokens_out`; add a
`pipeline_files(run_id, path, added, removed)` table and a `pipeline_logs(run_id,
ts, level, msg)` table; emit logs from the stage state machine; add a bulk
`POST /pipelines/pause-all`. Until then the seed overlay drives these. Write a
pytest (`tests/test_pipelines.py`) asserting the new columns/tables default sanely
and that `list_for_project` returns them; client swaps `seedFor` → real field with
a seed fallback when null.

---

## Validation

### Playwright (`apps/client` e2e)

Orchestrator:
- `orch-table` has **7** `th` with text Task/Title/Pipeline/Account/Cost/ETA (+1 blank).
- Each `orch-row` shows a `.priority` dot, a mono Cost cell, and a mono ETA cell;
  a paused run's ETA is amber, a shipped run's ETA is green (assert computed color).
- Clicking a row reveals `orch-detail` containing `orch-d-progress` (fill width
  matches `{progress}%`), 4 `orch-d-stage` with a `.meta` line, and an `orch-d-grid`
  with exactly 3 `orch-d-card`s (Context keys count = 6, ≥1 `orch-d-file`,
  `term-mini`).
- Live-log: after ~400ms a `.tline` appears; after `380ms × N` the line count
  reaches `min(7, seed.length)`; a `▌` cursor row is present; level spans carry
  `lvl-info/ok/warn/err/tool` classes.
- KPI strip has **6** `stat-cell`s and every cell has a `.sub`.
- Head shows "spade run --sprint" and `Spawn task` / `Pause all` / gate buttons.
- Real path intact: Start (queued) then Advance (running) buttons call the API
  (mock `/pipelines/*/start|advance`, assert request fired).

Active:
- summary strip has **6** cells; each has `.sub`.
- `active-card` shows `chip feature`, mono account, colored state word
  (building/merging/paused per progress), mono ETA, mono spent; `progress-rail`
  `.fill` width = `{progress}%`; `.pulse` present only when not paused.
- expand → `ac-stage-mini` cards include a mono meta line.

Regression: existing `__tests__` for `PipelineTable`/`ActiveCard`/adapters still
pass; `runStepLabel`, `stageVisual`, `filterRuns`, `pipelineKpis` unchanged.

### Manual

`cd apps/client && pnpm dev` (or the project run skill). Compare side-by-side with
`docs/Spade (standalone).html` → Orchestrator and Active tabs at the same window
width. Check: 7-col alignment, ETA colors, the 380ms log streaming cadence, the
shimmer sweep on the progress-rail, the 3-card detail grid collapsing to 2-col
under 1100px (`orch-d-grid` media query). Verify intervals are cleared on row
collapse (no console warnings, no runaway timers in React DevTools profiler).

---

## PR breakdown

- **PR-1 — Seed model + CSS (foundation).** `lib/pipelineSeed.ts` (port mod_01
  pipelines + mod_18 logs/helpers) + append missing CSS (`orch-d-progress`,
  `orch-d-grid`, `orch-d-card`, `orch-d-keys`, `orch-d-file`, `term-mini`, `tline`,
  `lvl-*`) + widen `orch-table` to 7-col. Unit tests for `seedFor`/`etaColor`/
  `activeStateLabel`/`branchFor`. No visual wiring yet → low risk, unblocks rest.

- **PR-2 — KPI 6-cell + table columns (Steps 2–3 cols).** `KpiStrip` → 6 cells
  with subs; `PipelineTable` priority dot + Cost + ETA columns + 7-col header.
  Playwright for header/cells/colors.

- **PR-3 — Pipeline detail + animated live-log (Steps 3 detail, 4, 5).**
  `PipelineDetail` (progress bar + stage meta + Context/Files/Live-log grid) +
  `LiveLog` 380ms replay; keep real Start/Advance + optional real Terminal toggle.
  Playwright for detail grid + streaming.

- **PR-4 — Active view parity (Steps 7–8).** 6-cell strip, ETA/spent/state
  derivation, stage meta, seeded progress-rail, "Group by feature". Playwright.

- **PR-5 — Head + actions polish (Step 6).** breadcrumb subtitle, "· N accounts",
  gate/Pause-all/Spawn-task buttons (wire real where possible, disable BACKEND-FEATURE
  ones with titles), filter label "Running".

- **PR-6 — Backend rich pipeline data (follow-up, BACKEND-FEATURE).** schema +
  `pipelines.py` columns/tables for progress/eta/cost/tokens/files/logs + bulk
  pause endpoint + pytest; client swaps seed → real with seed fallback. Tracked as
  the planned gap PR.
```
