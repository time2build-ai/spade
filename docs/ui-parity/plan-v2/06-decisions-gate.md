# Decisions + Gate — full-parity plan

Cluster owner: **Decisions** (filter seg + status pills + rich ADR detail with
all 13 sections + TOC scroll-spy) and **Gate** (the bespoke single-conflict
review screen). This is the single largest parity gap in the whole app — the
reference ADR detail (`AdrModal`) is ~400 lines of structured narrative and the
Gate (`GateView`) is a fully designed conflict surface, while our current code
ships honest-but-minimal versions of both.

Goal per the directive: **FULL visual + data parity including rich demo data.**
Wire REAL where the data exists; SEED (mirror the reference `SpadeData` /
`ADR_NARRATIVES`) where it doesn't; genuine backend gaps → flagged as
BACKEND-FEATURE with a planned follow-up.

Reference (read-only, in scratchpad):
- `modules/mod_24.js` — `DecisionsView` + `AdrModal` + `ADR_NARRATIVES` + `ADR_DEFAULT`
- `modules/mod_15.js` — `GateView` + `SignalCard`
- `modules/mod_01.js` — `SpadeData.decisions[]` (8 ADRs: `id/title/status/date/owner/linksFeatures/supersedes/related/conflict`)
- `inner.html` — all `.seg`, `.filter-bar`, `.status-pill`, `.adr-*`, `.gate-*`, `.conflict`, `.diff`, signal/avatar CSS (line refs inline below)

Our files (to rebuild):
- `app/decisions/page.tsx`, `components/decisions/DecisionCard.tsx`, `components/decisions/DecisionDetail.tsx`
- `app/gate/page.tsx`, `components/gate/GateCard.tsx`
- `app/globals.css` (has `.seg`/`.filter-bar`/`.status-pill`/`.dec-*`/`.gate-banner`/`.gate-card`; MISSING the full `.adr-*` modal section CSS, `.conflict`, `.diff`, signal cards, `.gate-banner .actions`, info/Task cards)
- `lib/types.ts`, `lib/api.ts`, `lib/adapters.ts`

---

## Target

### Decisions list (`DecisionsView`, mod_24:1-54)
- **Page head breadcrumb**: `**Decisions** · 94 ADRs · 71% linked to code`; right
  side three buttons — `Timeline view` (ghost), `Find conflicts`, `Record
  decision` (primary, `#i-plus` icon).
- **Filter bar** (`.filter-bar` + `.seg`, inner.html:1638-1646): segmented
  `All (N)` / `Active` / `Proposed` / `Superseded`, active = `.on`. Right-aligned
  muted helper: *"Decisions are recorded from meetings, PRs, and explicitly via
  `spade adr new`"* (command in `.mono`, `--text-2`).
- **ADR rows** (`.adr-row` grid `auto 1fr auto auto`, inner.html:1901-1914):
  `.adr-id` (mono **amber**) · title (13.5px/500) + optional inline amber
  **conflict chip** (`⚠ {conflict}`) · meta line (`date · owner` + feature chips
  `.chip.feature` with accent dot + optional `supersedes ADR-009`) ·
  `.status-pill` (active=green / proposed=amber / superseded=grey **strike**) ·
  `Open ›` ghost. Selected row → `.adr-row.active` (bg-2 + `--text-4` border).

### ADR detail (`AdrModal`, mod_24:56-462) — right-docked `aside`
Full-height right-docked panel + dimmed overlay (`.adr-overlay` /
`.adr-modal`, inner.html:1917-1932), **not** a centered modal. Anatomy:
- **Header** (`.adr-m-head`): id-row = `.adr-id` + `.status-pill` + conflict chip
  + mono `v{version} · last edit {lastEdit}`; actions = copy-permalink (`#i-link`),
  `Export markdown`, `Edit`, close-X (all `.btn.ghost`); `.adr-m-title`; meta grid
  (`.adr-m-meta`) = Owner / Deciders / Recorded / Affects (feature chips) / Tags
  (`.adr-tag` pills).
