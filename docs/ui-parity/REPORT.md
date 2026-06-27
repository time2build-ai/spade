# Spade UI Parity Report — PoC vs. Reference Mockup

**Goal:** make our client (`apps/client`, Next.js 16 / React 19 / Tailwind v4) look **identical** to the reference single-file mockup `Spade (standalone).html`.

**Method:** the reference is a bundled Claude-artifact. Its source was decompressed (gzip+base64 → 27 JS modules + the inner shell HTML with the real `:root` design tokens). Each screen-cluster was compared against our implementation by a dedicated agent. Per-cluster detail lives in [`sections/`](./sections); this file is the executive synthesis + the parity matrix.

---

## TL;DR

- **Design tokens already match exactly.** Our `app/globals.css` `:root` palette is byte-identical to the reference (`--bg #0b0b0d`, `--accent #c9b8ff/#8e7dff`, the status colors, etc.), and the three fonts (Instrument Serif / Inter Tight / JetBrains Mono) are wired correctly. So this is **not** a color/typography exercise — it's **structure, missing screens, and missing shell machinery**.
- **The gap is large.** The reference has **20 screens**; we have meaningful versions of **~7**, and even those diverge structurally. **9 screens are entirely unbuilt.** Two of our existing screens (Brain, Gate) are the *wrong shape*, not just unstyled.
- **One load-bearing foundation gap:** the shell has no `home-mode` (full-bleed) or `workspace-level` mode, and the sidebar is missing the entire **Workspace** and **Projects** nav groups. Several screens can't exist correctly until this lands.
- **Cross-cutting data caveat:** many reference screens render rich mock data (`SpadeData`) our real API doesn't expose (account usage/role/limits, ADR narrative sections, feedback quotes, sprint burn-down). For **UI** parity we seed equivalent fixtures/adapters; true data-backed versions are follow-up work. Flagged per-PR in the plan.

---

## Parity matrix

Status: ✅ present & close · 🟡 present but structurally diverges · 🔴 not implemented

| # | Screen | Ref module | Our status | Blocker / Major / Minor | Section |
|---|--------|-----------|-----------|--------------------------|---------|
| — | **Shell / design system / nav** | `inner.html` + `mod_22` | 🟡 tokens match; nav groups + home/workspace modes missing | 3 / 4 / ~10 | [01](./sections/01-shell.md) |
| 1 | Home (cross-project triage) | `mod_04` | 🔴 `app/page.tsx` just redirects | part of 5 / 7 / 2 | [02](./sections/02-home-overview.md) |
| 2 | Overview (per-project) | `mod_03` | 🔴 no route | ↑ | [02](./sections/02-home-overview.md) |
| 3 | Brain (knowledge graph) | `mod_06` | 🟡 graph-first; ref is 3-col Explorer | 3 / 9 / 4 | [03](./sections/03-brain-graphissues.md) |
| 4 | GraphIssues | `mod_19` | 🔴 no route | ↑ | [03](./sections/03-brain-graphissues.md) |
| 5 | Backlog (board) | `mod_11` | 🟡 5 cols vs 4 + blocked banner; no head actions | 2 / 9 / 7 | [04](./sections/04-backlog-task-sprints.md) |
| 6 | Task detail | `mod_08` | 🟡 scaffold present; evidence blocks missing | ↑ | [04](./sections/04-backlog-task-sprints.md) |
| 7 | Sprints | `mod_14` | 🔴 no route/CSS | ↑ | [04](./sections/04-backlog-task-sprints.md) |
| 8 | Orchestrator | `mod_18` | 🟡 card-list + side terminal; ref is data table | 3 / 13 / 6 | [05](./sections/05-orchestrator.md) |
| 9 | ActiveTasks | `mod_21` | 🔴 no route | ↑ | [05](./sections/05-orchestrator.md) |
| 10 | Agent Pool | `mod_25` | 🟡 session-grid; ref is account-centric + executions table | 3 / 9 / 3 | [06](./sections/06-agentpool-accounts.md) |
| 11 | Accounts (standalone) + PM→worker graph | `mod_23` | 🔴 no route | ↑ | [06](./sections/06-agentpool-accounts.md) |
| 12 | Decisions (ADR list) | `mod_24` | 🟡 rows + open; no filters/pills/owner | 1 / 28 / 9 | [07](./sections/07-decisions-gate.md) |
| 13 | ADR detail | `mod_24` | 🟡 centered modal; ref is docked aside + 13 sections | ↑ | [07](./sections/07-decisions-gate.md) |
| 14 | Gate (conflict) | `mod_15` | 🔴 generic brake-queue; ref is bespoke conflict screen | ↑ | [07](./sections/07-decisions-gate.md) |
| 15 | Ask page | `mod_02` | 🔴 no `/ask` route | 2 / 11 / 9 | [08](./sections/08-ask-chat.md) |
| 16 | Chat (panel/bubble/dock) | `mod_10` + `mod_12` | 🟡 dock only; no bubble/side-dock, thin messages | ↑ | [08](./sections/08-ask-chat.md) |
| 17 | Meetings | `mod_17` | 🔴 not implemented (L) | — | [09](./sections/09-missing-screens.md) |
| 18 | Feedback | `mod_07` | 🔴 not implemented (M) | — | [09](./sections/09-missing-screens.md) |
| 19 | CLI / logs | `mod_13` | 🔴 not implemented (S) | — | [09](./sections/09-missing-screens.md) |
| 20 | Integrations | `mod_05` | 🔴 not implemented (L) | — | [09](./sections/09-missing-screens.md) |
| 21 | Settings | `mod_16` | 🔴 not implemented (M) | — | [09](./sections/09-missing-screens.md) |
| 22 | Workspace shell | `mod_09` | 🔴 not implemented (M) | — | [09](./sections/09-missing-screens.md) |

**Roughly:** ~20 blocker-level gaps, ~90 major, ~50 minor — concentrated in (a) the 9 unbuilt screens and (b) the structural mismatches in Brain, Orchestrator, Decisions, Gate, Agent Pool, and Ask.

---

## Themes (what's actually wrong, beyond per-screen detail)

1. **Missing shell machinery.** No full-bleed `home-mode`; no `workspace-level` mode (lavender tint + nav swap); sidebar missing the Workspace + Projects groups and the Ask `⌘K` badge; topbar missing the sprint pill and account-usage suffix. *Everything else depends on this.*
2. **Structure over skin.** Brain (graph-first vs detail-first Explorer), Orchestrator (card-list vs sortable inline-expand table), Gate (generic queue vs bespoke conflict view), and Ask (dock vs page+bubble+side-dock) need re-architecture, not CSS tweaks.
3. **Rich content cards are absent.** Reference leans on repeated rich primitives — feedback strips + quote cards (Task/Feedback), plan/diff/action cards (Chat), stacked source bars, sparklines, KPI sub-lines, animated live-log terminals. Build these as shared components once, reuse everywhere.
4. **Data shape gap.** Reference mock data is richer than our API. Plan seeds fixtures/adapters mirroring `SpadeData` so the UI can be built and tested now; wiring to real backend fields is explicitly out-of-scope per PR unless noted.
5. **Two genuine product/design decisions** are embedded (the Gate conflict screen, and how literally we mirror the Accounts orchestrator/strategy UI). These are flagged and should not block the rest.

---

## How to read this with the plan

The ordered, testable PR breakdown — each PR with an **automated Playwright e2e spec** (I run it) and a **manual e2e guide** (you run it) — is in [`PR-PLAN.md`](./PR-PLAN.md). It sequences: Playwright harness → shell foundation → restyle the 7 existing screens → build the 9 missing screens, respecting dependencies.
