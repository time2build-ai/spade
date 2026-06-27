# Orchestrator + ActiveTasks parity

Scope: the Orchestrator pipeline view (KPI strip, pipeline rows, expand/collapse
detail, stages mini, live terminal/log), the ActiveTasks view, and the PM→worker
SVG connector lines.

Reference files:
- `modules/mod_18.js` — `OrchestratorView` + `PipelineDetail`
- `modules/mod_21.js` — `ActiveTasksView` + `ActiveCard`
- `modules/mod_23.js` — `OrchLines` (curved SVG connectors) — **note: this lives in
  `AccountsView` / Settings→Agents, NOT in the orchestrator pipeline view**
- `modules/mod_01.js` — pipeline data
- `inner.html` — tokens + CSS

Our files:
- `app/orchestrator/page.tsx`
- `components/orchestrator/KpiStrip.tsx`, `PipelineCard.tsx`, `StagesMini.tsx`, `Terminal.tsx`
- `app/globals.css` (orch-* class definitions)

---

## Reference: what it renders

**OrchestratorView (mod_18.js)** — a full-width data table, not a card list.

1. **Page head**: breadcrumb `**Orchestrator** · spade run --sprint` (mono muted).
   Right side: `topbar-pill` with green `pulse-dot` → "N sessions live · 3 accounts",
   then buttons: `1 gate ⏸` (ghost), `Pause all`, `Spawn task` (primary, with play icon).

2. **Summary strip** (`orch-summary-strip`): **6** `stat-cell`s — Active (7 sessions),
   Shipped today (green, "since 06:00"), Awaiting human (amber, "SPD-144"),
   Tokens·24h ("2.1M", sub "≈ $14.20"), Throughput ("5 / day", "7d avg"),
   Concurrency cap ("8 / 12", "CPU 41%"). Each cell has lbl + val + **sub** line.

3. **Filter bar** (`filter-bar`): label "Filter", a `seg` segmented control with
   `All (N) / Running / Paused / Shipped`, and a right-aligned muted hint
   "click any row to expand pipeline details ↓".

4. **Pipeline table** (`orch-table`, CSS grid `24px 110px 1fr 1.4fr 110px 80px 90px`):
   sticky `th` header row — `"" / Task / Title / Pipeline / Account / Cost / ETA`.
   Each pipeline is a `row` (display:contents). Columns:
   - chevron `▸` (rotates 90° when open; turns accent when open)
   - **priority dot** `priority pN` (p0 red w/ glow, p1 amber, p2 blue, p3 grey) + mono task id
   - title (truncated)
   - **stages-mini** 4 segments + a "step N/4" text
   - account (mono), cost (mono), ETA (mono, color by status)
   Open rows get a faint accent wash (`rgba(201,184,255,.04)`).

5. **PipelineDetail** (`orch-detail`, spans full grid, top border accent tint):
   - **Progress bar** (`orch-d-progress`): thin 4px rail w/ blue→accent gradient fill +
     mono "62% · ~3m".
   - **4 full stage cards** (`orch-d-stages`, `repeat(4,1fr)`): each has role-mini
     (uppercase mono) + state line with colored glyph (✓ Done green / ● Running blue /
     ⏸ Gate amber / · Queued) + mono meta line.
   - **3-column grid** (`orch-d-grid`, `1fr 1fr 1.2fr`): **Context** card (key/value rows:
     Feature, Branch, Account, Tokens, Spent, Origin + "Open task"/"View in brain" buttons),
     **Files touched** card (file path + diff stat rows + "+2 more · last edit 6s ago"),
     **Live log** card (`term-mini`, bg `#08080a`) — an animated streaming terminal that
     appends log lines every 380ms; each line = mono ts + colored 4-char level
     (`lvl-info` blue / `lvl-tool` accent / `lvl-ok` green / `lvl-warn` amber / `lvl-err` red)
     + message, plus a blinking `▌` cursor.

