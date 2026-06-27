# Agent pool + Accounts — full-parity plan

> Goal: **full visual + data parity** with `docs/Spade (standalone).html` for the two screens in this cluster —
> **Agent pool** (`AgentPoolView`, reference `modules/mod_25.js`) and the **standalone Accounts** screen
> (`AccountsView` + `OrchLines`, reference `modules/mod_23.js`).
>
> Policy for this plan: **wire REAL data where the API already provides it**, **SEED rich demo data
> (mirroring the reference `SpadeData`) where it does not**, and **flag genuine backend gaps as a
> planned follow-up PR + test**. Build the *full* rich UI either way — no "honest subset" trimming.

Reference modules (in scratchpad):
- `modules/mod_25.js` = `AgentPoolView` — account-centric pool grid + "Executions in progress" table.
- `modules/mod_23.js` = `AccountsView` + `OrchLines` — standalone Accounts screen (scope switcher, serif intro + stats, PM→workers SVG graph, dispatch-strategy selector, provider-filter tabs, rich account cards, handoff log, connect/import).
- `modules/mod_01.js` = `SpadeData` — the demo shapes (`accounts`, `pipelines`, `brainNodes`, `handoffs`, `projects`) we mirror for SEED.
- `inner.html` = the reference CSS (`.ap-*`, `.acct-*`, `.orch-*`, `.scope-*`, `.strat-card`, `.provider-filter`, `.prov-tab`, `.handoff-log`, `.status-pill`, `.strength-tag`, `.summary-stat`, `.toggle-pill`, `.seg`).

---

## Target

Two screens, pixel- and data-complete against the reference.

### Screen A — Agent pool (`/agent-pool`, rebuilt)

Full-height `fade-in` → `.ap-wrap` with two stacked sections.

**Page head** (`PageHead`): breadcrumb
`Agent pool · {total} agents · {running} running · {idle} idle · {error} error · {N} live executions`.
Right side three buttons: `⚙ Dispatch rules` (ghost), `Pause pool` (plain), `▶ Spawn execution` (primary).

**Section 1 — Agent pool grid** (`.ap-pool` → `.ap-grid`, `repeat(auto-fill, minmax(320px,1fr))`): one `.ap-agent` card **per account** (10 accounts in the reference), with state class `running|error|idle`:
- **Header** (`.ap-agent-h`): provider glyph avatar (`.ap-agent-avatar`, tinted `color+18` bg / `color+55` border / `color` fg via `providerMeta`); name = account email + inline **role pill** (`.ap-role` from `roleMeta` — glyph+color); sub line `.ap-agent-model` = colored provider label · model; right-aligned **state pill** (`.ap-state-pill`) with Spanish label (`En ejecución`/`Libre`/`En error`), bg+border+dot, pulsing dot when running.
- **Body** (`.ap-agent-body`) varies by state:
  - `running` → `.ap-current`: label `Operando sobre`, `AI-ISS-xxx` id + pipeline title, meta `task · stage {Role} · eta`.
  - `error` → `.ap-current.ap-error`: `● 5h window exhausted` + `cooling 2h 14m · auto‑resume`.
  - `idle` → `.ap-current.ap-idle`: `Esperando dispatch · {used}% used · {limit}`.
- **Foot** (`.ap-agent-foot`): usage meter (`.ap-meter` bar, fill `≥90 red / ≥70 amber / else accent` + `{used}%`) and state-aware action buttons (`⏸`/`＋`/`↻` + `⋯`).

**Section 2 — Executions in progress** (`.ap-exec`): section header + segmented filter (`.seg`: All(N)/Dev/Review/Integrate/Doc) + `.ap-table` CSS-grid (6 columns: Elapsed / Stage / Agent / Issue / Graph nodes affected / actions). One row per running pipeline:
- Elapsed: blinking `.ap-elapsed-dot` + mono time.
- Stage: `.ap-role` pill for the running stage's role.
- Agent: `.ap-agent-mini-avatar` (provider glyph) + name/model.
- Issue: `AI-ISS-xxx` + title + `task · pipeline {id} · {spend}`.
- Graph nodes: clickable `.ap-node-chip`s colored by node type (`typeMeta`: feature/decision/convention/feedback/bug/metric) → navigate to brain/graph route.
- Actions: `↳ Reasignar`, `✕ Detener` (red). Empty filter → `.ap-empty` Spanish message.

