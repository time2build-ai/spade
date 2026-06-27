# Decisions + Gate parity

Cluster: **Decisions** (list + ADR detail) and **Gate** (human approval). The
reference for this cluster is the single most elaborate area of the whole Spade
mockup — the ADR detail modal alone is ~400 lines of structured narrative, and
the Gate screen is a bespoke conflict-resolution surface. Our PoC implements
honest-but-minimal versions of both. This is the cluster with the largest
parity gap in the app.

Reference files:
- `modules/mod_24.js` — `DecisionsView` (list, filter seg, `AdrModal` detail) + `ADR_NARRATIVES` data
- `modules/mod_15.js` — `GateView` (conflict gate, signal cards, diff, reviewer suggestion)
- `modules/mod_01.js` — decisions data (`status`, `owner`, `date`, `linksFeatures`, `supersedes`, `conflict`)
- `inner.html` — tokens + all `.adr-*`, `.status-pill`, `.seg`, `.gate-*`, `.conflict` CSS

Our files:
- `app/decisions/page.tsx`, `components/decisions/DecisionCard.tsx`, `components/decisions/DecisionDetail.tsx`
- `app/gate/page.tsx`, `components/gate/GateCard.tsx`

---

## Reference: what it renders

### Decisions list (`DecisionsView`)
- **Page head** breadcrumb: `**Decisions** · 94 ADRs · 71% linked to code`. Right
  side: three buttons — `Timeline view` (ghost), `Find conflicts`, `Record
  decision` (primary, with `+` icon).
- **Filter bar**: a segmented control (`.seg`) with `All (N)`, `Active`,
  `Proposed`, `Superseded`. Active segment has `.on` styling (bg-3, full text
  color). Right-aligned muted helper: *"Decisions are recorded from meetings,
  PRs, and explicitly via `spade adr new`."* with the command in mono.
- **ADR rows** (`.adr-row`, grid `auto 1fr auto auto`): each row shows
  - `.adr-id` — the real ADR id (`ADR-031`) in **mono amber**.
  - Title (13.5px, weight 500) + optional inline amber **conflict chip**
    (`⚠ SPD-144 proposes content-based`).
  - Meta line (muted 12px): `date · owner` + **feature chips** (accent dot +
    name) + optional `supersedes ADR-009`.
  - **`.status-pill`** — color-coded: `active` (green), `proposed` (amber),
    `superseded` (grey, **strikethrough**).
  - `Open ›` ghost button.
  - Row hover → bg-2; selected row (`.active`) → bg-2 + border highlight.

### ADR detail (`AdrModal`) — a right-side `aside`, not a centered modal
A full-height **right-docked panel** (`.adr-modal`) with dimmed overlay. Anatomy:
- **Header**: id-row (`ADR-031` mono + status-pill + conflict chip + `v1.2 ·
  last edit Mar 18` mono meta). Actions row: copy-permalink (link icon), `Export
  markdown`, `Edit`, close-X — all ghost. Then large serif-ish `adr-m-title`,
  then a **meta grid**: Owner / Deciders / Recorded / Affects (feature chips) /
  Tags (`adr-tag` pills).
- **Body = two columns**: a sticky **TOC sidebar** (`On this page` with
  scroll-spy active highlighting) + a scrolling content column with up to ~13
  sections:
  - **Summary** — `We chose / Over / Because / Trade-off` key-value rows.
  - **Context** — prose + bullets + a **metrics grid** (`adr-metric` with value,
    label, up/down trend).
  - **Decision drivers** — weighted cards (`high`/`med`/`low` weight pills).
  - **Decision** — boxed statement + numbered points.
  - **Implementation** — numbered steps with optional `<pre>` code blocks.
  - **Consequences** — **3-column** split: Positive (good) / Negative-risks
    (warn) / Neutral.
  - **Alternatives considered** — cards with rejected/considered verdict, pros/cons.
  - **Validation** — criteria rows with pass/fail/watch/pending dots + target/current.
  - **Discussion** — serif italic quote blocks with attribution.
  - **Provenance** — source rows (mic/link/doc/graph icons) + `open ↗`.
  - **Changelog** — date/author/what rows.
  - **Linked work** — `adr-link-row` (mono id + title + colored kind chip:
    task=blue, adr=amber, feature=accent), navigable.
  - **Lineage** — supersedes / superseded-by / related rows.