**ActiveTasksView (mod_21.js)** — a separate route. Card list (`active-list`), NOT a table:
- Page head "**Active tasks** · N pipelines running" + "Group by feature" / "Open orchestrator →".
- Its own 6-cell summary strip (Running / Avg ETA / In review / Tokens·1h / Accounts in use / Gates pending).
- `ActiveCard`s: priority dot, mono task + title, a meta row with **feature chip**, account,
  colored "● building/merging/paused" state, ETA; stages-mini on the right, spent, "Open" button.
  A **`progress-rail`** under the head (blue→accent gradient fill + a shimmering `pulse` sweep
  animation when not paused). Expanded body shows `ac-stage-mini` cards (✓ Completed / ● Running /
  ⏸ Awaiting human / · Queued).

**OrchLines (mod_23.js)** — curved SVG PM→worker connectors. Lives in Settings→Agents.
Measures the `.orch-pm-avatar` and each `.orch-w-avatar` via getBoundingClientRect, draws
cubic-bezier paths `M x1 0 C x1 .55h, x2 .45h, x2 h` (vertical fan), stroke
`rgba(201,184,255,.35)` width 1, 70px tall. PM avatar is a provider-tinted glyph chip; workers
are smaller glyph chips in a flex row with mono ids beneath.

---

## Ours: what it renders

**`app/orchestrator/page.tsx`** — a **two-column split**: card list (1.6fr) on the left,
a persistent live `Terminal` (1fr) on the right. This is a fundamentally different layout
than the reference table.

- **Page head**: `PageHead title="Orchestrator"` + a `topbar-pill` "N sessions live".
  No `spade run --sprint` subtitle, no gate/Pause-all/Spawn-task buttons.
- **KpiStrip.tsx**: **4** stat-cells — Active / Gated (amber) / Shipped (green) / Queued.
  **No `sub` line** on any cell. (Reference has 6 cells, all with subs.)
- **Filter bar**: matches reference structure — "Filter" + `seg` (All (N)/Active/Paused/Shipped)
  + muted hint "click a pipeline to expand details ↓". (Labels: "Active" vs ref "Running".)
- **PipelineCard.tsx**: a self-contained `orch-card` (bordered card), NOT a table row.
  Row contents: chevron, mono `task_id` only (**no title, no priority dot**), stages-mini,
  then meta = account (mono) + step label + status word. No cost, no ETA, no priority.
  - Expanded `orch-detail`: the 4 `orch-d-stage` cards (role + ✓/●/⏸/· state + session/account meta).
    **No progress bar. No Context card. No Files-touched card. No live-log card** inside the detail.
    Instead an `orch-d-actions` row with Start/Advance buttons (functional, real API).
- **Terminal.tsx**: a single right-column `term` panel (bg `#08080a`) showing the selected
  session's **raw text screen** (`white-space: pre`, polled). It is **plain monospace text** —
  no per-line timestamp/level coloring, no `tline`/`lvl-*` structure, no blinking cursor,
  no streaming append animation.
- **ActiveTasks: NOT IMPLEMENTED.** No route, no `ActiveCard`, no `active-list`, no
  `progress-rail`/`pulse` shimmer, no feature chip, no `ac-stage-mini`.
