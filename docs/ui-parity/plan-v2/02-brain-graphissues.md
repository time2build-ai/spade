# Brain Explorer + Graph & Issues — full-parity plan

> Goal: **full visual + data parity** with the reference mockup `docs/Spade (standalone).html`
> (modules `mod_06.js` = BrainView/Explorer, `mod_19.js` = GraphIssuesView), **including its rich
> demo data**. Where the real API supplies a field, wire it. Where it does not, **SEED** from a
> demo layer mirroring the reference `SpadeData`. Genuinely-missing backend features become a
> planned follow-up PR + a validation test that pins the seam.
>
> Reference source (read-only):
> - `…/scratchpad/modules/mod_06.js` — BrainView (rich Explorer)
> - `…/scratchpad/modules/mod_19.js` — GraphIssuesView (Graph & Issues)
> - `…/scratchpad/modules/mod_01.js` — `window.SpadeData` (brainNodes/brainEdges + demo enrichment)
> - `…/scratchpad/inner.html` — full CSS (`.bx-*`, `.gi-*`, `.subtabs`, …)
>
> Our code: `apps/client` — `app/brain/page.tsx`, `components/brain/{BrainExplorer,GraphCanvas,NodeInfo,BrainLegend}.tsx`, `lib/{adapters,api,types}.ts`, `app/globals.css`.

---

## Target (every reference section)

### A. Brain Explorer (mod_06) — route `/brain`, subtab "Explorer"

A **detail-first three-column layout** (`.brain-explorer`), NOT a free node-link canvas.

**A0. Page head** (`.page-head`)
- Breadcrumb: **`Product brain`** (bold) `· 847 nodes · 2,312 edges ·` then a mono path `~/.spade/brain.sqlite` in `--text-3`, `fontSize 11.5`.
- Right (`.page-head-right`):
  - `.brain-search` input — search glyph + placeholder `Ask the brain…` + a `⌘K` `.kbd` badge (`min-width 320px`).
  - Ghost button `Find gaps` (spark icon).
  - Primary button `Export to MCP` (doc icon).

**A1. Subtabs row** (`.subtabs`, under head)
- `Explorer` (active), `Features · 28`, `Decisions · 94`, `Conventions · 41`, `Feedback · 312`, `Metrics · 18`, `Health`. Counts in `.muted`.

**A2. LEFT aside — namespace tree** (`.bx-tree`)
- Header `.bx-tree-h`: `acme/web‑app`.
- One `.bx-feature` row per `type==="feature"` node: `▸` chevron (`.bx-chevron`), name (`.bx-fname`), and inline colored count badges (`.bx-fcounts`): `{n}D` amber decisions, `{n}B` red bugs, `{n}U` teal feedback — derived from that feature's neighbors. Selected → `.on`.
- Second header `.bx-tree-h` (`Index`) with type rows (`.bx-index-row`): `Decisions 94`, `Conventions 41`, `Feedback 312`, `Bugs 208`, `Metrics 18`, each = 8px color dot + label + mono count.

**A3. CENTER — rich record** (`.bx-detail`) — the focal element
- **Header** (`.bx-detail-h`): type **glyph chip** (`.bx-glyph`, bg `color+1a`, border `color+40`, fg `color`), uppercase mono kicker `FEATURE · <id>`, serif title (`.bx-title`), and `.bx-actions` (`Edit`, `⋯` ghost buttons).
- **Keys grid** (`.bx-keys`, 3-col): **Type**, **Owner** (`Akira K.`), **Last touched** (`2 days ago` mono), **Source** (`2 meetings · 4 PRs`), **Confidence** (`● high` green), **Coverage** (`86%` mono).
- **Serif summary** (`.bx-summary serif`) — features only; the lavender left-bar paragraph.
- **Description** section (`.bx-section-h` + `.bx-prose`): prose with inline `<code>` (`<CheckoutShell>`) and `.bx-ref` ADR cross-links (`ADR‑022`, `ADR‑018`, `ADR‑031`).
- **Code surface** section: header with mono sub `22 files · 4,128 LOC · last commit 4h ago`, then `.bx-files` table — `.bx-file` rows of `path` / `+x −y` diff / author (`rmurphy`, `claude/sess_8d2c`, `dan`, `maya`).
- **Activity** section: `.bx-activity` timeline of `.bx-evt` rows — `.bx-evt-time` (mono), `.bx-evt-dot` (type/event color), and linked text with `.bx-ref` (`#2118`, `Sprint Planning · Mar 25`, `ADR‑031`).

