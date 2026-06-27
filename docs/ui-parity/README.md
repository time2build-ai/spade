# UI Parity workspace

Comparing our client (`apps/client`) against the reference mockup `docs/Spade (standalone).html`. Goal: visual parity.

- **[REPORT.md](./REPORT.md)** — executive synthesis + the screen-by-screen parity matrix.
- **[PR-PLAN.md](./PR-PLAN.md)** — ordered PRs (29 total: PR-00…PR-28), each with an automated Playwright e2e spec + a manual e2e checklist.
- **[sections/](./sections)** — the detailed per-cluster diffs the report is built from (01 shell · 02 home/overview · 03 brain/graph-issues · 04 backlog/task/sprints · 05 orchestrator · 06 agent-pool/accounts · 07 decisions/gate · 08 ask/chat · 09 missing-screens build-specs).

Reference source was recovered by decompressing the bundled artifact (gzip+base64 → React modules); the design tokens already match exactly, so the work is structure + 9 unbuilt screens, not colors.