- **Body** (`.adr-m-body-wrap`): sticky **TOC** (`.adr-m-toc`, "On this page",
  scroll-spy `.active`) + scrolling content (`.adr-m-body`, `ref` for scroll
  observer) with up to **13 sections** (each `section[data-sec]`):
  1. **Summary** — `.adr-summary` KV rows: We chose / Over / Because / Trade-off.
  2. **Context** — prose + `.adr-bullets` + `.adr-metrics` grid (value/label/up-down trend).
  3. **Decision drivers** (optional) — `.adr-driver` cards with `.adr-driver-w.w-{high|med|low}` weight pills.
  4. **Decision** — `.adr-decision-box` + numbered `.adr-bullets-num` points.
  5. **Implementation** (optional) — numbered `.adr-impl-step` w/ optional `.adr-code` `<pre>`.
  6. **Consequences** — **3-col** `.adr-conseq`: Positive(good)/Negative-risks(warn)/Neutral.
  7. **Alternatives** (optional) — `.adr-alt-card` w/ `.adr-alt-verdict.{rejected|considered}` + pros/cons cols.
  8. **Validation** (optional) — `.adr-val-row` w/ `.adr-val-dot.{pass|fail|watch|pending}` + target/current/window.
  9. **Discussion** (optional) — `.adr-quote` serif italic quotes + attribution.
  10. **Provenance** — `.adr-prov-row` w/ icon (mic/link/doc/graph) + `open ↗`.
  11. **Changelog** (optional) — `.adr-cl-row` date/author/what.
  12. **Linked work** — `.adr-link-row` (mono id + title + `.adr-link-kind.{task|adr|feature}` chip), navigable via `goto`.
  13. **Lineage** (conditional) — `.adr-lin-row` supersedes / superseded-by(`.sup`) / related.
- **Footer** (`.adr-m-foot`): `Source: /docs/adr/{id}.md` mono + `Discuss` +
  status-conditional (`Propose supersede` if active / `Approve & activate` if proposed).
- **Escape** closes; TOC click smooth-scrolls; scroll updates active section.
- Per-ADR narrative from `ADR_NARRATIVES[id]`, falling back to `ADR_DEFAULT(d)`.

### Gate (`GateView`, mod_15) — single bespoke conflict screen
- **Breadcrumb**: `Orchestrator / **Human gate** · SPD-144` ("Orchestrator" → `goto('orch')`).
  Right: `Open PR #2121 ↗`, `Skip & continue sprint`.
- **Amber banner** (`.gate-banner`, inner.html:1170-1179): gate icon tile +
  "Reviewer paused this pipeline" + explanation + inline `.actions` cluster:
  `Reject change`, `Override decision`, `Approve & resume` (primary + `#i-check`).
- **Two info cards** (grid 1fr/1fr): `Task` (SPD-144 + session id + summary) /
  `Why we paused` (references inline `.chip.decision` ADR-014).
- **Conflict panel** (`.conflict` card, inner.html:1181-1194): 2 panels + center
  `.arrow` (`⇄`). Left `.panel.left` (amber border) "Existing decision" serif
  `.quote` + owner; right `.panel.right` (accent border) "Proposed change" serif
  quote + `.chip.feedback`.
- **Diff snippet** (`.section-h` + count `3 of 11 files`) → `.diff` block
  (inner.html:1196-1204) with `.ctx`/`.del`/`.add` lines + `.ln` numbers.
- **3 signal cards** (`SignalCard`): User feedback `8` (blue) / Metric impact
  `2.1%` (teal) / Decision age `101 d` (amber) — big-number + sub.
- **Reviewer suggestion** card: `.avatar.ai` (`◆`) + recommendation prose w/
  inline ADR-046 chip + `Accept suggestion` primary.

---

## Current state

### Decisions — `app/decisions/page.tsx`, `DecisionCard.tsx`, `DecisionDetail.tsx`
- Page head via `PageHead`: `Decisions · {N} ADRs`. **No** breadcrumb %, **no**
  head buttons, **no** filter bar.
- Rows (`.dec-row`, our bespoke class): **derived** `ADR-001` from list index
  (`adrCode(index)`), doc icon + title, meta = `date · one-line detail snippet`,
  `Open ›`. **No** status pill / owner / feature chips / conflict chip / supersedes.
  Driven by `BrainNode` where `type==="decision"` (only `id/label/detail/created_at`).
- Detail (`DecisionDetail`) is **already right-docked** (`.dec-modal` over
  `.dec-modal-backdrop`) but **sparse**: derived code + single `ADR` chip; actions
  = Export markdown + close; `Recorded {date}`; body = **raw `<Markdown>`** of
  `node.detail`; optional Linked work (tasks whose `nodes[]` include id) and
  Connections (edges). None of the 13 structured sections, no TOC, no meta grid,
  no footer.
- Deep-link supported: `/decisions#dec-<id>` opens that row's detail.