- **OrchLines / PM→worker connectors: NOT IMPLEMENTED.** No `orch-graph`, `orch-pm-avatar`,
  `orch-w-avatar`, or SVG connector lines anywhere (the whole Settings→Agents PM/worker
  graph is absent from this cluster's files).

---

## Diff table

| Aspect | Reference | Ours | Severity |
|---|---|---|---|
| Overall layout | Full-width sortable **table** (orch-table grid), detail expands inline full-width | **Card list + persistent side Terminal** (2-col split) | **blocker** |
| Page-head subtitle | `spade run --sprint` mono | none | minor |
| Head actions | 1 gate ⏸ / Pause all / Spawn task (primary+icon) | none | major |
| Topbar pill text | "N sessions live · 3 accounts" | "N sessions live" | minor |
| KPI cells | **6** cells, each with **sub** line | **4** cells, **no subs** | major |
| KPI labels | Active/Shipped today/Awaiting human/Tokens·24h/Throughput/Concurrency cap | Active/Gated/Shipped/Queued | major |
| Filter labels | All/Running/Paused/Shipped | All/**Active**/Paused/Shipped | minor |
| Row: priority dot | `priority pN` colored dot w/ p0 glow | absent | major |
| Row: title | shown (truncated) | absent (task id only) | major |
| Row columns | Task/Title/Pipeline/Account/Cost/ETA | task/stages/account/step/status | major |
| Row: Cost + ETA | mono cells, ETA colored by status | absent | major |
| Open-row accent wash | `rgba(201,184,255,.04)` on td | card `.selected` border only | minor |
| Detail: progress bar | blue→accent 4px rail + "% · eta" | **absent** | major |
| Detail: stage cards | 4 cards w/ glyph states + meta | present (matches well) | — |
| Detail: Context card | key/value + Open task / View in brain | **absent** | major |
| Detail: Files-touched card | file+diff rows + "+2 more" | **absent** | major |
| Detail: Live-log card | `term-mini` animated streaming, colored levels, ▌ cursor | **absent in detail** (a plain side terminal instead) | **blocker** |
| Terminal styling | per-line ts + colored `lvl-*` + blink cursor + 380ms append | **plain `pre` text**, no coloring/animation | major |
| ActiveTasks view | full route w/ summary strip + ActiveCards | **NOT IMPLEMENTED** | **blocker** |
| `progress-rail` + shimmer `pulse` | on every ActiveCard | absent | major |
| Feature chip on cards | `chip feature` w/ dot | absent | minor |
| `ac-stage-mini` expand body | per-stage mini cards | absent | major |
| PM→worker SVG `OrchLines` | cubic-bezier fan, accent stroke | **NOT IMPLEMENTED** | major |
| PM/worker avatars (orch-graph) | provider-tinted glyph chips + mono ids | absent | major |

---

## Concrete parity changes

1. **Rebuild the orchestrator as a table (orch-table)**, not a card-list+terminal split.
   Use the exact grid `24px 110px 1fr 1.4fr 110px 80px 90px`, sticky `th` header
   (Task/Title/Pipeline/Account/Cost/ETA), `row` = `display:contents`, hover/open `td`
   washes. Move the live log **into** the inline expanded detail, not a fixed side column.

2. **KpiStrip → 6 cells with subs.** Add Tokens·24h, Throughput, Concurrency cap; rename
   Gated→"Awaiting human", add Shipped-today; render a `.sub` line in every cell.

3. **PipelineCard rows: add priority dot (`priority pN`), title column, Cost, ETA.**
   ETA colored amber(paused)/green(shipped)/text-2. Add the "step N/4" hint.

4. **Build the full `PipelineDetail`**: progress bar (`orch-d-progress`), then the 3-column
   `orch-d-grid` (`1fr 1fr 1.2fr`) — Context card, Files-touched card, and the **animated
   Live-log `term-mini`** with `tline`/colored `lvl-*` levels + blinking `▌`.

5. **Restyle Terminal** to render structured log lines (ts + 4-char padded level with
   `lvl-info/ok/warn/err/tool` colors) and a blinking cursor, matching `.term .tline`.

6. **Implement ActiveTasksView** (new route `app/active/page.tsx` + `ActiveCard`):
   summary strip, feature chip, colored state, **`progress-rail` with shimmer `pulse`**,
   and the `ac-stage-mini` expand body.

7. **Implement OrchLines + orch-graph** (in the Accounts/Settings cluster, but listed here):
   `orch-pm-avatar` + `orch-w-avatar` provider-tinted glyph chips and the measured
   cubic-bezier SVG connectors (`rgba(201,184,255,.35)`, width 1, 70px).

8. Add page-head subtitle + Gate/Pause-all/Spawn-task actions; align filter label
   "Active"→"Running"; restore the open-row accent wash.

## Suggested PR grouping

- **PR-A — Orchestrator table rewrite (blocker):** items 1, 2, 3 (layout → table, KPI 6-cell,
  row columns/priority/cost/ETA). Largest structural change; do first.
- **PR-B — Pipeline detail + live log (blocker):** items 4, 5 (progress bar, Context +
  Files cards, animated colored terminal). Depends on PR-A's expanded-row shell.
- **PR-C — ActiveTasks view (blocker):** item 6 (new route, ActiveCard, progress-rail shimmer).
- **PR-D — Orch graph + connectors (major):** item 7 (PM/worker avatars + SVG OrchLines).
- **PR-E — Head/filter polish (minor):** item 8.