- **Footer**: `Source: /docs/adr/adr-031.md` mono + `Discuss` + status-conditional
  action (`Propose supersede` if active / `Approve & activate` if proposed).
- **Escape** closes. Per-ADR narratives live in `ADR_NARRATIVES`; missing ones
  fall back to `ADR_DEFAULT`.

### Gate (`GateView`) — a single rich conflict screen
- **Page head** breadcrumb: `Orchestrator / **Human gate** · SPD-144` (the
  "Orchestrator" segment navigates back). Right: `Open PR #2121 ↗`, `Skip &
  continue sprint`.
- **Amber banner** (`.gate-banner`): gate icon in amber tile, `Reviewer paused
  this pipeline` + explanation, and an **inline actions cluster** on the right:
  `Reject change`, `Override decision`, `Approve & resume` (primary + check).
- **Two info cards** (`Task` / `Why we paused`) — uppercase eyebrow + content;
  the second references an inline ADR-014 decision chip.
- **Conflict panel** (`.conflict` card, 2 panels + center `⇄` arrow): left
  "Existing decision" (amber left-border, serif italic quote, owner) vs right
  "Proposed change" (accent left-border, serif quote, feedback chip).
- **Diff snippet** — `Diff snippet · 3 of 11 files` header + a real syntax diff
  block (`.diff` with ctx/del/add lines and line numbers).
- **3 signal cards** — User feedback `8` (blue), Metric impact `2.1%` (teal),
  Decision age `101 d` (amber), each big-number + sub.
- **Reviewer suggestion** card — AI avatar `◆`, recommendation prose with inline
  ADR-046 chip, `Accept suggestion` primary button.

---

## Ours: what it renders (file paths)

### Decisions list — `app/decisions/page.tsx` + `DecisionCard.tsx`
- Page head via `PageHead`: `Decisions · {N} ADRs`. **No** Timeline/Find-conflicts/
  Record-decision buttons. **No** breadcrumb "% linked to code".
- **No filter bar at all** — no segmented `All/Active/Proposed/Superseded`, no
  helper text.
- Rows (`.dec-row`): **derived** `ADR-001` code from list index (not a real id),
  a doc icon + title, meta = `date · one-line snippet` of the markdown body, and
  an `Open ›`. **No status pill, no owner, no feature chips, no conflict chip, no
  supersedes.** Driven purely by brain nodes of `type === "decision"` with only
  `id/label/detail/created_at`.

### ADR detail — `DecisionDetail.tsx`
- A **centered modal** (`.dec-modal-backdrop` / `.dec-modal`), not a right-docked
  panel.
- Header: derived `ADR-001` mono + a single `ADR` chip. Actions: `Export
  markdown` (copies `# title\n\n detail` to clipboard) + close-X. **No** copy-
  permalink, **no** Edit, **no** version/last-edit meta.
- Title + `Recorded {date}` meta line.
- Body: raw **markdown render** of `node.detail` (`<Markdown>`), then optionally
  **Linked work** (tasks whose `nodes[]` include this id → links to `/task/:id`)
  and **Connections** (graph edges → other node label + relation, decisions
  clickable to re-open). Empty state: "No description recorded yet."
- **None** of: TOC/scroll-spy, Summary KV, Context metrics, Drivers, Decision
  box, Implementation, 3-col Consequences, Alternatives, Validation, Discussion,
  Provenance, Changelog, Lineage, footer with source/actions.

### Gate — `app/gate/page.tsx` + `GateCard.tsx`
- Page head: `Human gates · {N} pending`.
- Generic amber banner (`.gate-banner`): gate icon, `Actions awaiting your
  approval` + generic copy. **No** breadcrumb, **no** inline header actions.