### Gate — `app/gate/page.tsx`, `GateCard.tsx`
- Page head `Human gates · {N} pending`; generic `.gate-banner` (no actions, no
  breadcrumb). Body = **list of `GateCard`** (one per pending brake): eyebrow =
  `formatBrakeType(brake.brake)`, `brake.detail` paragraph, mono `mission · worker`,
  `✓ Allow` / `Skip` buttons wired to `api.allowBrake` / `api.skipBrake`. Polls
  `api.brakes()` every 4s.
- **None** of: conflict panel, diff, signal cards, info cards, reviewer suggestion.
  Our Gate is a *generic multi-brake queue*; reference is a *single designed
  conflict view*.

### Data / backend reality
- `brain_nodes` columns: `id, project_id, type, label, detail, x, y, created_at`
  (schema.sql:71-75; `_WRITABLE_NODE_COLS = {type,label,detail,x,y}`, brain.py:17).
  **No** `status`, `owner`, `version`, `tags`, `sections`/narrative column. ADRs
  are just `type="decision"` nodes.
- `Brake` type (types.ts:77-83): `{id, mission, brake, detail, worker}`. The only
  brake kind produced is `opus_spawn` (orchestration.py:84). **No** conflict /
  ADR-reference / diff / signal / suggestion fields exist on a brake.
- The reference's `ADR_NARRATIVES` and the entire Gate payload are **hand-authored
  demo data** with no backend equivalent.

---

## Build steps

Order: shared chrome & CSS → Decisions list → ADR detail → Gate. Each numbered
block maps to a PR in the breakdown.

### Step 0 — Shared types, seed module, CSS port

**0a. Seed data module** `lib/seed/decisions.ts` (new):
- Port `SpadeData.decisions[]` verbatim as `SEED_DECISIONS: SeedDecision[]`
  (the 8 ADRs: ADR-031/022/018/014/009/046/027/021 with
  `id/title/status/date/owner/linksFeatures/supersedes?/related?/conflict?`).
- Port `ADR_NARRATIVES` verbatim as `ADR_NARRATIVES: Record<string, AdrNarrative>`
  and `ADR_DEFAULT(d)` as a function (mod_24:473-877). Keep the exact prose so
  visual + data parity is literal.
- Export `seedAdrCounts = { total: 94, linkedPct: 71 }` for the breadcrumb.

**0b. Types** `lib/types.ts` — add:
```ts
export type AdrStatus = "active" | "proposed" | "superseded";
export interface SeedDecision {
  id: string; title: string; status: AdrStatus; date: string; owner: string;
  linksFeatures: string[]; supersedes?: string[] | null;
  related?: string[] | null; conflict?: string | null;
}
export interface AdrNarrative { /* version, lastEdit, deciders, tags, summary,
  context, contextBullets?, contextMetrics?, drivers?, decision, decisionPoints?,
  implementation?, consequences, alternatives?, validation?, discussion?,
  provenance, changelog?, links, related?, supersededBy? — mirror mod_24 shape */ }
```

**0c. Decision merge adapter** `lib/adapters.ts` — `mergeDecisions(nodes, seed)`:
- For each REAL `type==="decision"` BrainNode, try to match a seed entry (by
  normalized label/title, or by a real ADR id embedded in the label). When matched,
  carry REAL `label/detail/created_at/id` and overlay SEED `status/owner/
  linksFeatures/conflict/supersedes/narrative`. When unmatched, fall back to
  `ADR_DEFAULT`-style derived fields so the row still renders status `active`.
- Also expose the pure SEED list so the demo always shows the full rich set even
  with an empty brain (directive: "SEED otherwise; build the FULL rich UI").
- Decide source order in the page: if the project has real decision nodes, render
  REAL-merged; else render pure SEED. This keeps real label/detail/edges authoritative.

