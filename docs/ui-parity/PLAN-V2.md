# UI Parity V2 — Full Reference Clone

**Goal (corrected):** the app must look **identical to the reference mockup `docs/Spade (standalone).html`, including its rich data**. Earlier "no-fabrication" subsets were the wrong call. Now: build every reference section in full; **wire real API data where it exists, SEED the rest** (mirroring the reference `SpadeData`) so nothing looks empty; and for each genuinely-missing capability, ship a **planned backend follow-up PR + a validation test** that swaps seed→real behind the same component contract.

Detailed per-cluster build+test plans live in [`plan-v2/`](./plan-v2) (01-shell … 09-inputs-system). This file is the master ordering.

## Workflow (avoids the V1 stacked-PR mess)
- **Foundation first**, merged to `development`. Then each screen PR **branches off `development`** (which already has the foundation), stays self-contained, and **merges promptly** before the next. Screens touch mostly different files; the only shared file is `app/globals.css` (append-only per screen) — merging promptly keeps conflicts away.
- Every screen PR: **rich UI build + data (wire real / seed) + automated Playwright e2e + manual checklist.**
- All seeded values live in **one** demo module with `data-source="seed"` seams, so the backend follow-ups are a data-only swap.

---

## Phase 0 — Foundation (blocks everything)

- **F1 · Demo-data layer** — one module `lib/demo/` mirroring the reference `SpadeData` (mod_01): projects (incl. the demo `acme` so it matches the screenshots), tasks (+links/assignee/feedback/decisions/bugs/sprint/estimate/branch/metric), brainNodes (+owner/confidence/coverage/source/code-files/activity/MCP), pipelines (+cost/eta/progress/tokens/files/logs), accounts (+role/usage/model/plan/strengths/handoffs/strategy), chatThreads (+plan/action/cite payloads), decisions (+status/owner/13-section narratives/conflict), gate-conflict, meetings, feedbackClusters, cliRuns, integrations, sprints, triage/KPIs. **Real-wins helpers**: `realValue ?? seed`, keyed deterministically off the real record so live projects still show their data.
- **F2 · Shell** — `home-mode`/`workspace-level` machinery (full-bleed home, hide sidebar, lavender wash; CSS ported from `inner.html`); **split Brain vs Graph & Issues into two routes** (`/brain` = rich Explorer, `/graph-issues` = node graph; remove the Graph subtab); sidebar full parity (groups/icons/order + workspace groups); topbar **sprint pill** + account **usage %** (real where available, else seed). Remove the no-fabrication "Próximamente"/omission code. *(daemon · N sessions is already real & correct — keep, add a regression test.)*

## Phase 1 — Existing screens → full rich (each off `development`)

1. **Brain Explorer rich** — owner/confidence/coverage/source keys, serif summary, description w/ ADR links, code-surface file table, activity feed, MCP block, brain-search + ⌘K, Find-gaps / Export-to-MCP, real subtabs.
2. **Graph & Issues** — new route: filter bar, circle graph by type w/ relation labels, AI-issues pane.
3. **Backlog rich** — card intel-bar (correct type set incl. meeting) + ADR/mtg chips + assignee avatar (AI ◆ / building / flag), **full-height columns**, banner ADR-conflict chip.
4. **Task detail full** — Origin (quote/speaker/transcript), User-justification feedback-strip + quote cards, Architectural-context + Connected-bugs link-rows, Pipeline-history timeline, rich Properties rail (Assignee/Sprint/Estimate/Branch), Tracked-metric + Sparkline, Will-write-back.
5. **Orchestrator rich** — 6-cell KPI strip w/ sub-lines, Cost/ETA columns, expanded detail (progress bar, Context + Files-touched cards, **animated streaming live-log**) + **Active tasks** rich.
6. **Agent pool rich** — account-centric cards (usage meter/role/model/plan/current-issue + node chips) + Executions-in-progress table.
7. **Decisions rich** — filter seg + status pills + owner/feature/conflict chips + head actions; full ADR detail (TOC scroll-spy + 13 sections).
8. **Ask full** — shared `ChatPanel(mode)`, **dark bottom-right bubble + ⌘K side-dock**, full `/ask` page w/ thread/session list + search/pin/recent, rich messages (avatars/cites/**Plan**/**Action-diff ADR-EDIT** cards), @mention autocomplete.

## Phase 2 — New screens (each off `development`)

9. **Accounts (standalone)** — scope switcher, serif intro+stats, **PM→worker SVG graph** (OrchLines), dispatch-strategy selector, provider-filter tabs, handoff log.
10. **Gate** — bespoke conflict screen (banner+actions, Task/Why cards, 2-panel conflict, diff, 3 signal cards, reviewer suggestion); hydrate from a real brake when present.
11. **Home** — full-bleed triage dashboard (feed + KPI band + sortable projects health table).
12. **Overview** — per-project hero + KPI band + mini-charts + now-executing + 7-card grid.
13. **Sprints** — sprint hero + rows + stacked bar + burn-down svg.
14. **Meetings** — list + 5 fidelity detail layouts + highlight-evidence popover.
15. **Feedback** — cluster list ↔ detail, stacked source bar, quotes, platform pills.
16. **CLI / logs** — recent-runs sidebar + colorized log renderer.
17. **Settings** — grouped per-project automation toggles (reads real autopilot/strategy/ceiling).
18. **Integrations** — dual-mode (project/workspace) connection cards + shared tab strip.
19. **Workspace** — shell hosting global settings + ws-variants of Integrations/Agents pool.

## Phase 3 — Backend follow-ups (each = real feature + validation test, swaps seed→real)

Sprints API · Meetings ingest/extraction · Feedback clustering · Integrations connections · Account usage/role/model · Project-settings UPDATE/persist · Chat threads persistence + structured tool-output (cites/plan/action) + action wiring · Pipeline cost/eta/files/logs · ADR status/owner/narrative + lifecycle + record-decision · Gate structured conflict payload · Node provenance/activity/MCP/gap-analysis.

---

## Scale & approach
~19 UI PRs + 2 foundation + ~13 backend follow-ups. The **UI PRs reach full visual+seeded-data parity** (matches the screenshots); the **backend PRs make the seeded surfaces real**. I execute Phase 0 → 1 → 2 in order, merging each promptly; Phase 3 is a separate track you can prioritize later.