### Screen B — Accounts (new route `/accounts`, workspace variant)

We implement the **workspace variant** (`wsMode=true`): no Settings header/tabs, no scope switcher (the standalone Accounts screen forces global scope). The project-scoped Settings-tab variant (scope switcher + per-project toggles + tip card) is a **stretch** (PR-F).

`.acct-wrap` (scroll container) containing, in order:
1. **Intro block** (`.settings-intro`): serif headline "Spade is multi‑agent. Pick a PM. Stack workers." + paragraph + `.settings-summary` 3 stats (Agents connected / Providers / Live sessions).
2. **Orchestrator picker** (`.orch-card`): eyebrow `★ Orchestrator role`, "Currently led by {email}" + `.prov-chip`, sub copy, the **`.orch-graph`** (PM avatar row + `OrchLines` SVG + workers row) and `.orch-pick` "Switch orchestrator" pill list.
3. **Strategy** (`.sb-label` "Worker dispatch strategy" + `.acct-strategy` grid of 4 `.strat-card` radios: Smart routing / Round‑robin / Least‑used / Priority order).
4. **Provider filter** (`.provider-filter` → `.prov-tab` All + per-provider with counts).
5. **Account cards** (`.acct-card`, with `.orchestrator`/`.active`/`.exhausted` modifiers): provider glyph avatar, email + orch badge, mono meta (`provider · model · plan · limit · today $`), "Best at:" `.strength-tag`s, `.acct-meter` (used% + sessions/cooling/fallback note + `.meter-bar` ok/warn/bad), `.status-pill`, and a `Make PM` button.
6. **Recent handoffs** (`.sb-label` + `.handoff-log` cross-provider log) + an AI suggestion `.card`.

---

## Current state

### Agent pool (`apps/client/app/agent-pool/page.tsx`)
A thin, data-honest subset:
- `PageHead` breadcrumb `Agent pool · {fleet} agents · {pool} accounts`. **No action buttons.**
- Section "Live agent fleet": one `AgentCard` per **live Session** (not per account) — generic purple AI `Avatar`, English status pill (`sessionStatusVisual`), up to 4 mono `MetaRow`s. **No provider glyph, no usage meter, no role pill, no current-issue body, no foot actions.**
- Section "Provider accounts": one `AccountCard` per Account — provider glyph avatar (`PROVIDER_META` already exists ✔), label + default badge, mono config_dir, in-use state from real sessions. Explicit "no usage meter (no data)".
- **No "Executions in progress" table.**
- **No standalone Accounts screen** — no route, no orchestrator picker, strategy, scope switcher, provider filter, or handoff log.

### Components
- `components/agentpool/AccountCard.tsx` — already has `PROVIDER_META` (claude `✦` codex `◇` cursor `❮❯` gemini `✺` aider `⌘`, colors match reference) and provider glyph avatar. Reuse + extend.
- `components/agentpool/AgentCard.tsx` — session-centric, keep as a fallback or repurpose; the new pool grid is account-centric.

### CSS (`apps/client/app/globals.css`)
Already present (lines ~836–893): `.ap-agent`, `.ap-agent-h`, `.ap-agent-avatar`, `.ap-agent-id/name/model`, `.ap-state-pill`, `.ap-state-dot`, `.ap-agent-body`, `.acct-card`, `.acct-glyph`, plus bespoke `.acct-list/.acct-dir`.
**Missing** (must port verbatim from `inner.html`): `.ap-role`, the `.ap-agent.running/.error` modifiers, `.ap-current*`, `.ap-idle-msg`, `.ap-agent-foot`, `.ap-meter*`, `.ap-actions`, `.ap-exec`, `.ap-table`, `.ap-th/.ap-td`, `.ap-c-*`, `.ap-elapsed-dot`, `.ap-agent-mini*`, `.ap-issue-*`, `.ap-node-chip*`, `.ap-empty`, `@keyframes ap-pulse`, `.seg`, plus the whole Accounts block: `.acct-wrap`, `.acct-strategy`, `.strat-card`, `.acct-avatar`, `.acct-meter`, `.meter-bar`, `.handoff-log`, `.scope-switcher/.scope-btn`, `.settings-intro/.settings-summary/.summary-stat`, `.orch-card`, `.orch-eyebrow/.orch-title/.orch-sub`, `.prov-chip`, `.orch-graph/.orch-pm*/.orch-lines/.orch-workers/.orch-worker/.orch-w-avatar`, `.orch-pick*`, `.provider-filter/.prov-tab`, `.orch-badge`, `.strength-tag`, `.status-pill`, `.toggle-pill.large`, `.proj-enabled-badge`.