**0d. CSS** — append the full reference block to `app/globals.css`, copied 1:1
from `inner.html` (these selectors are NOT yet present): `.adr-list`, `.adr-row`,
`.adr-id` (confirm amber), `.adr-overlay`, `.adr-modal`, `@keyframes adr-modal-in`,
`.adr-m-head*`, `.adr-m-title`, `.adr-m-meta`, `.adr-meta-*`, `.adr-tag`,
`.adr-m-body-wrap`, `.adr-m-toc`, `.adr-toc-*`, `.adr-m-body`, `.adr-m-foot`,
`.adr-sec*`, `.adr-summary*`, `.adr-bullets*`, `.adr-metrics`/`.adr-metric*`,
`.adr-drivers`/`.adr-driver*`, `.adr-decision-box`, `.adr-impl*`, `.adr-code`,
`.adr-conseq*`, `.adr-alts`/`.adr-alt*`, `.adr-validation`/`.adr-val*`,
`.adr-discussion`/`.adr-quote*`, `.adr-prov*`, `.adr-changelog`/`.adr-cl*`,
`.adr-links`/`.adr-link*`, `.adr-lineage`/`.adr-lin*` (inner.html:1901-2279). Plus
Gate: `.gate-banner .gicon`/`.actions` extension, `.conflict*`, `.arrow`, `.diff*`,
`.avatar`/`.avatar.ai` (inner.html:739-747), `.chip.feature`/`.chip.decision`/
`.chip.feedback`, signal-card uses inline styles (keep). Reuse existing `--green/
--amber/--red/--blue/--teal/--accent` tokens (already defined).
- Note: we currently use `.dec-row`/`.dec-modal`; **switch class names to the
  reference `.adr-*`** so CSS is a literal port (less drift). Update the deep-link
  target rule (`.dec-row:target` → `.adr-row:target`) and the `#dec-<id>` anchor.

### Step 1 — Decisions list parity (rebuild `DecisionCard` + `page.tsx`)
Port `DecisionsView` (mod_24:1-54):
- Replace `PageHead` title with the reference `.breadcrumb`
  (`**Decisions** · {seedAdrCounts.total} ADRs · {linkedPct}% linked to code`) and
  the three head buttons. Buttons: `Record decision` (primary) — wire to a
  no-op/disabled-with-tooltip for now (BACKEND-FEATURE: create ADR); `Find
  conflicts` filters to rows with `conflict` set (client-side, REAL-able);
  `Timeline view` toggles a flat date-sorted ordering (client-side).
- Add `.filter-bar` + `.seg` with `filter` state (`all|active|proposed|superseded`)
  and the helper text. `All (N)` count = merged list length.
- Rebuild `DecisionCard` → `.adr-row` grid with `.adr-id` (real ADR id when
  present, else `adrCode(index)`), title + conflict chip, meta (`date · owner` +
  feature chips + supersedes), `.status-pill {status}`, `Open ›`. Selected row gets
  `.active`. Keep the `#dec-<id>`→`#adr-<id>` deep-link anchor + flash.

### Step 2 — ADR detail parity (rebuild `DecisionDetail` → `AdrModal`)
Port `AdrModal` (mod_24:56-462) into `components/decisions/DecisionDetail.tsx`:
- Right-docked `aside.adr-modal` + `.adr-overlay` (we already dock right; swap
  class names + structure).
- Build `toc` array exactly as mod_24:67-81 (conditional sections).
- Scroll-spy: replicate the `bodyRef` scroll listener (mod_24:85-100) and
  `scrollTo` (mod_24:102-110). In React, `useRef` + `useEffect` with the same
  rect math; `activeSec` state drives `.adr-toc-item.active`.
- Render header (id-row, actions, title, meta grid via a `MetaItem` subcomponent)
  and all 13 sections gated on narrative presence, pulling from
  `ADR_NARRATIVES[d.id] ?? ADR_DEFAULT(d)`. **Linked work** rows call `goto`
  → use Next `router.push` mapping `nav` ("task" → `/active` or `/task/{id}`;
  resolve against our routes). Keep REAL edge-derived connections as an *additional*
  fallback only if no seed `links` (so real brain edges still surface).
- Footer with source path + status-conditional action buttons (no-op for now,
  flagged BACKEND-FEATURE: supersede / approve transitions).
- Keep Escape-to-close + overlay-click-close. `Export markdown` keeps current
  clipboard behavior (now serializing the rich narrative, not just `node.detail`).
- **REAL overlay**: when the open decision is a real brain node, prefer its real
  `detail` for the Context prose / Summary "We chose" if the seed narrative is the
  default fallback — so real recorded ADRs show their actual body.

### Step 3 — Gate parity (rebuild `app/gate/page.tsx`; retire/repurpose `GateCard`)
Port `GateView` (mod_15) into `app/gate/page.tsx`:
- Build the full single-conflict screen: breadcrumb (Orchestrator →
  `router.push('/orchestrator')` or our orch route), head buttons, banner with
  inline `.actions`, two info cards, `.conflict` panel, diff, 3 `SignalCard`s,
  reviewer-suggestion card. Add a `SignalCard` component
  (`components/gate/SignalCard.tsx`).
