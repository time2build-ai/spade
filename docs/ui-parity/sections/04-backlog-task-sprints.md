# Backlog + Task + Sprints parity

Reference: `modules/mod_11.js` (BacklogView), `mod_08.js` (TaskView · SPD-142), `mod_14.js` (SprintsView), `mod_01.js` (data), `inner.html` (tokens + CSS).
Ours: `app/backlog/page.tsx`, `components/backlog/{Board,TaskCard}.tsx`, `app/task/[id]/page.tsx`, `components/task/{OriginCard,EvidenceSection,MetaRow,TimelineRail,Relations}.tsx`, tokens/CSS in `app/globals.css`.

Tokens match exactly (bg #0b0b0d, accent #c9b8ff/#8e7dff, green/amber/red/blue/pink/teal, fonts). Most divergences are structural, not color.

---

## Reference: what it renders

### Backlog (mod_11)
- `.page-head`: breadcrumb **`Backlog · Sprint 26 · acme/web-app`** (NOT an `<h1>` title); right side has 3 buttons: **Filter** (ghost, search icon), **Suggest priority** (spark icon), **Run sprint** (primary, play icon → goto orch).
- **Blocked banner** above the grid: amber-bordered gradient card, `⚠`, `<b>SPD-144</b> · title — paused at review. Reviewer flagged conflict with [ADR-014 chip]`, right-aligned **Open gate →** button. Only shows when a `blocked` task exists.
- **4 columns** in the grid: `ready` (Ready, --text-4), `in_progress` (In progress, --blue), `review` (Review, --accent), `shipped` (Shipped, --green). `blocked` is intentionally NOT a column (surfaced via banner instead).
- `.col-head`: dot + label + `.count`. Empty col renders muted `—`.

#### Task card (mod_11 TaskCard)
- `.tc-head`: priority dot + **`t.id`** (e.g. SPD-142) + feature tag right-aligned (`marginLeft:auto`). Mono, --text-4.
- `<h4>` title.
- `.intel-bar`: 5 fixed segments in order **feedback (blue) · bug (red) · decision (amber) · meeting (#c9c9c9) · metric (teal)**, each `flex: count`, only rendered when `total > 0`. Title `"N linked intelligence items"`.
- `.tc-meta` chips (only nonzero, in this order): `N feedback`, `N bug`, `N ADR` (decisions), `N mtg` (meetings), `metric` (no count word).
- `.tc-foot`: assignee **avatar** — AI shows `◆` (`.avatar.ai`), human shows 2-letter initials, none → dashed `·` placeholder. If AI **and** in_progress → green-dot **`building`** running indicator. Right side: amber `t.flag` text (e.g. "conflicts ADR-014").

### Task detail (mod_08 · hardcoded SPD-142)
- `.page-head`: breadcrumb `Backlog / **SPD-142**`; right side: status chip `● in_progress` (blue dot), **View in graph** btn (graph icon), **Resume pipeline** primary btn (play → orch).
- `.td-main` (left) order:
  1. `.td-meta-row`: chip `[P0 dot] P0 critical` + feature chip `Checkout` + muted-mono `created from sprint planning · 14h ago`.
  2. `<h2.td-title>` title.
  3. `.origin`: eyebrow **Origin**, serif blockquote, `.src` = avatar (PS) + **speaker · mono source** + right-aligned `↗ transcript` chip.
  4. `.section-h` **User justification** `12 reports · 30d` → **`.feedback-strip`**: 4 `.fb-stat` tiles (12 Intercom complaints / ★2.3 / 34% / 8.4s), `.num.bad` red → then **`.quote-card`** list (italic quote + `— src`).
  5. `.section-h` **Architectural context** `2 ADR · 1 convention` → decision `.link-row`s (amber doc icon, `id · title`, note sub, `.lr-meta` date) + a hardcoded convention link-row (pink link icon, `47 files` meta).
  6. `.section-h` **Connected bugs** `3 likely root-caused…` → bug `.link-row`s (red flag icon, `auto-linked` meta).
  7. `.section-h` **Pipeline history** → `.card` wrapping `.timeline` with 4 hardcoded `.tl-item`s, last is `.now` (live · 412 lines streamed).
- `.td-side` (right rail):
  - `<h6>Properties` → `.meta-row`s: **Status** (● in_progress), **Priority** (P0 · critical), **Feature** (accent Checkout), **Assignee** (◆ avatar + Claude · Developer), **Sprint** (mono 26), **Estimate** (~25 min), **Branch** (mono spd/142-mobile-lcp).
  - `<h6>Tracked metric` → card: big **34%** + `target 50%` + label + **`<Sparkline/>`** red line SVG + mono `↓ 4.2pp / 30d`.
  - `<h6>Will write back` → muted prose paragraph naming bugs it will resolve.

### Sprints (mod_14)
- `.page-head`: breadcrumb `**Sprints** · acme/web-app`; right: **Cadence: 2 weeks** (cal), **Auto-plan next sprint** (spark), **New sprint** (primary, plus).
- **`.sprint-hero`** grid `1.4fr 1fr 1fr`, 3 cards:
  1. Current sprint: eyebrow `CURRENT · SPRINT 26`, h2 label, dates·day·theme, **`.sprint-progress`** stacked bar (shipped/review/progress/ready), legend dots row.
  2. **Burndown** card: `<Burndown/>` SVG (dashed ideal --text-4 + solid accent actual + endpoint dot), `on pace · 4 ahead of ideal`.
  3. **Velocity (last 4)** card: 4 vertical bars (last = accent), value labels on top, `S23..S26` axis.
- **`.sprint-list`**: `All sprints` label + `.sprint-row`s sorted by num desc. Each row: serif-italic `.num`, label (or muted serif "untitled · planning") + current/planning chip, dates·theme sub, **`.stack-bar`** (shipped/review/progress/ready/blocked 5-seg), right mono summary (`X/Y shipped|done|planned`).

---

## Ours: what it renders

### Backlog — `app/backlog/page.tsx` + `components/backlog/Board.tsx` + `TaskCard.tsx`
- `<PageHead title="Backlog" …>` renders an **`<h1>` "Backlog"** (no `Sprint 26 · acme/web-app` breadcrumb context). Single right action: **`+ New`** (primary, disabled). Missing Filter / Suggest priority / Run sprint.
- **No blocked banner** at all.
- **5 columns**: ready / in_progress / review / shipped **+ blocked** (Blocked, --amber). Reference has 4 and routes blocked to the banner instead.
- `TaskCard`: `.tc-head` priority + id + feature ✓. `<h4>` ✓. Intel-bar present but with **different type set/order**: feature/decision/feedback/bug/metric/convention (no `meeting`; adds `feature`+`convention`). Renders an empty placeholder bar when no links (ref omits the bar). `.tc-meta` chips use `"N {type}"` literal labels (e.g. "2 decision", "3 feedback") — ref uses `ADR`/`mtg`/bespoke wording. `.tc-foot` always shows **dashed avatar + "unassigned"** text (no AI ◆, no `building` indicator, no flag) — driven by "no agent endpoint in M1".

### Task detail — `app/task/[id]/page.tsx` + `components/task/*`
- `<PageHead>` breadcrumb `Backlog / **{id}**` ✓. **No right-side actions** (no status chip, no View-in-graph, no Resume-pipeline).
- `.td-meta-row`: chip `P{p} {label}` + feature chip + **muted-mono `task.id`** (ref shows `created from sprint planning · 14h ago`).
- `<h2.td-title>` ✓.
- `OriginCard`: eyebrow + serif blockquote + `.src` avatar(initials) + mono source. **No speaker name segment, no `↗ transcript` chip.** Renders nothing if no quote (honest empty state).
- Evidence: **6 generic `EvidenceSection`s** (Decisions/Bugs/Feedback/Metrics/Conventions/Features), each a `.section-h` + `.link-row` list (icon tile + label + detail). Honest "No linked X" empty states. **Missing entirely**: the `.feedback-strip` 4-stat tiles, the `.quote-card` verbatim quotes, the `.lr-meta` right column (date/files/auto-linked), and the "User justification / Architectural context / Connected bugs / Pipeline history" section naming.
- `Relations`: **Dependencies** section (Blocked by/Blocks/Parent/Subtasks/Related chip groups). **Not in reference** at this location.
- Side rail `<h6>Properties`: MetaRows **ID / Feature / Priority / Status / Created**. Ref has **Status / Priority / Feature / Assignee / Sprint / Estimate / Branch** (different set + order; we lack Assignee/Sprint/Estimate/Branch, add ID/Created).
- `<h6>Activity` → `TimelineRail` from real comments (`.tl-item`, last `.now`). Ref labels it inside "Pipeline history" in the main column, not the rail.
- **Missing**: `<h6>Tracked metric` card + Sparkline, `<h6>Will write back` prose.

### Sprints — **NOT IMPLEMENTED**
- No `app/sprints` route, no SprintsView component. Sidebar (`components/shell/Sidebar.tsx`) is the only place "sprint" appears. `app/globals.css` has **no** `.sprint-hero / .sprint-progress / .burn-svg / .sprint-list / .sprint-row / .stack-bar` rules (those classes live only in the reference `inner.html`). Also missing supporting CSS: `.feedback-strip`, `.fb-stat`, `.quote-card`.

---

## Diff table

| Aspect | Reference | Ours | Severity |
|---|---|---|---|
| **Sprints view** | Full view: hero (current/burndown/velocity) + sprint list rows | Not implemented (no route, no CSS) | **Blocker** |
| Sprints CSS tokens | `.sprint-hero/.sprint-progress/.burn-svg/.sprint-row/.stack-bar` in inner.html | Absent from globals.css | Blocker |
| Backlog columns | 4 cols (ready/in_progress/review/shipped); blocked→banner | 5 cols incl. Blocked column; no banner | **Major** |
| Backlog blocked banner | Amber gradient warn card + Open gate → | Missing | Major |
| Backlog head | Breadcrumb `Backlog · Sprint 26 · acme/web-app` + Filter/Suggest priority/Run sprint | `<h1>Backlog` + disabled `+ New` | Major |
| Task head actions | status chip + View in graph + Resume pipeline | none | Major |
| `.feedback-strip` (4 stat tiles) | Present on task detail | Missing (+ no CSS) | Major |
| `.quote-card` verbatim feedback | Present | Missing (+ no CSS) | Major |
| Intel-bar type set/order | feedback·bug·decision·meeting·metric | feature·decision·feedback·bug·metric·convention; no meeting | Major |
| `.lr-meta` (link-row right col) | date / 47 files / auto-linked | Not rendered | Major |
| Tracked-metric card + Sparkline | Present in rail | Missing | Major |
| "Will write back" prose | Present in rail | Missing | Minor |
| Side-rail meta rows | Status/Priority/Feature/Assignee/Sprint/Estimate/Branch | ID/Feature/Priority/Status/Created | Major |
| Section headings | User justification / Architectural context / Connected bugs / Pipeline history | Decisions/Bugs/Feedback/Metrics/… (generic) | Minor |
| Origin `↗ transcript` + speaker | Present | Missing speaker + chip | Minor |
| td-meta-row trailing text | `created from sprint planning · 14h ago` | raw `task.id` | Minor |
| Task-card chip wording | `ADR` / `mtg` / `metric` | literal `decision`/`feedback`/etc | Minor |
| Task-card footer | AI ◆ avatar / `building` / flag | dashed `·` + "unassigned" always | Minor |
| Dependencies/Relations section | Not present | Added by us | Minor |
| Tokens / fonts / chip/priority CSS | — | Match exactly | OK |

## Concrete parity changes

1. **Build Sprints view** (`app/sprints/page.tsx` + components): hero 3-card grid (current sprint + `.sprint-progress` bar + legend; Burndown SVG; Velocity bars) and `.sprint-row` list with `.stack-bar`. Port `.sprint-hero/.sprint-progress/.burn-svg/.sprint-list/.sprint-row/.stack-bar` CSS from inner.html into globals.css. Requires sprint data from API (or stub matching mod_01 `sprints`).
2. **Backlog → 4 columns**: drop the Blocked column; add the amber blocked-banner card above `.backlog-grid` (driven by any `blocked` task) with `Open gate →`.
3. **Backlog head**: switch from `<h1>` to breadcrumb-context form (`Backlog · Sprint N · slug`) and add Filter / Suggest priority / Run sprint buttons.
4. **Task head**: add status chip + View in graph + Resume pipeline actions.
5. **Task detail body**: add `.feedback-strip` (4 `.fb-stat` tiles) + `.quote-card` list under a "User justification" section; add `.lr-meta` right column to `EvidenceSection` link-rows; rename sections to ref wording; add Tracked-metric card + Sparkline and "Will write back" prose to the rail. Port `.feedback-strip/.fb-stat/.quote-card` CSS.
6. **Side rail meta rows**: align to Status/Priority/Feature/Assignee/Sprint/Estimate/Branch (add Assignee avatar, Sprint, Estimate, Branch; current ID/Created are extra).
7. **Intel-bar**: match the 5-type set + order (add `meeting`, drop `feature`/`convention` from the bar) and omit the bar when empty; chip wording → ADR/mtg/metric.
8. **TaskCard footer**: render AI ◆ avatar + `building` running indicator + amber flag when data is available.
9. **OriginCard**: add speaker name + `↗ transcript` chip.

## Suggested PR grouping

- **PR-A (Sprints, blocker):** new sprints route/components + sprint CSS. Largest, self-contained.
- **PR-B (Backlog parity):** 4-column layout, blocked banner, page-head actions, intel-bar type set, card footer/chip wording, OriginatedFrom text.
- **PR-C (Task detail parity):** feedback-strip + quote-card + their CSS, `.lr-meta`, section renaming, side-rail meta rows, tracked-metric/Sparkline, will-write-back. Largest task-side change; could split rail vs. main if needed.
- **PR-D (Task head + Origin polish, minor):** status chip/graph/resume actions, origin speaker + transcript chip.

Note: many task-detail gaps are deliberate "honest, no-fabrication" M1 choices (no metric/estimate/branch/assignee data). Closing them needs API/data, not just markup — flag for product before forcing visual parity on fabricated values.