### Backend (Python, `apps/api/tui_pilot/accounts.py`, `/accounts` endpoint)
`accounts` table columns: **id, label, config_dir, color, provider, is_default, created_at**. Plus `auth_status(config_dir)` → `logged_in | not_logged_in`. **No** role, model, plan, limit, used%, today$, strengths, sessions-count, handoffs, or dispatch-strategy persistence. (Note: real `provider` default is `"claude-code"`, not `"claude"` — `PROVIDER_META` lookup must normalize.)

---

## Build steps

Order matters: data layer → CSS → pool grid → executions table → Accounts screen (cards/filter/stats → orchestrator graph/strategy/handoffs).

### Step 0 — Data layer (`lib/`): REAL + SEED merge

Create **`lib/agentDemo.ts`** holding the SEED constants mirrored from `SpadeData` (mod_01) and the metadata maps, plus a single merge function that decorates the **real** account list with SEED fields keyed by provider/index.

1. **Metadata maps** (port from mod_25/mod_23 exactly):
   ```ts
   export const PROVIDER_META = { // already in AccountCard.tsx — move here & share
     claude: { label:"Claude", glyph:"✦", color:"#c9b8ff" },
     codex:  { label:"Codex",  glyph:"◇", color:"#7ad19a" },
     cursor: { label:"Cursor", glyph:"❮❯", color:"#9bd1f0" },
     gemini: { label:"Gemini", glyph:"✺", color:"#f0c674" },
     aider:  { label:"Aider",  glyph:"⌘", color:"#e6a8b8" },
   };
   export const ROLE_META = {
     Orchestrator:{color:"#c9b8ff",glyph:"★"}, Developer:{color:"#7ab6e6",glyph:"{ }"},
     Reviewer:{color:"#e69bb6",glyph:"✓"}, Integrator:{color:"#7adcc7",glyph:"⤳"},
     Documentor:{color:"#c9b8ff",glyph:"¶"}, Fallback:{color:"#8e8e98",glyph:"·"},
   };
   export const TYPE_META = { feature:{color:"#c9b8ff",glyph:"F"}, decision:{color:"#e6b86a",glyph:"D"},
     convention:{color:"#e69bb6",glyph:"C"}, feedback:{color:"#7adcc7",glyph:"U"},
     bug:{color:"#e87d7d",glyph:"B"}, metric:{color:"#7ab6e6",glyph:"M"} };
   ```
   Normalize provider: `provider.toLowerCase().replace("claude-code","claude")` before lookup; unknown → neutral `{glyph:"•",color:"var(--text-3)"}`.
2. **SEED account demo** (`ACCOUNT_DEMO`): array of 10 entries copied verbatim from `SpadeData.accounts` (id, provider, model, email, plan, limit, used, state, sessions, today, role, strengths). Used directly when the real `/accounts` pool is empty/short, and as the field source for the merge.
3. **`decorateAccounts(real: Account[]): DecoratedAccount[]`**: each real account keeps its **real** `id/label/color/provider`, and is enriched with SEED `model/plan/limit/used/state/sessions/today/role/strengths`. Match strategy: by provider+ordinal (Nth claude account ← Nth SEED claude entry), falling back to round-robin over SEED. If `real.length === 0` → return the full SEED set (so the screen is never empty in dev). Document each field's provenance inline (`// SEED` / `// REAL`).
4. **`roleForAccount(a)`** and **`stateOfAccount(a)`** — port the derivation functions verbatim from mod_25 (lines 31–47). `stateMeta` (Spanish labels + bg/bd/dot/pulse) ported from mod_25 lines 48–52.
5. **Executions builder** (`buildExecutions(pipelines, accounts, nodesById)`): port mod_25 lines 54–114 — `acctEmailKey`, `pipelineByAcct`, `issueContext` (the SPD→AI-ISS + contextNodes map, lines 71–81), `elapsedFor`, `roleOfRunningStage`. Source pipelines/nodes: see Data sourcing.
6. **SEED handoffs** (`HANDOFFS`) copied from `SpadeData.handoffs` (mod_01 lines 179–185).