- **Gate data model decision (recommended):** the reference is a *single* conflict
  about SPD-144 / ADR-014. Our backend produces *multiple generic brakes*
  (`opus_spawn`). Recommendation: render the reference's single-conflict screen as
  the **primary surface**, seeded from a `SEED_GATE` payload mirroring mod_15, but
  **bind it to a real brake when one exists**:
  - If `api.brakes()` returns ≥1 brake, show the conflict screen "hydrated" with
    the real brake's `mission/worker/detail` where they map (Task card mission,
    banner), and wire `Approve & resume` → `api.allowBrake(id)`, `Reject change` /
    `Skip & continue sprint` → `api.skipBrake(id)`. The conflict/diff/signal/
    suggestion blocks stay SEED (no backend source).
  - If multiple brakes are pending, show a compact **brake switcher** (small
    `.seg` or pill list at top) selecting which brake hydrates the screen; default
    to the first. This preserves our real multi-brake capability inside the bespoke
    layout.
  - If zero brakes, show the fully-SEED demo conflict (directive: build the FULL
    rich UI) with a subtle "demo" affordance, OR the existing empty state — choose
    SEED demo to match the parity goal; gate it behind a `?demo` / empty-state note
    so it's not mistaken for a live gate.
- Keep `GateCard` only if we still want a raw brake-queue view elsewhere; otherwise
  delete it and its test. The button wiring (allow/skip) moves into the new screen.

---

## Data sourcing (REAL | SEED | BACKEND-FEATURE)

| Surface / field | Source | Notes |
| --- | --- | --- |
| Decision row: `id`,`label`,`detail`,`created_at` | **REAL** | from `type="decision"` BrainNode when present |
| Decision row: `status`,`owner`,`linksFeatures`,`conflict`,`supersedes` | **SEED** | no columns on `brain_nodes`; overlay from `SEED_DECISIONS` (BACKEND-FEATURE to make real) |
| ADR id display | **REAL** when seed-matched, else derived `adrCode(index)` | reference ids are stable strings |
| Breadcrumb `94 ADRs · 71% linked` | **SEED** (`seedAdrCounts`) | can be made REAL: count nodes + % with edges |
| Filter seg / `Find conflicts` | **REAL** (client-side over merged list) | filter by `status`/`conflict` |
| ADR detail: all 13 narrative sections | **SEED** (`ADR_NARRATIVES` / `ADR_DEFAULT`) | hand-authored; no backend narrative store |
| ADR detail Context/Summary prose | **REAL overlay** when node has `detail` | real body wins over `ADR_DEFAULT` |
| ADR detail Linked work | **SEED** primary; **REAL** edge/task fallback | keep real connections when no seed links |
| ADR detail Lineage | **SEED**; partial REAL from `supersedes`/edges | |
| Detail actions (Edit/Approve/Propose supersede/Record decision) | **BACKEND-FEATURE** | no ADR write/transition API; no-op + planned PR |
| Gate banner/task/conflict/diff/signals/suggestion | **SEED** (`SEED_GATE` ⟵ mod_15) | no backend conflict/diff/signal model |
| Gate `mission`/`worker`, allow/skip actions | **REAL** | bind `api.brakes()` + `allowBrake`/`skipBrake` |
| Gate multi-brake switcher | **REAL** | from `api.brakes()` length |

### BACKEND-FEATURE follow-ups (flagged; each gets a tracked PR + test)
1. **ADR fields on brain nodes** — add `status`, `owner`, `tags`, and a `narrative`
   JSON blob (or a sidecar `adr_meta` table keyed by node id) + read/write API.
   Until then status/owner/sections are SEED. *(Test: round-trip create→read of an
   ADR with status+owner; list filters by status.)*
2. **ADR lifecycle transitions** — `POST /brain/decisions/{id}/supersede` and
   `/approve` to back the footer + `Approve & activate` buttons. *(Test: proposed→
   active transition flips status in list.)*
3. **Record decision (`spade adr new`)** — create endpoint for the primary head
   button. *(Test: POST creates a decision node that appears in the list.)*
4. **Gate conflict model** — extend `Brake` with optional structured conflict
   payload (`adr_ref`, `proposed`, `diff[]`, `signals[]`, `suggestion`) so the Gate
   screen can be REAL not SEED. *(Test: a brake with conflict payload renders the
   conflict panel + diff from real data.)*