- **A list of generic brake cards** (`GateCard`), one per pending brake. Each
  card: eyebrow = formatted brake type, `detail` paragraph, mono `mission ·
  worker` meta, and two buttons: `✓ Allow` (primary) + `Skip` (ghost). Error line
  on failure.
- Empty state: "No gates awaiting approval — the fleet is clear."
- **None** of: Task/Why-paused cards, the conflict diff panel, diff snippet,
  signal cards, or reviewer-suggestion card. The reference Gate is a *single
  designed conflict view*; ours is a *generic multi-brake approval queue*.

---

## Diff table

| Aspect | Reference | Ours | Severity |
| --- | --- | --- | --- |
| **Decisions — filter bar** | `.seg` All/Active/Proposed/Superseded + helper text | absent entirely | **major** |
| Decisions — head actions | Timeline / Find conflicts / Record decision (primary +) | none | major |
| Decisions — head breadcrumb | `Decisions · 94 ADRs · 71% linked to code` | `Decisions · N ADRs` | minor |
| **Row — ADR id** | real `ADR-031`, mono amber | derived `ADR-001` from index, mono (no amber color) | major |
| **Row — status pill** | active(green)/proposed(amber)/superseded(grey strike) | none | **major** |
| Row — owner | shown in meta | none | major |
| Row — feature chips | accent-dot chips | none | major |
| Row — conflict chip | inline amber `⚠ …` | none | major |
| Row — supersedes | `supersedes ADR-009` | none | minor |
| Row — selected state | `.adr-row.active` border highlight | no selected style (modal only) | minor |
| Row — title icon | none | doc icon prefix | minor (ours extra) |
| Row — snippet | none | one-line detail preview | minor (ours extra) |
| **Detail — placement** | right-docked full-height `aside` + overlay | centered modal | **major** |
| **Detail — TOC / scroll-spy** | sticky "On this page" nav, active highlight | none | major |
| Detail — header meta | status pill, conflict chip, `v1.2 · last edit`, copy-permalink, Edit | only `ADR` chip + export + close | major |
| Detail — meta grid | Owner/Deciders/Recorded/Affects/Tags | only `Recorded {date}` | major |
| **Detail — Summary KV** | We chose/Over/Because/Trade-off | none | major |
| Detail — Context metrics | bullets + metric grid w/ trends | none (raw markdown only) | major |
| Detail — Decision drivers | weighted cards | none | major |
| Detail — Decision box + points | boxed + numbered | none | major |
| Detail — Implementation steps | numbered + code blocks | none | major |
| **Detail — Consequences 3-col** | good/warn/neutral columns | none | major |
| Detail — Alternatives | verdict cards + pros/cons | none | major |
| Detail — Validation | pass/fail/watch/pending rows | none | major |
| Detail — Discussion | serif quotes + attribution | none | major |
| Detail — Provenance | source rows + `open ↗` | none | major |
| Detail — Changelog | date/author rows | none | major |
| Detail — Linked work | colored kind chips (task/adr/feature) | plain task links only | minor |
| Detail — Lineage | supersedes/superseded-by/related | none (Connections instead) | major |
| Detail — footer | source path + status-conditional actions | none | minor |
| Detail — Connections section | (n/a — reference uses Lineage/Linked) | edges-based section | minor (ours extra) |
| **Gate — overall shape** | single bespoke conflict view | generic multi-brake card queue | **blocker** |
| Gate — breadcrumb | `Orchestrator / Human gate · SPD-144` | none | major |
| Gate — banner actions | Reject/Override/Approve inline | banner has no actions | major |
| **Gate — Task / Why-paused cards** | two info cards | none | major |
| **Gate — conflict panel** | 2-panel `⇄` decision-vs-change w/ serif quotes | none | major |
| **Gate — diff snippet** | syntax diff `3 of 11 files` | none | major |
| **Gate — signal cards** | feedback/metric/decision-age big numbers | none | major |
| Gate — reviewer suggestion | AI avatar + Accept suggestion | none | major |
| Gate — per-card actions | (n/a) | Allow / Skip per brake | minor (ours extra, honest) |
| Tokens / fonts | bg #0b0b0d, serif quotes, mono amber ids | shared token set (assumed via globals) | verify |

