# Agent Pool + Accounts parity

Two distinct reference destinations live in this cluster:

- **Agent pool** (`AgentPoolView`, `modules/mod_25.js`) — operational fleet dashboard.
- **Accounts** (`AccountsView`, `modules/mod_23.js`) — the connect/orchestrate/strategy screen, reachable two ways: as a Settings tab (project level, `wsMode=false`) and as a workspace-level page (`wsMode=true`, nav key `accounts`).

Our app implements only one screen (`app/agent-pool/page.tsx`) and it is a thin, data-honest subset of the reference Agent Pool. There is **no standalone Accounts screen** at all.

---

## Reference: what it renders

### Agent pool (`mod_25.js`)
Full-height view, `fade-in`, two stacked sections inside `.ap-wrap`.

**Page head** — breadcrumb `Agent pool · {total} agents · {running} running · {idle} idle · {error} error · {N} live executions`. Right side: three buttons — `⚙ Dispatch rules` (ghost), `Pause pool` (plain), `▶ Spawn execution` (primary).

**Section 1 — Agent pool grid** (`.ap-grid`, auto-fill cards): one card per *account* (10 of them). Each card (`.ap-agent` + state class `running|error|idle`):
- Header: **provider glyph avatar** tinted by `providerMeta` color (claude `✦`#c9b8ff, codex `◇`#7ad19a, cursor `❮❯`#9bd1f0, gemini `✺`#f0c674, aider `⌘`#e6a8b8) at `color+18` bg / `color+55` border.
- Name = account email + inline **role pill** (`.ap-role`) — derived role (Orchestrator/Developer/Reviewer/Integrator/Documentor/Fallback) with its own glyph+color from `roleMeta`.
- Sub line: colored provider label · model (e.g. "Claude · Claude Sonnet 4.5").
- **State pill** (`.ap-state-pill`) right-aligned: Spanish labels — `En ejecución` (blue, pulsing dot), `Libre` (green), `En error` (red); colored bg/border/dot.
- Body varies by state: **running** → "Operando sobre" + synthetic issue id (AI-ISS-xxx) + pipeline title + `task · stage Role · eta`; **error** → "Error" + `● 5h window exhausted` + `cooling 2h 14m · auto-resume`; **idle** → "Libre" + `Esperando dispatch · {used}% used · {limit}`.
- **Foot**: usage meter bar (`.ap-meter`, fill colored by threshold: ≥90 red, ≥70 amber, else accent) + `{used}%` label, plus contextual action buttons (`⏸`/`＋`/`↻` by state + `⋯` configure).

**Section 2 — Executions in progress** (`.ap-exec`): section header + segmented filter (All/Dev/Review/Integrate/Doc). A CSS-grid table (`.ap-table`) with header cells Elapsed/Stage/Agent/Issue/Graph nodes affected/(actions). One row per running pipeline: blinking elapsed dot + mono time; stage role pill; mini provider avatar + agent name/model; issue id + title + `task · pipeline id · spend`; **clickable brain-node chips** colored by node type (feature/decision/convention/feedback/bug/metric) that `goto("graphIssues")`; row actions `↳ Reasignar`, `✕ Detener` (red). Empty-filter state message in Spanish.

### Accounts (`mod_23.js`)
Settings-tab and workspace variants of a rich management screen:
- Settings header (`Settings / Agents · N connected · M usable`) with `Import session token` + `▣ Connect agent` buttons; settings tab bar (Automations / **Agents** / Integrations) — both hidden in `wsMode`.
- **Scope switcher** (`.scope-switcher`): Workspace pool vs "Enabled in {project}" (hidden in wsMode).
- **Intro block**: large serif headline ("Spade is multi-agent. Pick a PM. Stack workers.") + paragraph + 3 summary stats (Agents connected / Providers / Live sessions).
- **Orchestrator picker** (`.orch-card`): eyebrow "★ Orchestrator role", "Currently led by {email}" + provider chip, and an animated **PM→workers graph** (`OrchLines` SVG measures avatar positions and draws curved fan paths) + "Switch orchestrator" pill list.
- **Strategy** selector: 4 radio cards (Smart routing / Round-robin / Least-used / Priority order).
- **Provider filter** tabs (All + per-provider with counts).
- **Account cards** (`.acct-card`): provider glyph avatar, email + role/orch badges, mono meta line (provider · model · plan · limit · today $), "Best at:" strength tags, usage meter (ok/warn/bad), status pill, and a `Make PM` button (global) or large toggle (project scope).
- **Recent handoffs** cross-provider log + an AI suggestion card (global), or a per-project tip card.

---

## Ours: what it renders

Files: `app/agent-pool/page.tsx`, `components/agentpool/AgentCard.tsx`, `components/agentpool/AccountCard.tsx`. Types: `lib/types.ts` (`Account`, `Session`), status mapping `lib/adapters.ts#sessionStatusVisual`.

**Page head** (`PageHead`): breadcrumb `Agent pool · {fleet} agents · {pool} accounts`. **No action buttons.**

**Section 1 — "Live agent fleet"** (`.ap-pool` / `.ap-grid`): one `AgentCard` per **live Session** (not per account). Card:
- `Avatar ai` glyph = session emoji, else role initial, else `?` (a generic purple AI avatar — **no provider glyph/color**).
- Name = session label/name; sub = `role · model` (mono).
- State pill from `sessionStatusVisual`: English labels (`dead/error/working/ready/booting/priming`), single dot, color only (no bg fill); pulses when live.
- Body = up to 4 mono key/value MetaRows (account / project / task / mission), each rendered only if present.
- **No usage meter, no provider sub-label, no foot actions, no "operando sobre"/issue context.**

**Section 2 — "Provider accounts"** (`.ap-accounts` / `.acct-list`): one `AccountCard` per Account:
- Small color **swatch** (`account.color` or accent) — *not* a provider glyph avatar.
- Label + optional `default` badge; mono config_dir path; mono provider string.
- Explicit code comment: "NO usage meter / % / spend (no data)."

**Standalone Accounts screen: NOT IMPLEMENTED.** No route, no orchestrator picker, no strategy selector, no scope switcher, no provider-filter tabs, no handoff log, no connect/import buttons, no PM graph.

CSS classes `.ap-exec`, `.ap-table`, `.ap-current`, `.ap-meter`, `.ap-role`, `.acct-card.orchestrator`, `.orch-*`, `.scope-*`, `.acct-strategy`, `.provider-filter` exist in reference `inner.html`; only the basic `.ap-*` / `.acct-card` styles are reused on our side (and our `.acct-list`/`.acct-swatch`/`.acct-dir` are bespoke, not in reference).

---

## Diff table

| Aspect | Reference | Ours | Severity |
|---|---|---|---|
| Standalone Accounts screen (orchestrator/strategy/handoffs/connect) | Full `AccountsView`, both Settings-tab and workspace variants | Missing entirely | **Blocker** |
| Agent-pool primary cards | One card per **account** (provider, role, state, usage, current issue) | One card per **live session**; no account-level pool view | **Blocker** |
| "Executions in progress" table | Full filterable table w/ stage, agent, issue, graph-node chips, actions | Missing | **Blocker** |
| Provider glyph + color avatar | Tinted provider glyph (✦◇❮❯✺⌘) per `providerMeta` | Generic purple AI avatar / plain color swatch | **Major** |
| Provider metadata (glyph/label/color map) | `providerMeta` in both views | Absent; only raw `account.provider` string shown | **Major** |
| Usage meter (% used, threshold colors, limit) | On every agent + account card | None ("no data" by design) | **Major** |
| Role derivation + role pill | Orchestrator/Developer/Reviewer/... with glyph+color | None | **Major** |
| State pill styling | Spanish labels, colored bg+border+dot | English labels, color-only, no bg | **Major** |
| Page-head action buttons | Dispatch rules / Pause pool / Spawn execution | None | **Major** |
| "Operando sobre" current-issue body | Issue id + title + stage + eta | Replaced by raw meta rows | **Major** |
| Account card content | email, model, plan, limit, today$, strengths, status pill | label, config_dir path, provider, default badge | **Major** |
| Brain-node chips → graphIssues nav | Clickable typed chips | None | **Major** |
| Section titles/copy | "Agent pool" / "Executions in progress" (mixed ES) | "Live agent fleet" / "Provider accounts" (EN) | Minor |
| Card model | account-centric | session-centric vs account-list split | Minor (follows from blockers) |
| Language | Spanish state/labels in reference | English | Minor |

---

## Concrete parity changes

1. **Add provider metadata** to the client (`lib/` map mirroring `providerMeta`: claude/codex/cursor/gemini/aider → label, glyph, color). Use it for avatars and sub-labels everywhere.
2. **Rework the Agent-pool top grid to be account-centric** like the reference: provider glyph avatar (tinted bg/border), email/name, role pill, colored state pill with bg+border, usage meter foot, and state-aware body (running/error/idle). Keep live-session data feeding the "running" body where available.
3. **Add the usage meter** (bar + `% used` + limit), threshold-colored (≥90 red / ≥70 amber / else accent) — requires `used`/`limit`/`plan`/`today` fields on `Account` (extend type + API, or stub gracefully).
4. **Build the "Executions in progress" table** (`.ap-exec`/`.ap-table`): filter segmented control, columns Elapsed/Stage/Agent/Issue/Graph nodes/actions, clickable brain-node chips that navigate to the brain/graph route, Reasignar/Detener actions. Feed from sessions+pipelines.
5. **Add page-head action buttons** (Dispatch rules / Pause pool / Spawn execution) even if non-functional, for visual parity.
6. **Create a standalone Accounts screen** (`app/accounts/` or a Settings → Agents tab): scope switcher, serif intro + 3 summary stats, orchestrator picker with the curved PM→workers SVG graph, 4-card strategy selector, provider-filter tabs, rich account cards (model/plan/limit/today/strengths/status), Make-PM/toggle, and the cross-provider handoff log + suggestion card.
7. **Align state-pill styling** (bg + border + dot, not color-only) and decide on language (reference mixes Spanish; if parity = identical, match the Spanish labels, otherwise document the deliberate divergence).
8. **Reuse reference CSS** (`.ap-agent`, `.ap-role`, `.ap-state-pill`, `.ap-meter`, `.ap-table`, `.orch-*`, `.scope-*`, `.acct-strategy`, `.provider-filter`) rather than the bespoke `.acct-list/.acct-swatch/.acct-dir` we invented.

---

## Suggested PR grouping

- **PR A — Provider metadata + agent-card parity**: provider map, account-centric top grid, provider glyph avatars, role pills, state-pill bg/border, usage meter, state-aware body, page-head buttons. (Items 1-3,5,7,8 for the pool view.)
- **PR B — Executions table**: `.ap-exec` filterable table with graph-node chips + actions, wired to sessions/pipelines. (Item 4.)
- **PR C — Standalone Accounts screen**: new route/tab with scope switcher, intro+stats, orchestrator PM graph, strategy selector, provider filter, rich account cards, handoff log. (Item 6.) Largest; can split into C1 (cards + filter + stats) and C2 (orchestrator graph + strategy + handoffs) if needed.

Data dependencies: PRs A/B/C all need extra `Account` fields (model, plan, limit, used, today, role, strengths, sessions) and pipeline/handoff data the current API does not expose — sequence a small data/API PR first or stub.