**A4. RIGHT aside — relations map** (`.bx-relations`)
- Header `.bx-rel-h`: `Relations` + mono `{n} edges`.
- `.bx-anchor` radial diagram: `.bx-anchor-center` pill (border `color+60`) with glyph + label; `.bx-anchor-spokes` — one `.bx-spoke` per neighbor type (color dot, lowercase mono type name, count).
- `.bx-rel-divider`, then per-type `.bx-rel-group`: header (glyph + label + count) and `.bx-rel-item` rows (`.bx-rel-bullet` + `.bx-rel-label` + mono `.bx-rel-id`) that re-select on click.
- **MCP server block** (`.bx-rel-group`): `∿` glyph, `MCP server` header, mono body `localhost:8717` / `● connected · 2 sessions reading` (green dot).

### B. Graph & Issues (mod_19) — **new route** `/graph-issues`

A two-pane layout (`.gi-wrap`, grid `1.55fr / 1fr`).

**B0. Page head**: breadcrumb `Graph & Issues · {visible} nodes visible · {n} AI issues`; ghost `Re-analyze subgraph` (spark) + primary `New manual issue` (plus).

**B1. LEFT graph pane** (`.gi-graph-pane`)
- **Filter bar** (`.gi-filters`), three `.gi-fgroup`s:
  - `Node type` (`.gi-flabel`): 6 toggle chips (`.gi-chip type`), tinted (`color+12` bg / `color+55` border / `color` text) when on, `.off` opacity .42 when off, each with `.gi-chip-dot`.
  - `Source`: 5 toggle chips — `Meetings`, `GitHub`, `Intercom`, `App Store`, `Manual`.
  - `Ingested`: single-select cumulative segmented control (`.gi-seg` / `.gi-seg-btn`) — `Last 24h`, `Last 7 days`, `Last 30 days`, `Older` (default `30d`).
- **SVG canvas** (`.gi-canvas`, `viewBox 0 0 1000 620`, `xMidYMid meet`):
  - `defs` radial gradient `gi-bg` + bg `rect`.
  - **Edges**: straight `<line>` (`rgba(255,255,255,0.10)`; lit → `rgba(201,184,255,0.7)` width 1.4). Lit edges show a **mid-edge relation-label pill** (rounded rect + mono text) using `relLabel(a,b)` → `decides` / `applies to` / `reported on` / `affects` / `measured by` / `caused by` / `depends on` / `related`.
  - **Nodes**: `<circle r={n.r}>` fill `color+1a` (`+33` when hi/selected), stroke = type color (width 2 when selected); centered mono **glyph** (F/D/C/U/B/M); label below at `cy + r + 12` (truncate >22 chars). Highlight halos: `r+10` filled (.10) + `r+5` stroked ring (.45); non-highlighted dim to opacity .45.
  - **Highlight wiring**: hovered issue → its `contextNodes`; else hovered node; else selected node.
- **Legend** (`.gi-legend`, bottom-left): 6 type dot+label rows.
- **Stats overlay** (`.gi-stats`, top-right): `Subgraph {N} nodes · {M} edges`; `Focus: <label>` colored by type.

**B2. RIGHT issues pane** (`.gi-issues-pane`)
- Header (`.gi-issues-h`): `AI‑generated issues` (`.gi-issues-title`) + subtitle `Synthesized from the visible subgraph · re-rank when filters change` + mono `.gi-issues-count`.
- `.gi-issues-list` of `.gi-issue` cards (hover → `.hover`, lights context nodes). Each card:
  - `.gi-issue-h`: mono id + `.gi-issue-status` pill (validated green `●`, pending amber `○`, rejected red `✕`).
  - `.gi-issue-title` + `.gi-issue-summary` (dashed bottom border).
  - **Suggested agent** (`.gi-issue-meta` + `.gi-issue-section`): `.gi-role` chip — Developer `{ }` blue / Reviewer `✓` pink / Integrator `⤳` teal / Documentor `¶` lavender, with agent name + `· <desc>`.
  - **Context nodes**: `.gi-ctx-chips` of `.gi-ctx-chip` (type-colored; `.out` strike-through + dim when filtered out; click selects node in graph).
  - `.gi-issue-foot`: `confidence NN%` (green ≥80 / amber ≥60 / red) + status-dependent `.gi-issue-actions` (`Validate`/`Reject`, `Open task`, `Reopen`).
