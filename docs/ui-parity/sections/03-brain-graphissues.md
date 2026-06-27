# Brain + GraphIssues parity

Reference files: `modules/mod_06.js` (BrainView / Explorer), `modules/mod_19.js` (GraphIssuesView).
Our files: `app/brain/page.tsx`, `components/brain/GraphCanvas.tsx`, `components/brain/NodeInfo.tsx`, `components/brain/BrainLegend.tsx`. GraphIssues: **NOT IMPLEMENTED** (no matching component/route — grep for `graph.issue`, `gi-graph`, `AI.generated`, `re-analyze` returns nothing).

---

## Reference: what it renders

### BrainView (mod_06) — "Explorer" tab
The reference Brain page is **NOT a free node-link canvas**. It is a structured three-column "Explorer":

- **Page head**: breadcrumb `Product brain · 847 nodes · 2,312 edges · ~/.spade/brain.sqlite` (mono path in `--text-3`). Right side: a `brain-search` input (`Ask the brain…`, search glyph, `⌘K` kbd badge), a `Find gaps` ghost button (spark icon), and an `Export to MCP` primary button (doc icon).
- **Subtabs row** under the head: `Explorer` (active), `Features · 28`, `Decisions · 94`, `Conventions · 41`, `Feedback · 312`, `Metrics · 18`, `Health`. Counts in `.muted`.
- **LEFT aside `.bx-tree`** (namespace tree): header `acme/web-app`; one `.bx-feature` row per feature with a `▸` chevron, name, and inline colored count badges (`{n}D` amber decisions, `{n}B` red bugs, `{n}U` teal feedback). Selected feature gets `.on`. Below, a second `Index` section lists type rows (Decisions 94, Conventions 41, Feedback 312, Bugs 208, Metrics 18) each with an 8px color dot + mono count.
- **CENTER `.bx-detail`** (rich record view, the focal element): a header with a colored type **glyph chip** (`meta.color+"1a"` bg, `+"40"` border, color text), an uppercase mono kicker `FEATURE · f-checkout`, a serif `.bx-title` heading, and `Edit` / `⋯` ghost actions. Then a `.bx-keys` grid (Type, Owner "Akira K.", Last touched "2 days ago", Source "2 meetings · 4 PRs", Confidence "● high" green, Coverage "86%"). For features, a serif `.bx-summary` paragraph. Then sections: **Description** (`.bx-prose` with inline `<code>` and `.bx-ref` ADR links), **Code surface** (`22 files · 4,128 LOC · last commit 4h ago` + a `.bx-files` list of path / `+x −y` diff / author rows), and **Activity** (a `.bx-activity` timeline of `.bx-evt` rows with mono timestamp, colored dot, and linked text).
- **RIGHT aside `.bx-relations`** (relations map): header `Relations · {n} edges`. A typographic radial **`.bx-anchor`**: a center pill (`.bx-anchor-center`, border tinted by node-type color) showing the glyph + label, surrounded by `.bx-anchor-spokes` — one `.bx-spoke` per neighbor type with a color dot, lowercase mono type name, and count. Then a divider and per-type **relation groups**: each `.bx-rel-group` has a header (glyph + label + count) and `.bx-rel-item` rows (colored bullet, label, mono id) that re-select on click. Finally an **MCP server** block: `∿` glyph, `localhost:8717`, `● connected · 2 sessions reading` (green dot).

### Type colors / glyphs (mod_06 + mod_19 — authoritative)
| Type | Color | Glyph |
|---|---|---|
| feature | `#c9b8ff` | F |
| decision | `#e6b86a` | D |
| convention | `#e69bb6` | C |
| feedback | `#7adcc7` (teal) | U |
| bug | `#e87d7d` | B |
| metric | `#7ab6e6` (blue) | M |