> The real `Account` type (`lib/types.ts`) stays as-is; add a `DecoratedAccount` type in `lib/agentDemo.ts` extending it with the SEED fields (all typed, never optional after decoration).

### Step 1 — CSS port (`globals.css`)

Append, verbatim from `inner.html`, the missing selectors listed in *Current state → CSS*. Group them under two banner comments: `/* === AGENT POOL (reference parity) === */` (inner.html ~1213–1410, the `.ap-*` block + `.seg` ~1643–1646) and `/* === ACCOUNTS (reference parity) === */` (inner.html ~3622–3745 + ~3923–4045 + `.status-pill` ~1909–1912 + `.strength-tag`). Keep existing `.ap-agent*`/`.acct-card`/`.acct-glyph` (they already match) and the bespoke `.acct-list/.acct-dir` (still used by the old session card if retained). Verify CSS vars exist (`--blue`, `--green`, `--red`, `--amber`, `--accent`, `--mono`, `--bg-1..4`, `--line`, `--line-strong`, `--text..text-4`) — they do (used elsewhere).

### Step 2 — Agent pool grid (account-centric)

Rewrite `app/agent-pool/page.tsx` + new `components/agentpool/PoolAgentCard.tsx`:
- Fetch real `sessions` (poll 3s) and `accounts`; decorate via `decorateAccounts`. Keep the real session→account in-use signal to drive the "running" body where a live session maps to the account (prefer real running session over SEED for that card's body when available).
- `PoolAgentCard` renders header/body/foot exactly as mod_25 lines 160–229 (provider avatar, role pill, state pill, state-aware `.ap-current`, meter foot, action buttons).
- Page head gets the 3 buttons (non-functional but present; `Spawn execution` may later open a real spawn dialog — see backend gaps).
- Pool counts (`total/running/idle/error`) from decorated accounts (mod_25 lines 117–122).

### Step 3 — Executions in progress table

New `components/agentpool/ExecutionsTable.tsx`:
- `useState` filter (`all`/Developer/Reviewer/Integrator/Documentor); `.seg` segmented control with `All ({n})`.
- `.ap-table` grid; map `buildExecutions(...)` rows to the 6-column layout (mod_25 lines 252–323). Provider mini-avatar, stage role pill, issue cell, `.ap-node-chip`s.
- **Node chips navigate** to our brain/graph route. The reference does `goto("graphIssues")`; our nav has Brain at `/brain` (Graph & Issues is `href:"#"`, not built). Use `next/link` / `useRouter().push("/brain")` with the node id as a query param (`/brain?node={id}`) so the click is real even though the dedicated graphIssues screen is a stub.
- `↳ Reasignar` / `✕ Detener` buttons render (wired to a no-op + toast for now; real control = backend gap).

### Step 4 — Accounts route shell + cards + filter + stats (PR-D)

- New route `app/accounts/page.tsx` (`"use client"`), add sidebar nav item `{ label:"Accounts", icon:"spark", href:"/accounts" }` (currently the only agents/accounts entry is Agent pool; add Accounts under the "Agents" group). Remove its `#` placeholder treatment so it navigates.
- Port `AccountsView` (mod_23) in `wsMode=true` form (skip the `!wsMode` Settings header/tabs and scope switcher for the base PR).
- `components/accounts/AccountsIntro.tsx` — serif headline + paragraph + `.settings-summary` 3 stats (Agents connected = accounts.length; Providers = distinct providers with count>0; Live sessions = sum of decorated `sessions`, or real alive-session count if we prefer REAL here).
- `components/accounts/ProviderFilter.tsx` — `.provider-filter` tabs with per-provider counts (mod_23 lines 256–274).
- `components/accounts/AccountRow.tsx` — the rich `.acct-card` (mod_23 lines 277–327): avatar, email + orch badge, mono meta line, strength tags, `.acct-meter`, `.status-pill`, `Make PM` button. `orchestrator` state in `useState` (default = decorated account with `role==="orchestrator"`).

### Step 5 — Orchestrator graph + strategy + handoffs (PR-E)

- `components/accounts/OrchLines.tsx` — port the SVG measuring component **verbatim** (mod_23 lines 1–57): `useRef` + `useLayoutEffect` measures `.orch-pm-avatar` and `.orch-w-avatar` bounding rects relative to the SVG, builds cubic-bezier fan paths (`M x1 0 C x1 .55h, x2 .45h, x2 h`), re-measures on `ResizeObserver` + window resize. Keep `count` dep. This is the only non-trivial logic; preserve it exactly (React 19 / Next: it's a client component, `useLayoutEffect` is fine).
- `components/accounts/OrchestratorPicker.tsx` — `.orch-card` with eyebrow/title/`.prov-chip`/sub, the `.orch-graph` (PM row + `<OrchLines count={min(workers,6)} />` + `.orch-workers` slice(0,6)), and `.orch-pick` pill list (mod_23 lines 178–232). `setOrchestrator` updates which account is PM (drives the graph + Make-PM buttons).
- `components/accounts/StrategySelector.tsx` — `.acct-strategy` 4 `.strat-card` radios (mod_23 lines 234–254); `useState` strategy (SEED default `"smart"`; persistence = backend gap — see below).
- `components/accounts/HandoffLog.tsx` — `.handoff-log` rendering SEED `HANDOFFS` (mod_23 lines 331–346) + the AI suggestion `.card` (lines 348–355).

### Step 6 — Backend-gap follow-up PR + test (PR-G)

See *Backend needs*. Add a real `GET /accounts/usage` (or extend `/accounts`) returning role/model/plan/limit/used/today/sessions/strengths/state per account, plus `GET /handoffs` and `PUT /accounts/strategy`. Swap the SEED sources in `lib/agentDemo.ts` for the real fetch behind a feature flag, keeping SEED as the fallback. Ship with a Python test (`apps/api/tests/test_accounts.py` extension) and update the Playwright specs to assert real values.

---

## Data sourcing (REAL | SEED | BACKEND-FEATURE)

| Datum | Source | Notes |
|---|---|---|
| Account `id`, `label`, `color`, `provider` | **REAL** | from `/accounts`. Normalize provider (`claude-code`→`claude`) for `PROVIDER_META`. |
| Account `email` shown on cards | **SEED** | real model has only `label`/`config_dir`; use SEED email, or fall back to `label`. |
| Account in `running` body (current issue) | **REAL where available** | if a live `session.account_id` maps to this account, use that session; else SEED `issueForAccount`. |
| Account-pool in-use dot | **REAL** | `session.alive && session.account_id` (already implemented). |
| Account `role` (orch/dev/reviewer/…) | **SEED** | derived via `roleForAccount` from SEED `role`/`strengths`. → BACKEND-FEATURE. |
| Account `model`/`plan`/`limit`/`used`/`today`/`sessions`/`strengths`/`state` | **SEED** | mirror `SpadeData.accounts`. → BACKEND-FEATURE. |
| Usage meter % + threshold color | **SEED** | from SEED `used`. → BACKEND-FEATURE (real token-window usage). |
| Pool counts (total/running/idle/error) | **SEED-derived** | from `stateOfAccount` over decorated accounts; `total` is REAL count. |
| Executions rows (elapsed/issueId/contextNodes/spend) | **SEED** | `issueContext` + `elapsedFor`; pipeline shape REAL if `/pipelines` has data for the current project, else SEED `SpadeData.pipelines`. |
| Pipelines feeding executions | **REAL if present** | `/pipelines?project_id=` exists; reference is global. For parity, prefer REAL current-project pipelines, top up with SEED to reach the rich multi-row look. Document the blend. |
| Brain nodes for chips | **REAL if present** | `/brain/nodes?project_id=`; ids must match `issueContext` (which uses SEED ids `f-checkout` etc). Use SEED `brainNodes` map to resolve labels/types so chips always render. |
| Node-chip navigation target | **REAL** | `router.push("/brain?node=…")` (graphIssues screen is a stub → route to Brain). |
| Orchestrator identity / "led by" | **SEED** | account with SEED `role==="orchestrator"`. → BACKEND-FEATURE. |
| Orchestrator PM↔worker graph geometry | **REAL (computed)** | `OrchLines` measures live DOM; not data, pure layout. |
| Dispatch strategy selection | **SEED state** | `useState`, not persisted. → BACKEND-FEATURE (`account_strategy` exists on `Project` but not a workspace-level setting). |
| Provider filter counts | **REAL-derived** | counts over the REAL provider field. |
| Summary stats (agents/providers/live sessions) | **REAL where possible** | agents=REAL count; providers=REAL distinct; live sessions=REAL alive sessions (preferred) or SEED sum. |
| Handoff log | **SEED** | mirror `SpadeData.handoffs`. → BACKEND-FEATURE (`GET /handoffs`). |
| AI suggestion / tip cards | **SEED** | static copy from reference. |
| Action buttons (Dispatch rules / Pause pool / Spawn / Reasignar / Detener / Make PM / Apply / Dismiss) | **SEED/no-op** | present for parity; real control = BACKEND-FEATURE (except `Spawn execution` which could call existing `spawnOrchestrator`). |

**Provenance rule:** every SEED field carries an inline `// SEED (backend-feature: …)` comment, and the SEED constants live in one file (`lib/agentDemo.ts`) so the follow-up PR has a single swap point.

---

## Validation

### Playwright (`apps/client/e2e/`)

Extend `agent-pool.spec.ts` and add `accounts.spec.ts`. All specs mock `/api/accounts`, `/api/sessions`, `/api/pipelines`, `/api/brain/nodes` (the existing specs already show the mock pattern).

**`agent-pool.spec.ts`** (rewrite for the rich UI):
- Page head shows all 3 action buttons (`Dispatch rules`, `Pause pool`, `Spawn execution`) and the count breadcrumb (`running`/`idle`/`error`/`live executions`).
- `.ap-grid` renders one `.ap-agent` **per account**; a claude account shows avatar `✦`, a `.ap-role` pill, and a `.ap-state-pill` with a Spanish label.
- A `running` card shows `.ap-current` "Operando sobre" + an `AI-ISS-` id; an `error` card shows "5h window exhausted"; an `idle` card shows "Esperando dispatch".
- `.ap-meter-fill` width reflects `used%`; ≥90 uses the red color, ≥70 amber.
- Executions: `.ap-table` renders rows; the `.seg` filter to "Dev" narrows rows; a `.ap-node-chip` click navigates to `/brain?node=…`; empty filter shows `.ap-empty`.
- Keep the existing in-use/idle assertions (REAL session signal) — they must still pass.

**`accounts.spec.ts`** (new):
- `/accounts` renders the serif intro + 3 `.summary-stat`s with non-zero numbers.
- `.orch-card` shows "Currently led by …", the `.orch-graph` renders a `.orch-pm-avatar` and ≥1 `.orch-w-avatar`, and `OrchLines` draws ≥1 `<path>` (assert `svg.orch-lines path` count ≥ 1 after layout).
- Clicking an `.orch-pick-pill` (or a `Make PM` button) moves the `orchestrator` badge to that account.
- `.acct-strategy` has 4 `.strat-card`s; clicking one sets `.on`.
- `.provider-filter` All shows total; clicking a provider tab filters `.acct-card`s by `data-provider`.
- An `.acct-card` shows the mono meta line (`model · plan · limit · today`), ≥1 `.strength-tag`, a `.meter-bar .f` with a width, and a `.status-pill`.
- `.handoff-log` renders ≥1 cross-provider row with a `→` arrow.

**Component test** (`components/__tests__/`): unit-test `decorateAccounts` (empty real → full SEED; real subset → keeps real id/label/provider, gains SEED fields) and `roleForAccount`/`stateOfAccount` mappings.

### Manual checklist
- Run `pnpm --filter client dev`; visit `/agent-pool` and `/accounts` with the API running.
- Confirm the `OrchLines` SVG fan re-draws correctly on window resize and when switching orchestrator (paths re-measure).
- Confirm node-chip click lands on `/brain`.
- Confirm provider glyph colors/tints match the reference screenshot side-by-side (compare against `docs/Spade (standalone).html`).
- Confirm no console errors from `useLayoutEffect` SSR (component is `"use client"`; guard `ref.current`).

---

## PR breakdown

| PR | Scope | Depends on | Notes |
|---|---|---|---|
| **PR-A — Data + CSS foundation** | `lib/agentDemo.ts` (metadata maps, `ACCOUNT_DEMO`, `decorateAccounts`, `roleForAccount`, `stateOfAccount`, `buildExecutions`, `HANDOFFS`, types) + verbatim CSS port into `globals.css`. Unit tests for the data layer. | — | No UI change yet; pure foundation. Move `PROVIDER_META` out of `AccountCard.tsx` into the shared module. |
| **PR-B — Agent pool grid** | Rewrite `app/agent-pool/page.tsx` account-centric; new `PoolAgentCard.tsx`; page-head buttons; pool counts. Rewrite `agent-pool.spec.ts` (keep REAL in-use assertions). | A | Biggest visual change to an existing screen. |
| **PR-C — Executions table** | `ExecutionsTable.tsx`; `.seg` filter; node-chip → `/brain` nav; Reasignar/Detener. Spec coverage. | A, B | |
| **PR-D — Accounts screen base** | New `/accounts` route + sidebar entry; `AccountsView` shell (wsMode); `AccountsIntro`, `ProviderFilter`, `AccountRow` (cards + Make PM). `accounts.spec.ts` (cards/filter/stats). | A | |
| **PR-E — Orchestrator graph + strategy + handoffs** | `OrchLines.tsx` (verbatim SVG), `OrchestratorPicker.tsx`, `StrategySelector.tsx`, `HandoffLog.tsx` + suggestion card. Spec coverage for graph/strategy/handoffs. | D | The `OrchLines` measuring logic is the trickiest piece. |
| **PR-F (stretch) — Settings-tab variant** | `!wsMode` path: Settings header/tabs, `.scope-switcher`, per-project enable toggles (`.toggle-pill.large`), project tip card. Mount under a future Settings → Agents tab. | D, E | Pure parity extra; lower priority. |
| **PR-G (backend follow-up) — Real account usage/role/strategy/handoffs** | Extend `/accounts` (or new `/accounts/usage`) with role/model/plan/limit/used/today/sessions/strengths/state; add `GET /handoffs`; add workspace dispatch-strategy persistence + endpoint. Flip `lib/agentDemo.ts` to fetch-with-SEED-fallback behind a flag. Python tests + updated Playwright assertions on real values. | A–E | The genuine backend gap; everything else is SEED until this lands. |

---

## Summary

1. **7 PRs** total: A (data+CSS), B (pool grid), C (executions table), D (accounts base), E (orchestrator graph/strategy/handoffs), F (stretch: settings-tab variant), G (backend follow-up).
2. **Biggest gaps**: the **standalone Accounts screen does not exist** (no route, orchestrator picker, strategy, handoffs), and the Agent pool is **session-centric** vs the reference's **account-centric** cards + missing **Executions table**.
3. **Trickiest code**: the `OrchLines` SVG that measures live DOM avatar positions to draw the PM→worker fan (port verbatim, client component, re-measure on resize/orchestrator-switch).
4. **CSS** is the cheap win — most `.ap-*` and all `.acct-*/.orch-*/.strat-*/.provider-filter/.handoff-log/.status-pill` styles port verbatim from `inner.html`; the base `.ap-agent`/`.acct-card`/`.acct-glyph` already match.
5. **REAL today**: account id/label/color/provider, in-use dot, alive-session counts, provider-filter counts, node-chip nav, pipelines/brain-nodes when the project has them.
6. **SEED today**: role, model, plan, limit, used%, today$, sessions, strengths, executions issue-context, orchestrator identity, handoffs, dispatch strategy.
7. **Backend needs (PR-G)**: per-account **usage/role/model/plan/limit/today/sessions/strengths/state** (extend `/accounts` or add `/accounts/usage`); **`GET /handoffs`**; **workspace dispatch-strategy** persistence + endpoint.
8. Provider must be **normalized** (`claude-code`→`claude`) for the metadata map — real default differs from the reference's `claude`.
9. All SEED lives in **one file** (`lib/agentDemo.ts`) with inline provenance comments so PR-G is a single swap point.
10. Validation = rewritten `agent-pool.spec.ts` + new `accounts.spec.ts` (incl. an `OrchLines` `<path>`-count assertion) + a `decorateAccounts` unit test; existing REAL in-use assertions must keep passing.