- Empty state: `No issues match the current filters. Widen the subgraph to see suggestions.`

### C. Type metadata (authoritative, mod_06 + mod_19)
| Type | Token | Hex | Glyph |
|---|---|---|---|
| feature | `--accent` | `#c9b8ff` | F |
| decision | `--amber` | `#e6b86a` | D |
| convention | `--pink` | `#e69bb6` | C |
| feedback | `--teal` | `#7adcc7` | U |
| bug | `--red` | `#e87d7d` | B |
| metric | `--blue` | `#7ab6e6` | M |

Already correct in `lib/adapters.ts::NODE_TYPE_META` (the earlier feedback/metric swap is **fixed**).

---

## Current state (what's too sparse / mis-placed)

- **Explorer center is far too sparse.** `BrainExplorer.tsx` deliberately renders only `Type / Created / Edges` keys and a single `Description` block (its own comment says the reference's "invented content … is intentionally omitted"). **Missing vs target:** Owner / Last touched / Source / Confidence / Coverage keys; the serif `.bx-summary`; ADR `.bx-ref` cross-links in the description; the **Code surface** `.bx-files` table; the **Activity** `.bx-evt` timeline; `Edit`/`⋯` `.bx-actions`; the MCP-server block in the right aside. The `.bx-anchor` radial + per-type relation groups **are** already built and correct.
- **Page head is bare.** `app/brain/page.tsx` renders only `Product brain · N nodes · M edges` via `PageHead` — **no** sqlite path, **no** `.brain-search`/`⌘K`, **no** `Find gaps`/`Export to MCP` buttons.
- **Subtabs are wrong.** Current subtabs are only `Explorer` / `Graph` (an in-page view toggle). Target is `Explorer / Features · 28 / Decisions · 94 / Conventions · 41 / Feedback · 312 / Metrics · 18 / Health`, and **the graph must NOT be a Brain subtab** — it moves to a separate `/graph-issues` route.
- **Graph & Issues does not exist.** Sidebar already lists `Graph & Issues` (`components/shell/Sidebar.tsx:41`) but `href: "#"` (placeholder, non-navigating). No route, filter bar, circle graph, relation-label pills, or AI-issues pane anywhere.
- **The legacy free canvas** (`GraphCanvas.tsx` + `NodeInfo.tsx` + `BrainLegend.tsx`, the `view==="graph"` branch) is bezier-pill styling, not mod_19's circle+glyph+straight-line+relation-label style. It is reachable only through the soon-to-be-removed `Graph` subtab.
- **Missing CSS.** `.bx-summary`, `.bx-section-h` (have), `.bx-prose` (have), `.bx-ref`, `.bx-files`, `.bx-file`, `.bx-activity`, `.bx-evt`, `.bx-evt-time`, `.bx-evt-dot` are **absent** from `app/globals.css` and must be ported verbatim. **All** `.gi-*` classes are absent. `.brain-search`, `.bx-keys`, `.bx-anchor`, `.bx-rel-*`, `.subtabs`, `.kbd`, `.page-head*`, `btn.xs/.ghost/.primary` already exist.
- **Icons differ from reference.** Reference uses `<svg><use href="#i-search"/>`; our codebase uses an inline `components/Icon.tsx` map. Use `Icon` (add any missing glyphs: `search`, `spark`, `doc`, `plus`) — do **not** introduce `<use href>`.

---

## Build steps

### Step 0 — Shared foundations

**0a. CSS port** (`app/globals.css`). Copy verbatim from `inner.html`:
- Rich Explorer classes (lines ~4153–4197): `.bx-summary`, `.bx-ref`, `.bx-files`, `.bx-file`, `.bx-activity`, `.bx-evt`, `.bx-evt-time`, `.bx-evt-dot`. (`.bx-section-h`, `.bx-prose`, `.bx-keys`, `.bx-glyph`, `.bx-title`, `.bx-actions`, `.bx-anchor*`, `.bx-rel-*` already present — diff and reconcile, don't duplicate.)
- **All** `.gi-*` classes (lines ~1416–1602): `.gi-wrap`, `.gi-graph-pane`, `.gi-filters`, `.gi-fgroup`, `.gi-flabel`, `.gi-chip`(+`.off`,`.type`), `.gi-chip-dot`, `.gi-seg`, `.gi-seg-btn`(+`.on`), `.gi-canvas-wrap`, `.gi-canvas`, `.gi-node text`, `.gi-edge`, `.gi-legend`(+`-row`,`-dot`), `.gi-stats`, `.gi-issues-pane`, `.gi-issues-h`, `.gi-issues-title`, `.gi-issues-count`, `.gi-issues-list`, `.gi-issue`(+`.hover`,`-h`,`-id`,`-status`,`-title`,`-summary`,`-meta`,`-section`,`-foot`,`-actions`), `.gi-role`(+`-glyph`,`-name`,`-desc`), `.gi-ctx-chips`, `.gi-ctx-chip`(+`.out`,`-glyph`,`-label`), plus the 3 responsive `@media` blocks.
- Ensure a `.serif` utility exists (reference `.bx-summary serif`); if absent, add `font-family: var(--serif)` rule.

**0b. `Icon` glyphs** (`components/Icon.tsx`): add any missing — `search`, `spark`, `doc`, `plus`. Match the reference `#i-*` shapes closely enough for visual parity.

**0c. Demo/seed layer** (`lib/brainDemo.ts`, NEW). A single module that mirrors the reference SpadeData enrichment so both views import the same seeds:
- `typeMeta` re-export (use existing `NODE_TYPE_META`; add `glyph`/`label` already present).
- `relLabel(a,b)` — the type-pair → verb map (mod_19 lines 15–26).
- `sourceMeta` + `sources` + `dateBuckets`/`dateLabel` (mod_19 lines 29–38).
- `enrichNode(node, i)` — deterministic `{source, date}` from id/index (mod_19 lines 39–44).
- `AI_ISSUES` — the 7 issue objects (mod_19 lines 71–100), verbatim ids/titles/contextNodes/status/confidence/agent/summary.
- `roleMeta` + `statusMeta` (mod_19 lines 112–122).
- **Per-feature record seed** (`featureSeed(id)`): keys (`owner`, `lastTouched`, `source`, `confidence`, `coverage`), serif `summary`, description prose + ADR refs, `codeSurface` (files list + `22 files · 4,128 LOC · last commit 4h ago`), `activity` events. Mirror mod_06 center-record content. Provide a generic fallback for non-checkout features and non-feature nodes (e.g. derive `owner`, `confidence`, `coverage` deterministically; omit code-surface/summary for non-features as the reference does).
- **Header counts** (`brainCounts`): `847 nodes · 2,312 edges`, subtab counts (`Features 28`, `Decisions 94`, `Conventions 41`, `Feedback 312`, `Metrics 18`), Index counts (`Bugs 208`), MCP block (`localhost:8717`, `2 sessions reading`), sqlite path `~/.spade/brain.sqlite`. These are **SEED display chrome** — see Data sourcing.

> Seeding rule: **real node identity always wins.** Seeds fill only the fields the API does not return (owner, confidence, code surface, activity, etc.). Node `id`/`type`/`label`/`detail`/edges come from the API; if the API returns `detail`, prefer it over seeded prose.

### Step 1 — Brain Explorer richness (mod_06)

Rewrite `components/brain/BrainExplorer.tsx` center column to full parity; keep the already-correct left tree + right anchor/relation groups, add the MCP block.

1. **Keys grid** (`.bx-keys`) → 6 cells: Type (real), Owner / Last touched / Source / Confidence (`● high`, green) / Coverage (mono %) — from `featureSeed`. Keep `Type` from `NODE_TYPE_META[sel.type].label`.
2. **Serif summary** (`.bx-summary serif`) — render for `sel.type==="feature"` from `featureSeed(sel.id).summary`.
3. **Description** — render `featureSeed.descriptionNodes` (JSX with inline `<code>` + `.bx-ref` ADR links); fall back to real `sel.detail` when the seed has none. ADR refs are `.bx-ref` spans (click → no-op or select matching `d-*` node if present).
4. **Code surface** — `.bx-section-h` with mono sub + `.bx-files`/`.bx-file` rows from `featureSeed.codeSurface` (features only).
5. **Activity** — `.bx-activity`/`.bx-evt` rows from `featureSeed.activity` (dot color from event type, mono time, `.bx-ref` links).
6. **Header actions** — add `.bx-actions` `Edit` / `⋯` ghost buttons (visual only; `Edit` may be disabled-stub until backend).
7. **MCP block** (right aside) — append a final `.bx-rel-group` with `∿` + `MCP server` + mono `localhost:8717` / green `●` `connected · 2 sessions reading`.

Update `app/brain/page.tsx`:
8. **Page head** — replace bare `PageHead` title-only with: breadcrumb (`Product brain` bold + `· {nodes} nodes · {edges} edges · <mono sqlite path>`) and `actions` = `.brain-search` (search Icon + `Ask the brain…` input + `⌘K` `Kbd`) + `Find gaps` ghost + `Export to MCP` primary. (`brain-search` opens the Ask dock — reuse `useAskDock` if trivial; otherwise a focusable input stub.)
9. **Subtabs** — replace `Explorer/Graph` with `Explorer`(active) + `Features · 28` / `Decisions · 94` / `Conventions · 41` / `Feedback · 312` / `Metrics · 18` / `Health` (counts from `brainCounts`; non-Explorer tabs are inert/visual for now). **Remove the `view==="graph"` branch** and the `Graph` subtab.
10. Keep real-data loading/empty/error states (`StateMessage`).

### Step 2 — Graph & Issues route (mod_19)

1. **Route**: `app/graph-issues/page.tsx` (client). Loads `api.brainNodes` + `api.brainEdges` for `useProject()`; reuses loading/empty/error pattern from Brain.
2. **Component**: `components/graph/GraphIssues.tsx` — direct port of mod_19:
   - State: `activeTypes` (Set, all on), `activeSources` (Set, all on), `activeDate` (`"30d"`), `selected` (default first feature / `f-checkout`-equivalent), `hovered`, `hoverIssue`.
   - `enriched` = nodes mapped through `enrichNode`; `byId` index.
   - `dateAllows` cumulative window; `visibleNodes`/`visibleIds`/`visibleEdges` filtering.
   - `issues` = `AI_ISSUES` filtered to those with ≥1 visible context node; re-rank/recount on filter change.
   - `highlightSet` wiring (hoverIssue → contextNodes; else hovered; else selected).
3. **Filter bar** (`.gi-filters`) — type chips / source chips / ingested segmented control, exact classes + tint logic.
4. **SVG graph** (`.gi-canvas`, `viewBox 1000×620`) — `toX/toY` mappers (`PAD 60`); edges (straight + lit relation-label pills via `relLabel`); circle nodes (`r=n.r`, glyph, label, halos, dim). **Nodes need `x`/`y`/`r`** — see Data sourcing (SEED layout when API lacks coords).
5. **Legend** (`.gi-legend`) + **stats** (`.gi-stats`) overlays.
6. **Issues pane** (`.gi-issues-pane`) — header + `.gi-issue` cards (status pill, title, summary, role chip, context-node chips, confidence, actions, empty state). Card hover lights context nodes.
7. **Sidebar**: change `components/shell/Sidebar.tsx:41` `Graph & Issues` `href: "#"` → `href: "/graph-issues"` (so it navigates + active-state highlights).

### Step 3 — Legacy canvas reconciliation

The old free canvas (`GraphCanvas.tsx`, `NodeInfo.tsx`, `BrainLegend.tsx`, `brain-wrap`/`brain-canvas`/`brain-side` CSS) is no longer reachable once the Brain `Graph` subtab is removed. **Delete** these three components + their CSS + the `brain.test.tsx`/`brain-style.spec.ts` assertions that target them, OR keep `BrainLegend` only if reused by Graph & Issues (it is not — `.gi-legend` is the parity legend). Recommend deletion to avoid two divergent graph implementations. Confirm no other importers (`grep`).

---

## Data sourcing (per field)

Legend: **REAL** `api:<field>` wired now · **SEED** value/shape mirrored from SpadeData · **BACKEND-FEATURE** needs new backend work (follow-up PR + seam test).

### Brain Explorer — left tree & index
| Field | Source |
|---|---|
| feature rows (label, id) | **REAL** `api.brainNodes` (`type==="feature"`) |
| per-feature D/B/U counts | **REAL** derived from `api.brainEdges` neighbors |
| Index type counts (Decisions/Conventions/Feedback/Bugs/Metrics) | **REAL** count of real nodes per type **+ SEED** display totals (`94/41/312/208/18`) when real graph is small — show real count, fall back to seed only if `0` (decide per-project; default REAL) |
| namespace header `acme/web‑app` | **SEED** `brainCounts.namespace` (could be **REAL** `project.slug` — prefer `projectSlug(project)`) |

### Brain Explorer — center record
| Field | Source |
|---|---|
| glyph, kicker `TYPE · id`, title | **REAL** `node.type` / `node.id` / `node.label` |
| Keys → Type | **REAL** `NODE_TYPE_META[type].label` |
| Keys → Owner | **BACKEND-FEATURE** (no owner on `BrainNode`) → **SEED** `Akira K.` / deterministic per node |
| Keys → Last touched | **BACKEND-FEATURE** (no `updated_at`) → **SEED** `2 days ago`; partial REAL: derive from `created_at` if present |
| Keys → Source (`2 meetings · 4 PRs`) | **BACKEND-FEATURE** (no provenance edges surfaced) → **SEED** |
| Keys → Confidence (`● high`) | **BACKEND-FEATURE** → **SEED** |
| Keys → Coverage (`86%`) | **BACKEND-FEATURE** → **SEED** |
| Serif summary | **SEED** `featureSeed.summary` (prefer real `detail` if it reads as a summary) |
| Description prose + ADR refs | **REAL** `node.detail` when present; **SEED** prose + `.bx-ref` ADR links otherwise. ADR link targets = real `decision` nodes if id matches, else inert |
| Code surface (file list, LOC, last commit) | **BACKEND-FEATURE** (no code-surface API; relates to GitHub integration) → **SEED** `featureSeed.codeSurface` |
| Activity feed | **BACKEND-FEATURE** (no per-node event log API) → **SEED** `featureSeed.activity` |
| `Edit` / `⋯` actions | **BACKEND-FEATURE** (no node-edit endpoint) → visual stub |

### Brain Explorer — right relations
| Field | Source |
|---|---|
| anchor center + spokes + per-type groups + items | **REAL** from `api.brainEdges` neighbors grouped by type |
| edge count | **REAL** |
| MCP server `localhost:8717` / `2 sessions reading` | **BACKEND-FEATURE** (no MCP status API) → **SEED** |

### Brain Explorer — page head
| Field | Source |
|---|---|
| node/edge totals in breadcrumb | **REAL** (`nodes.length` / `edges.length`); **SEED** `847 / 2,312` only as reference parity copy if real graph empty |
| sqlite path `~/.spade/brain.sqlite` | **BACKEND-FEATURE**/**SEED** (could be **REAL** `project.path`-derived) |
| subtab counts (`Features · 28`, …) | **REAL** per-type counts; **SEED** reference totals as fallback |
| `Find gaps` / `Export to MCP` | **BACKEND-FEATURE** (no gap-analysis / MCP-export endpoint) → visual stubs |
| brain-search `Ask the brain…` | **REAL** wire to existing Ask dock (`useAskDock`) |

### Graph & Issues
| Field | Source |
|---|---|
| nodes (id/type/label) + edges | **REAL** `api.brainNodes`/`api.brainEdges` |
| node `x`/`y` layout coords | **REAL** `node.x`/`node.y` when non-null; **SEED** deterministic layout (mirror reference normalized `[0,1]` coords, or a simple force/grid fallback) when null |
| node `r` (radius) | **BACKEND-FEATURE** (no radius) → **SEED** from degree (mirror reference `r` 5–22 by importance) |
| edge relation label (`decides`, `affects`, …) | **REAL** `edge.rel` when present; else **SEED** via `relLabel(typeA,typeB)` |
| node `source` (Meetings/GitHub/…) | **BACKEND-FEATURE** (no ingest-source on node) → **SEED** `enrichNode` deterministic |
| node `date` bucket (24h/7d/30d/older) | **BACKEND-FEATURE** → **SEED** `enrichNode` deterministic |
| AI issues (7 cards: id/title/summary/status/confidence/agent/contextNodes) | **BACKEND-FEATURE** (no AI-issue synthesis API) → **SEED** `AI_ISSUES` verbatim |
| role/status meta, confidence coloring | **SEED** (presentation) |
| `Re-analyze subgraph` / `New manual issue` / Validate/Reject/Open task/Reopen | **BACKEND-FEATURE** (no issue endpoints) → visual stubs |

### Backend follow-up (one consolidated PR + seam tests)
Genuinely-missing backend features, to be specified in a follow-up: node **provenance/source + ingest date**, node **owner + updated_at**, **confidence/coverage** scoring, **code-surface** (GitHub-linked file list), per-node **activity log**, **MCP server status**, **gap analysis** (`Find gaps`), **MCP export**, and **AI-issue synthesis** + issue lifecycle (validate/reject/open-task). Each currently SEEDed field gets a validation test asserting the UI renders the seam (so wiring the real endpoint later is a drop-in).

---

## Validation

### Playwright — `e2e/brain-explorer.spec.ts` (extend) — rich Explorer
Mock `/api/brain/{nodes,edges}` + `/api/tasks` (existing pattern). Assert:
- `.brain-explorer` has `.bx-tree`, `.bx-detail`, `.bx-relations`.
- Page head: `.brain-search input[placeholder="Ask the brain…"]`, `.kbd` = `⌘K`, buttons `Find gaps` + `Export to MCP`, mono sqlite path visible.
- Subtabs: `Explorer` active + `Features`, `Decisions`, `Conventions`, `Feedback`, `Metrics`, `Health` present; **no** `Graph` subtab.
- Center keys grid (`.bx-keys`) shows all 6 labels: `Type`, `Owner`, `Last touched`, `Source`, `Confidence`, `Coverage`; Confidence cell has a green `●`.
- `.bx-summary` visible for a selected feature.
- `.bx-prose` contains at least one `.bx-ref` (ADR link).
- **Code surface**: `.bx-files` present with ≥1 `.bx-file` row; mono sub matches `/\d+ files · [\d,]+ LOC/`.
- **Activity**: `.bx-activity` with ≥1 `.bx-evt` (each has `.bx-evt-time` + `.bx-evt-dot`).
- Right aside: `.bx-anchor-center` glyph+label; ≥1 `.bx-rel-group`; clicking a `.bx-rel-item` re-selects (title changes); **MCP block** text `localhost:8717` + `connected`.
- Tree: a `.bx-feature.on` exists; feature rows show D/B/U `.bx-fcounts`.

### Playwright — `e2e/graph-issues.spec.ts` (NEW)
Mock brain endpoints (seed nodes with `x/y/r`, mixed types, ≥1 of each context id used by issues). Assert:
- Navigates from sidebar `Graph & Issues` → `/graph-issues`; `.gi-wrap` visible.
- Page head breadcrumb matches `/Graph & Issues · \d+ nodes visible · \d+ AI issues/`.
- Filter bar: 6 `.gi-chip.type`, 5 source chips, `.gi-seg` with 4 `.gi-seg-btn` (`30d` `.on` by default).
- Canvas: `svg.gi-canvas` with `≥1` `circle` (node) + `line` (edge); a node `<text>` shows a glyph (F/D/…).
- Toggling off a node-type chip reduces visible nodes (stats overlay number drops); the chip gets `.off`.
- `.gi-stats` shows `Subgraph … nodes · … edges`; selecting a node updates `Focus:`.
- Issues pane: `.gi-issues-title` = `AI‑generated issues`; ≥1 `.gi-issue` with `.gi-issue-status`, `.gi-issue-title`, `.gi-role`, `.gi-ctx-chips`, confidence text; hovering a `.gi-issue` adds `.hover`.
- Filter to empty subgraph → empty-state copy `No issues match the current filters`.
- Lit-edge relation label: hover/select a connected node → a mid-edge `<text>` (e.g. `decides`/`affects`) appears.

### Color/glyph parity — `e2e/brain-style.spec.ts` (extend/retarget)
- Reassert the 6 RGB + glyph rows from `NODE_TYPE_META` (already correct) against the **Graph & Issues** circle nodes + legend (retarget away from deleted legacy canvas).

### Unit — `lib/__tests__/brainDemo.test.ts` (NEW)
- `relLabel` returns each verb for the right type pair; fallback `related`.
- `enrichNode` is deterministic (same id+index → same source/date).
- `AI_ISSUES` length = 7; each `contextNodes` non-empty; statuses ∈ {validated,pending,rejected}.
- `featureSeed` returns all 6 key fields + non-empty codeSurface/activity for a feature; graceful fallback for non-features.

### Manual checklist
- [ ] `/brain` Explorer matches mod_06 section-by-section (head, subtabs, tree, rich center, relations + MCP).
- [ ] Selecting tree features and relation items swaps the whole center record + anchor.
- [ ] `/graph-issues` matches mod_19 (filters drive graph + issues; hover issue lights subgraph; relation-label pills on lit edges).
- [ ] Sidebar `Graph & Issues` navigates and shows active state.
- [ ] No leftover `Graph` subtab inside Brain; legacy canvas gone.
- [ ] All SEED fields visually match reference copy; nothing crashes when API returns sparse/real nodes.
- [ ] `pnpm test` + `pnpm exec playwright test` green; typecheck clean.

---

## PR breakdown (ordered)

1. **PR-1 — Foundations (CSS + Icon + demo layer).** Port missing `.bx-*` rich CSS + all `.gi-*` CSS verbatim; add `Icon` glyphs (`search`/`spark`/`doc`/`plus`); add `lib/brainDemo.ts` (relLabel, enrich, AI_ISSUES, role/status/source meta, `featureSeed`, `brainCounts`) + `lib/__tests__/brainDemo.test.ts`. No UI wiring yet. Low-risk, unblocks 2 + 3.
2. **PR-2 — Brain Explorer full richness (mod_06).** Rewrite `BrainExplorer.tsx` center (6-key grid, serif summary, ADR-linked description, code-surface table, activity timeline, MCP block); upgrade `app/brain/page.tsx` head (breadcrumb + sqlite path + brain-search/⌘K + Find gaps/Export to MCP) and subtabs (Features/Decisions/…/Health); remove the `Graph` subtab + `view==="graph"` branch. Extend `e2e/brain-explorer.spec.ts`.
3. **PR-3 — Graph & Issues route (mod_19).** New `app/graph-issues/page.tsx` + `components/graph/GraphIssues.tsx` (filter bar, circle graph w/ glyphs + relation-label pills + halos, legend, stats, AI-issues pane). Point sidebar `Graph & Issues` → `/graph-issues`. Add `e2e/graph-issues.spec.ts`; retarget `brain-style.spec.ts` color/glyph checks to the new canvas.
4. **PR-4 — Legacy canvas removal + cleanup.** Delete `GraphCanvas.tsx` / `NodeInfo.tsx` / `BrainLegend.tsx` (confirm no importers), prune their CSS (`brain-wrap`/`brain-canvas`/`brain-side`/bezier styles) and stale `brain.test.tsx` assertions. Pure cleanup once 2 + 3 land.
5. **PR-5 (follow-up) — Backend seams.** Spec + implement the genuinely-missing backend: node provenance/source/date, owner/updated_at, confidence/coverage, code-surface (GitHub), per-node activity, MCP status, gap-analysis, MCP-export, AI-issue synthesis + lifecycle. Replace SEED reads with REAL where added; each currently-stubbed control gets wired + a seam test flips from "renders stub" to "calls endpoint".

> Optional split: PR-2 may split into **2a** (page-head + subtabs + tree) and **2b** (rich center detail + MCP block) if review size warrants.