These are genuine gaps, not gold-plating — they are the line between "rich demo"
and "real product," and the directive explicitly allows planned follow-up PRs for
them.

---

## Validation

### Playwright (extend `apps/client` e2e; mirror existing `__tests__` style)
Decisions:
- List renders `.adr-row` per merged decision; first row shows a `.status-pill`
  and `.adr-id` in amber.
- Filter seg: clicking `Proposed` shows only `status="proposed"` rows (ADR-046);
  `Superseded` shows ADR-009 with strike pill; `All (N)` count correct.
- `Find conflicts` narrows to rows with a conflict chip (ADR-014).
- Click ADR-031 row → right-docked `aside.adr-modal` visible; **TOC** lists
  Summary…Lineage; clicking a TOC item scrolls and sets `.adr-toc-item.active`;
  scrolling the body updates active section (scroll-spy).
- Detail shows Summary KV, 3-col Consequences, Alternatives verdicts, Validation
  dots, Provenance rows, Linked work chips colored by kind.
- Escape and overlay click close the panel.
- Deep link: navigate `/decisions#adr-ADR-031` opens that detail.

Gate:
- Renders breadcrumb `Orchestrator / Human gate`, banner with 3 actions, two info
  cards, `.conflict` panel (2 quotes + `⇄`), `.diff` with add/del lines, 3
  `SignalCard`s (8 / 2.1% / 101 d), reviewer-suggestion card.
- With a real pending brake present (seed one via test API): `Approve & resume`
  calls allow and the brake clears; `Skip & continue sprint` calls skip.
- With multiple brakes: switcher selects which brake hydrates Task/banner.

### Manual checklist
- Side-by-side vs `docs/Spade (standalone).html` Decisions + Gate at the same
  viewport: pixel spot-checks on status-pill colors, amber ADR ids, serif quotes,
  diff coloring, signal-card big-number colors.
- Dark tokens match (no hardcoded colors outside the ported CSS).
- Keyboard: Escape closes ADR; TOC focusable; buttons reachable.
- Real-data smoke: a project with one real `type="decision"` node shows REAL
  label/detail merged into the rich layout (not overwritten by seed prose).

---

## PR breakdown

1. **PR-1 · Decisions: seed module, types, CSS port, list parity.** Adds
   `lib/seed/decisions.ts` (SEED_DECISIONS + ADR_NARRATIVES + ADR_DEFAULT +
   seedAdrCounts), `AdrStatus`/`SeedDecision`/`AdrNarrative` types, `mergeDecisions`
   adapter, the full `.adr-*` + filter CSS port, rebuilt `DecisionCard` (`.adr-row`)
   and `app/decisions/page.tsx` (breadcrumb, head buttons, filter seg). Playwright:
   list/filter/conflict/deep-link. *(Largest visual surface; self-contained.)*
2. **PR-2 · Decisions: rich ADR detail (`AdrModal`).** Rebuilds
   `DecisionDetail.tsx` with TOC scroll-spy, meta grid, all 13 sections, footer,
   real-detail overlay, `goto` navigation. Playwright: detail sections, TOC
   scroll-spy, escape/overlay close. Depends on PR-1.
3. **PR-3 · Gate: bespoke conflict screen.** Rebuilds `app/gate/page.tsx` (banner
   + actions, info cards, conflict panel, diff, SignalCard, suggestion), adds
   `SignalCard`, `SEED_GATE` payload, real-brake hydration + multi-brake switcher,
   allow/skip wiring; retires `GateCard`. Playwright: render + real allow/skip +
   switcher. Independent of PR-1/2 (can parallelize).
4. **PR-4 (BACKEND-FEATURE) · ADR fields + lifecycle + record API.** Adds
   `status/owner/tags/narrative` storage (column/JSON or `adr_meta` table),
   read/write + transition + create endpoints; flips Decisions status/owner/
   actions from SEED to REAL incrementally. Pytest + Playwright. *(Follow-up; can
   land after the visual PRs.)*
5. **PR-5 (BACKEND-FEATURE) · Gate conflict payload.** Extends `Brake`/brake
   producer with structured conflict/diff/signals/suggestion so the Gate screen is
   REAL; swaps `SEED_GATE` for live data when present. Pytest + Playwright.

Sequencing: PR-1 → PR-2 (serial); PR-3 parallel; PR-4/PR-5 follow-up, each
shippable independently behind the SEED fallback so the rich UI never regresses.