---

## Concrete parity changes

Honesty caveat: the reference is dummy-data rich. Our data layer (brain nodes
with only `id/label/detail/created_at`, edges, tasks, brakes) cannot
*truthfully* populate most reference sections (deciders, drivers, validation,
metrics, signal cards). So parity here splits into **"can do honestly now"** vs
**"needs backend fields or stays as honest-empty scaffolding."**

**Decisions list (high value, mostly honest):**
1. Add the **filter `.seg`** (All/Active/Proposed/Superseded) with the helper
   text. Requires a `status` field on decision nodes — if absent, derive/treat
   all as a single state and render the seg disabled, or add `status` to the
   brain-node schema.
2. Add a **`.status-pill`** to each row (green/amber/grey-strike) once `status`
   exists. Match reference CSS exactly (`inner.html:1909-1912`).
3. Color the ADR id **amber mono** and, if real ADR ids exist, stop deriving
   `ADR-001` from index. If they don't, keep derived but match amber styling.
4. Add **owner** + **feature chips** to the row meta when those fields exist.
5. Add head buttons (Timeline / Find conflicts / Record decision) as visual
   parity even if non-functional, and the `· N% linked to code` breadcrumb
   suffix (compute from edges).

**ADR detail (large; phase it):**
6. Convert the centered modal into the **right-docked `aside` + overlay** with
   matching `.adr-modal` / `.adr-m-head` / `.adr-m-body-wrap` CSS — this is the
   single highest-impact visual change and is layout-only.
7. Add the **TOC sidebar with scroll-spy**, header meta grid (Owner/Recorded/
   Affects/Tags), and the footer. These can render from existing fields + honest
   "—" placeholders.
8. Render the body as the reference **sections** (Summary KV, Consequences 3-col,
   Provenance, Linked work with kind chips, Lineage) — but only show a section
   when we honestly have its data; otherwise omit (the reference itself omits
   optional sections via `narrative.*` guards). Keep the markdown render as a
   fallback for un-structured `detail`.

**Gate (rebuild — this is a blocker-level divergence):**
9. The reference Gate is **one designed conflict screen for a single gated
   action**, not a queue. Decide product intent:
   - If gates are genuinely a multi-brake queue (our backend reality), the
     reference single-conflict layout doesn't map 1:1 — flag for design.
   - For visual parity of a *single* gate, build: breadcrumb, banner with inline
     Reject/Override/Approve, Task + Why-paused cards, the `.conflict` 2-panel
     view, diff snippet, 3 signal cards, reviewer-suggestion card. Most of this
     needs richer brake payload (conflicting ADR, diff, metrics) than `brake/
     detail/mission/worker` provides.
10. At minimum, port the **`.conflict` panel CSS + serif quote styling** and the
    **signal card** component so individual brakes that *do* carry a conflicting
    decision can render the 2-panel view.

---

## Suggested PR grouping

- **PR A — Decisions list parity (honest subset):** filter `.seg`, status pills,
  amber ids, owner/feature chips in row meta, head buttons + breadcrumb suffix.
  Needs a `status` (and ideally `owner`/`features`) field decision. *Low risk,
  high visual payoff.*
- **PR B — ADR detail: re-dock + chrome:** centered modal → right `aside` +
  overlay, header meta grid, TOC scroll-spy sidebar, footer. Layout/CSS only,
  no new data. *Highest single visual-impact PR.*
- **PR C — ADR detail: structured sections:** Summary KV, 3-col Consequences,
  Provenance, Lineage, Linked-work kind chips — each guarded by data
  availability, markdown fallback retained. *Larger; depends on PR B.*
- **PR D — Gate redesign:** the conflict-view rebuild. Gate this PR behind a
  product/design decision on queue-vs-single-conflict and on the required brake
  payload fields. Port `.conflict` + `.diff` + signal-card CSS first as a
  shared-component foundation. *Blocker-level; needs design + backend input.*