### GraphIssuesView (mod_19) — separate "Graph & Issues" view
- Page head: `Graph & Issues · {n} nodes visible · {n} AI issues`; ghost `Re-analyze subgraph` + primary `New manual issue`.
- **LEFT graph pane**: a **filter bar** (`.gi-filters`) with three groups — Node type chips (toggle, tinted when on), Source chips (Meetings/GitHub/Intercom/App Store/Manual), and an `Ingested` segmented control (Last 24h / 7d / 30d / Older, single-select cumulative). Below, an **SVG canvas** `viewBox 0 0 1000 620`, `xMidYMid meet`, with a radial `gi-bg` gradient rect. **Nodes are circles** (`r = n.r` from data, ~varied), fill `color+1a` (or `+33` when hi/selected), stroke = type color (width 2 when selected), a centered mono glyph (F/D/C/U/B/M, 10px), and a label below the circle at `cy + r + 12` (truncated to 22 chars). **Highlight rings**: hovered/selected/issue-context nodes get a `r+10` filled halo (opacity .10) + `r+5` stroked ring (.45); non-highlighted nodes dim to opacity .45. **Edges are straight `<line>`s** (rgba white .10; lit edges become `rgba(201,184,255,0.7)` width 1.4) and when lit show a **mid-edge relation label** in a rounded mono pill (`decides`, `applies to`, `affects`, `depends on`, …). A bottom-left `.gi-legend` (type dots+labels) and a `.gi-stats` overlay (`Subgraph N nodes · M edges`, `Focus: <label>`).
- **RIGHT issues pane** (`.gi-issues-pane`): header `AI-generated issues` + subtitle + mono count. A list of `.gi-issue` cards, each with: id (mono) + status pill (validated green ●, pending amber ○, rejected red ✕), title, summary, a **Suggested agent** role chip (Developer `{ }` blue, Reviewer `✓` pink, Integrator `⤳` teal, Documentor `¶` lavender — colored border/bg/desc), a **Context nodes** chip row (per-node type-colored chips, dimmed when filtered out, click selects), and a footer with `confidence NN%` (green/amber/red) + status-dependent action buttons (Validate/Reject, Open task, Reopen). Hovering a card lights its context nodes + edges in the graph. Empty state: "No issues match the current filters. Widen the subgraph…".

---

## Ours: what it renders

### Brain (`app/brain/page.tsx` + 3 components)
A **completely different layout** from the reference Explorer — ours is a free **node-link graph** flanked by two thin panels:

- **Page head** (`PageHead`): `Product brain · {n} nodes · {n} edges`. No sqlite path, **no brain-search input**, **no `Find gaps` / `Export to MCP` buttons**, **no subtabs row** (Explorer/Features/Decisions/…/Health).
- **LEFT `BrainLegend`** (`.brain-side`): `Node types` label + one toggle row per type (color dot, label, count), dimmed to opacity .4 when off. This is roughly the reference's `Index` block but with no namespace/feature tree above it.
- **CENTER `GraphCanvas`** (`.brain-canvas`): an SVG node-link graph. `viewBox 800×600`, `PAD 64`, radial lavender glow + `#0b0b0d` background painted on the element. **Nodes are pill rects** (rounded `#141418` fill, type-color stroke, `26px` tall, width derived from label length) carrying a **leading color dot (r 4–7 by degree) + inline label** — NOT circles-with-glyph. **Edges are cubic-bezier S-curves** (`rgba(201,184,255,0.16)`, focused links `0.7` width 1.6) — NOT straight lines, and have **no relation labels**. Focus/hover dims off-focus nodes to opacity .22 and adds a blurred ellipse halo behind the focused/selected pill. **Has pan (drag) + wheel-zoom + double-click-reset** — the reference Explorer has none of that (and mod_19's graph also has no pan/zoom).
- **RIGHT `NodeInfo`** (`.brain-info`): when a node is selected — a type `Chip`, an 18px label heading, markdown `detail`, an `Added <date>` mono line, optional record links (`View in Decisions`, grounded tasks → `/task/[id]`), then `Connections · N` grouped by relation verb with direction arrows (→/←), color dot, label, and type. When nothing selected — a custom empty-state SVG (node + cursor) with "Nothing selected" / hint. This is a much thinner panel than the reference `.bx-detail` (no keys grid, no summary, no Description/Code-surface/Activity sections) and lacks the reference's `.bx-anchor` radial diagram and MCP-server block.

### GraphIssues
**NOT IMPLEMENTED.** No component, route, filter bar, AI-issues pane, or status/role chips exist anywhere in the client.

---

## Diff table

| Aspect | Reference | Ours | Severity |
|---|---|---|---|
| **GraphIssues view (whole mod_19)** | Full filter bar + circle graph + AI-issues pane | Absent entirely | **Blocker** |
| **Brain overall layout** | 3-col Explorer: namespace tree / rich detail / relations map | 3-col node-link: legend / graph / thin info | **Blocker** |
| Brain is graph-first vs detail-first | Detail-first (graph only in mod_19) | Graph-first canvas | **Blocker** |
| Subtabs row (Explorer/Features/…/Health) | Present | Missing | Major |
| Brain-search input + `⌘K` | Present in head | Missing | Major |
| `Find gaps` / `Export to MCP` head buttons | Present | Missing | Major |
| Namespace tree (`acme/web-app`, feature rows w/ D/B/U badges) | Present (left aside) | Missing (only flat legend) | Major |
| `Index` type list w/ counts | Present (in tree aside) | Partially = our BrainLegend | Minor |
| Center rich record (keys grid, summary, Description, Code surface, Activity) | Present, dominant | Missing — only label + markdown + connections | Major |
| Relations radial `.bx-anchor` diagram | Present (right aside) | Missing | Major |
| MCP server status block | Present (right aside) | Missing | Major |
| **feedback ↔ metric color swap** | feedback=#7adcc7 teal, metric=#7ab6e6 blue | feedback=blue, metric=teal (`adapters.nodeColor`) | Major |
| Node glyphs (F/D/C/U/B/M) | Present (in mod_19 circles + mod_06 chips/spokes) | Absent (pills use dots, not glyphs) | Major |
| Node shape | Circles (r from data) w/ centered glyph (mod_19) | Pill rects w/ leading dot | Major |
| Edge style | Straight lines + mid-edge relation labels (mod_19) | Bezier S-curves, no labels | Major |
| Token palette (`--accent`/amber/red/blue/pink/teal) | matches | matches | OK |
| Pan / zoom / reset | None | Present (extra) | Minor |
| Connections grouping | By type, with anchor diagram + bullet rows | By relation verb, dir arrows | Minor |

---

## Concrete parity changes

1. **Build GraphIssuesView (largest gap).** New route/component mirroring mod_19: filter bar (type chips, source chips, ingested segmented control), an SVG **circle** graph (`viewBox 1000×620`, nodes = `circle r=n.r` + centered mono glyph + label below, highlight halos, straight `<line>` edges with mid-edge relation-label pills), bottom legend + stats overlay, and the right `AI-generated issues` pane (issue cards with status pills, role chips, context-node chips, confidence, actions). Add the role/status/source/relation-label metadata maps from mod_19.
2. **Fix the feedback/metric color swap** in `lib/adapters.ts::nodeColor`: feedback should be `--teal` (#7adcc7) and metric `--blue` (#7ab6e6) to match both reference modules.
3. **Reframe Brain as the Explorer (mod_06)**, not a free canvas — this is a structural rewrite, not a tweak:
   - Add the subtabs row (Explorer/Features/Decisions/Conventions/Feedback/Metrics/Health with counts).
   - Add head controls: brain-search input + `⌘K`, `Find gaps`, `Export to MCP`.
   - Left aside → namespace tree (`acme/web-app`, feature rows with `▸` + D/B/U inline count badges) above the Index type list.
   - Center → rich `.bx-detail` record: glyph chip + mono kicker + serif title + Edit/⋯, `.bx-keys` grid, feature `.bx-summary`, Description (`.bx-prose` + `.bx-ref` links), Code surface (`.bx-files`), Activity timeline (`.bx-evt`).
   - Right aside → `.bx-anchor` radial relations diagram + per-type relation groups + MCP-server status block.
4. **Add type glyphs (F/D/C/U/B/M)** wherever the reference shows them (graph nodes, anchor center/spokes, relation group headers, context chips).
5. If the free node-link canvas is kept as an additional surface, switch nodes to **circles + glyph** and edges to **straight lines with relation labels** to match mod_19 visuals; otherwise retire it.

---

## Suggested PR grouping

- **PR-A (small, mechanical):** fix feedback/metric color swap in `nodeColor`; add a shared `typeMeta` (color + glyph + label) helper. Low-risk, unblocks correct colors everywhere.
- **PR-B (large, new surface):** implement **GraphIssuesView** (mod_19) end-to-end — filter bar, circle graph, AI-issues pane, all metadata maps and CSS (`gi-*`). Self-contained new route.
- **PR-C (large, restructure):** rebuild Brain as the **Explorer** (mod_06) — subtabs, head controls, namespace tree, rich center detail, relations anchor + MCP block. Biggest effort; may split into C1 (shell: head + subtabs + tree) and C2 (center detail + relations aside).
- **PR-D (optional/cleanup):** reconcile the existing node-link canvas — either convert to mod_19 circle+glyph+straight-line style or remove in favor of the Explorer.
