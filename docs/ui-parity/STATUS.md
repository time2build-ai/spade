# UI Parity — Execution Status

Live status of executing [`PR-PLAN.md`](./PR-PLAN.md) under the **no-fabrication policy** (match the reference's layout/styling, render only real API data, omit invented demo content). See [`REPORT.md`](./REPORT.md) for the original diff.

## Delivered (13 PRs, all green — e2e 59 / vitest 142)

Each is its own branch + GitHub PR, **stacked** (#1 → #11). They must merge **in order** (#1 first) to retarget `development` cleanly.

| Plan PR | Screen | GitHub | Tests |
|---------|--------|--------|-------|
| PR-00/01/02 | Playwright harness · sidebar icons · topbar | #1 | 20 |
| PR-04 | Brain: color-fix + type glyphs | #2 | 8 |
| PR-05 | Brain: 3-column Explorer | #3 | 6 |
| PR-06 | Backlog: 4 columns + blocked banner | #4 | 5 |
| PR-07 | Task detail: head actions | #5 | 4 |
| PR-08 | Orchestrator: inline-expanding table | #6 | 3 |
| PR-09 | Active tasks route | #7 | 4 |
| PR-10 | Agent pool: provider glyphs + in-use state | #8 | 2 |
| PR-12 | ADR detail: re-dock to right aside | #9 | 2 |
| PR-13 | Ask: message avatars + anatomy | #10 | 2 |
| PR-14 | Ask: bottom-right trigger + dock relocation | #11 | 3 |

Every PR carries a Playwright spec (run by me) **and** a manual checklist (for you) — both in `PR-PLAN.md`.

## The honest-parity ceiling

The reference is a **demo mockup**: most screens render rich invented data (`SpadeData`). Our real API exposes only `projects · tasks · brain nodes/edges · pipelines/stages · sessions · accounts · brakes · comments`. So under no-fabrication the back-half PRs shipped honest **subsets** (structure matched, invented data omitted), and the remaining screens can't be built truthfully without backend work.

### Deferred — and exactly why

| Plan item | Status | Missing backend data |
|-----------|--------|----------------------|
| PR-03 shell modes | Folded into Home/Workspace | reference's ws/home nav groups are never visible; nothing to attach to until those routes exist |
| PR-11 Decisions filters | Blocked | decisions = `type=decision` brain nodes; no `status`/owner field for the All/Active/Proposed/Superseded tabs + status pills |
| PR-15 Ask thread list | Blocked | no threads API — chat is a single ephemeral conversation |
| PR-16 Ask plan/diff/cite cards | Blocked | the orchestrator returns prose, not structured plan/diff/citation payloads |
| PR-17 Overview | Blocked | per-project KPIs / mini-charts / now-executing are synthetic aggregates |
| PR-18 Home | Blocked | the cross-project triage feed + KPI band are synthesized (`buildTriageFeed`) |
| PR-19 Sprints | Blocked | **no Sprint type or endpoint** (no sprint/burn-down data) |
| PR-20 GraphIssues | Redundant | honest part (filtered node graph) is **already** Brain's Graph tab + legend toggles; the AI-ISS issues + source/date buckets are fabricated |
| PR-21 CLI | Blocked | no cli-runs API; real session output already shows in the orchestrator Terminal |
| PR-22 Feedback | Blocked | no feedback clusters/quotes/source-breakdown API (only `type=feedback` brain nodes) |
| PR-23 Settings | Partial-only | Project has real `autopilot`/`account_strategy`/`model_ceiling`, but no **update** endpoint (only `createProject`) — editable toggles can't persist |
| PR-24 Integrations | Blocked | **no integrations type or endpoint** |
| PR-25 Workspace | Blocked | depends on Settings + Integrations (both blocked) |
| PR-26 Meetings | Blocked | **no meetings type or endpoint** (transcripts/outcomes) |
| PR-27 Accounts (standalone) | Blocked | orchestrator-picker / dispatch-strategy / handoff-log have no backend; account list already lives in Agent pool |
| PR-28 Gate redesign | Blocked + needs product decision | the bespoke conflict/diff/signal-card screen is fabricated; also a model decision (single-conflict vs our multi-brake queue) |

## Recommended next steps

1. **Merge #1 → #11 in order** (all green) so the delivered parity lands and the stack collapses.
2. To go further, pick one:
   - **Backend fields** — add the missing data (decision status, sprints, feedback clusters, meetings, integrations, a project-settings update endpoint), then the deferred PRs become buildable honestly.
   - **Relax no-fabrication for specific screens** — allow a clearly-labeled demo-seed for chosen screens (e.g. Home/Overview) to reach pixel-parity now.
   - **Stop here** — the high-value, honestly-achievable parity is done.
