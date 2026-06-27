# Ask/Chat — full-parity plan

> Goal: FULL visual + data parity with `docs/Spade (standalone).html` for the
> Ask/chat experience — the dark bottom-right bubble, the ⌘K right-edge side dock,
> the full `/ask` page (thread/session list + context rail), rich messages
> (avatars, citation pills, Plan cards, Action/Diff cards), and @mention
> autocomplete. Keep the **real orchestrator round-trip** for sending; **SEED** the
> thread list + plan/diff/cite payloads (mirroring `SpadeData.chatThreads`) so the
> rich chat renders; flag a real **threads/sessions + structured tool-output**
> backend as a planned follow-up PR.

Reference modules (scratchpad base
`/private/tmp/claude-501/-Users-thiagolopez-time2build-projects-tui-pilot/f6ae3b30-26c1-4084-800d-5f384d54843d/scratchpad`):
- `modules/mod_10.js` — `ChatPanel` + `Message`/`renderText`/`CitePill`/`PlanCard`/`ActionCard`/`generateMockMessages`.
- `modules/mod_12.js` — `ChatBubble` (trigger pill + 440×620 bubble + ⌘K 480px side dock w/ overlay) + `BubbleHeader`.
- `modules/mod_02.js` — `AskView` (full `/ask` page: thread sidebar + `ChatPanel mode="page"` + context rail) + `ThreadRow`.
- `modules/mod_01.js:280–323` — `SpadeData.chatThreads` (the demo shape to mirror).
- `inner.html:2605–3050` — all `.ask-*` and `.ch-*` CSS.

---

## Target

The reference ships **three** surfaces, all sharing ONE `ChatPanel(mode)`:

### A. Bottom-right bubble + ⌘K side dock — `ChatBubble` (`mod_12.js`, CSS `inner.html:2962–3050`)
- **Trigger pill** `.ch-bubble`: `position:fixed; bottom:18px; right:22px`, pill,
  **solid-accent** bg + dark text, **spark icon + "Ask" + `⌘K` kbd chip**, accent
  glow shadow, hover lift. Shown only when nothing is open.
- **Bubble panel** `.ch-bubble-panel`: fixed bottom-right, **440×620** (max
  `100vh-36px`), opaque `--bg-1`, 12px radius, `ch-bub-in` slide-up-fade. Contains
  `BubbleHeader` + `<ChatPanel mode="bubble">`.
- **Side dock** `.ch-dock`: opened by **⌘K/Ctrl+K**. Right-edge panel
  `top:0 right:0 bottom:0`, **width 480px** (max 92vw), dimmed `.ch-dock-overlay`
  (`rgba(0,0,0,.32)`), `ch-dock-in` slide-from-right. `BubbleHeader` +
  `<ChatPanel mode="dock">`. Esc closes; ⌘K toggles.
- **`BubbleHeader`** `.ch-bub-head`: thread-picker button (spark + active title +
  chev) that drops `.ch-bub-thread-list` (all threads, click to switch); action
  icon-btns: New thread (`i-plus`), Open as page (`i-arrow` → `goto('ask')`), Dock
  (`i-link`) / Float (`i-link`), Close (`i-x`).
- Hidden at the workspace level (`atWorkspace → null`).

### B. Shared `ChatPanel(mode)` — `mod_10.js`, CSS `inner.html:2687–2960`
`mode ∈ "page" | "dock" | "bubble"`. In bubble/dock the `.ch-head` is hidden
(`.ch-mode-bubble .ch-head{display:none}`), header lives in `BubbleHeader` instead.
- **Header** `.ch-head` (page only): optional pin flag (`i-flag`, accent), title
  `.ch-title` + mono subtitle `{n} msgs · updated {updated}`; right: "open as page"
  arrow icon-btn (dock/bubble), close `×` when `onClose`.
- **Stream** `.ch-stream`: `Message` rows.
  - **Avatar** `.ch-msg-avatar` (~26px): user = initials "RM" on accent disc
    (`order:2`, row right-aligned); assistant = spark icon disc, left-aligned.
  - **Header line**: `.ch-msg-who` (`Robert` / `Spade · Claude`) + mono `.ch-msg-t`.
  - **Text** `.ch-msg-text`: paragraphs split on `\n`; inline `@mentions` →
    `.ch-mention-inline` mono accent links (`resolveMention` routes to record).
  - **Citation pills** `.ch-cites`/`.ch-cite` (assistant only): kind-colored chip
    (ADR=amber, Task=blue, Meeting=accent, Feedback=green) = kind + mono id, click
    → navigate.
  - **Plan card** `.ch-plan`: orch icon + "Proposed plan" + mono `{n} steps · {risk}`;
    numbered `<ol>` (zero-padded mono index, title + muted detail); footer Modify
    (ghost) + Run plan (primary).
  - **Action/Diff card** `.ch-action` (risk-tinted border): kind chip + clickable
    target + `risk:` label; summary; for `adr-edit` a `.ch-diff` block (red
    strike-through `.del` + green `.add` lines); footer Reject / Modify / Send to
    gates / Apply.
- **Composer** `.ch-composer-wrap`: auto-grow textarea (max 160px), placeholder
  **"Ask about this project, or @mention an ADR/task/cluster"**; **@-mention popup**
  `.ch-mention-pop` over the project pool (ADR/Task/Feedback/Meeting); footer hint
  **"@ to mention · Enter to send · ⇧Enter newline"** + **"Send"** primary btn w/
  arrow (disabled when empty).
- **Empty state** `.ch-empty`: spark + "No thread selected".

### C. Full `/ask` page — `AskView` (`mod_02.js`, CSS `inner.html:2605–2685`)
Three-column `.ask-body` grid `260px 1fr 280px`:
- **Page header** `.page-head`: breadcrumb **"Ask · conversations with this
  project"**; right: Settings (ghost, cog) + New thread (primary, plus).
- **Left — thread list** `.ask-threads`: `.ask-search` ("Search threads"); grouped
  `PINNED` then `RECENT` `.ask-thread-grp`s of `ThreadRow` (`.ask-thread` = title +
  mono `{msgCount} msgs · {updated}`; `.active` = accent left-border + bg-2);
  footer `.ask-thread-foot` full-width ghost "New thread".
- **Center — active thread** `.ask-main`: `<ChatPanel mode="page">`.
- **Right — context rail** `.ask-context`: three mono-headed cards —
  **PROJECT CONTEXT** (SPRINT/BACKLOG/DECISIONS/BRAIN/MEETINGS/FEEDBACK rows),
  **RECENT ACTIONS** (kind chip + title + mono meta), **MODEL**
  (AGENT/ACCOUNT/SPENT rows).

---

## Current state

`apps/client/components/ask/AskDock.tsx` — **one** surface: a single top-center
glass float (`.ask-float`, 540px, draggable, collapse/expand, persisted to
`localStorage`) mounted globally in `app/layout.tsx:48`. Trigger is a glass pill
(NOT solid-accent, NOT bottom-right) reading **"Ask the brain ⌘K"**. ⌘K toggles
the float (not a dock). Messages = `MessageBubble` (`.ask-msg`: role label "You"/
"Brain" + avatar + text; brain replies via `Markdown.tsx`). `ThinkingIndicator.tsx`
shows cycling phrases. Real orchestrator round-trip in `send()`
(`resolveOrchestrator` → `api.spawnOrchestrator`/`api.session` poll →
`api.setCurrentProject` → `api.promptSession`). No-account gate via `api.accounts()`.
Hook: `lib/useAskDock.ts`.

**Missing entirely:** `/ask` route; thread list / sessions / search / pin-recent
groups / picker / switcher; shared `ChatPanel`; bottom-right bubble (440×620); ⌘K
right-edge dock + overlay; `BubbleHeader`; rich message anatomy (right-aligned user
bubble, who+timestamp); citation pills; Plan cards; Action/Diff cards; @mentions
(inline + autocomplete); context rail; "open as page"/"dock"/"new thread" affordances.

**What's already real (reuse, don't rebuild):** orchestrator send round-trip;
`api.tasks(projectId)` (real Tasks for the mention/cite pool + BACKLOG count);
`api.brainNodes`/`api.brainEdges` (real; decisions are **derived from brainNodes** —
see `app/decisions/page.tsx`); `api.accounts` (MODEL/ACCOUNT row + no-account gate);
`useProject`. Icons present (`components/Icon.tsx`): `brain tasks board orch mic gate
term search link doc flag x check play spark cog graph plus arrow chev cal bolt` —
covers every `i-*` the reference uses (`spark→spark, orch→orch, flag→flag,
x→x, arrow→arrow, plus→plus, search→search, chev→chev, link→link, cog→cog`).

---

## Build steps

> Order matters: shared types + seed data + ChatPanel first, then surfaces, then
> rich cards, then mentions. CSS is ported verbatim from `inner.html` into
> `app/globals.css` (we already host the reference token vars + `.ch-*`-adjacent
> styles there).

### Step 1 — Chat domain types + seed data layer
File: `apps/client/lib/chat.ts` (new) + extend `lib/types.ts`.
- Types mirroring the reference shape:
  ```ts
  type ChatRole = "user" | "assistant";
  type CiteId = string;            // "ADR-031" | "SPD-144" | "mtg-217" | "fc-2"
  type PlanStep = { title: string; detail?: string };
  type PlanCard = { steps: PlanStep[]; risk: "low"|"med"|"high" };
  type ActionCard = { type: "adr-edit"|string; target: string; section?: string;
                      summary: string; risk: "low"|"med"|"high";
                      diff?: { del: string[]; add: string[] } };
  type ChatMessage = { role: ChatRole; t?: string; text: string;
                       cites?: CiteId[]; plan?: PlanCard|null; action?: ActionCard };
  type ChatThread = { id: string; title: string; project: string;
                      pinned: boolean; updated: string; msgCount: number;
                      messages?: ChatMessage[] };
  ```
  Note: promote the reference's hard-coded diff in `ActionCard` (mod_10.js:259–265)
  into the data as `action.diff` so cards are data-driven, not literal.
- `apps/client/lib/seed/chatThreads.ts` (new) = a faithful port of
  `SpadeData.chatThreads` (`mod_01.js:280–323`) INCLUDING the full `th-1` message
  log (with `cites`, the `adr-edit` action + its diff lines) and the
  `generateMockMessages` seeds for `th-2`/`th-3` (`mod_10.js:278–294`). The
  bodyless threads (`th-2`…`th-8`) keep their `msgCount`/`updated`/`pinned` meta.
- `lib/useChatThreads.ts` (new): returns `{ threads, activeId, setActiveId,
  getThread(id) }`. SEED-backed now; later swapped to SWR over a real endpoint
  (see Data sourcing → BACKEND-FEATURE).

### Step 2 — Mention / citation resolver
File: `apps/client/lib/chatRefs.ts` (new). Ports `resolveMention` + `CitePill`
label/kind logic from `mod_10.js:194–218`, but routes via Next paths instead of
`goto`:
- `ADR-*` → `/decisions?adr=<id>`  (decisions page already reads brainNodes;
  add a `?adr=` deep-link param there — small, see PR 5).
- `SPD-*` / `MOB-*` → `/task/<id>`.
- `mtg-*` → `/meetings` *(no route yet — fall back to no-op/disabled until the
  meetings page lands; flag in Data sourcing).* 
- `fc-*` → `/feedback` *(same: no route yet).* 
- `kindOf(id)` + `labelOf(id, pools)` resolve against the **mention pool**
  (Step 6): real tasks + real (brain-derived) decisions; meetings/feedback come
  from SEED until their pages exist.

### Step 3 — Extract shared `ChatPanel`
File: `apps/client/components/ask/ChatPanel.tsx` (new). Port `mod_10.js` `ChatPanel`
+ `Message` + `renderText`. Props: `{ thread, mode, onClose?, onOpenAsPage? }`.
- mode `"page"|"dock"|"bubble"` → root `className={"ch-panel ch-mode-"+mode}`.
- Header (`.ch-head`) only meaningful in page mode (CSS already hides it in
  bubble/dock). "Open as page" arrow + close `×` wired to props.
- `.ch-stream` maps `thread.messages` → `<Message>`; auto-scroll to bottom on
  thread change (`scrollRef`, `mod_10.js:30–34`).
- Composer (`.ch-composer-wrap`): textarea auto-resize (max 160px), placeholder +
  hint copy verbatim, "Send" primary btn. **Send wiring:** reuse the real
  orchestrator round-trip from `AskDock.send()` (lift `resolveOrchestrator` +
  `api.promptSession` into a shared `lib/useOrchestratorSend.ts` so ChatPanel and
  the old dock share it). On send: append a `{role:"user"}` message to the thread,
  call the orchestrator, append the `{role:"assistant"}` reply (Markdown-rendered
  via `Markdown.tsx`). Keep `ThinkingIndicator` during `busy`.
- `<Message>` (`.ch-msg ch-<role>`): avatar (`RM` initials / `spark` icon),
  who+timestamp (`.ch-msg-h`), text via `renderText`, then `cites`/`plan`/`action`.
- Empty state `.ch-empty` when `!thread`.
- CSS: ensure `inner.html:2687–2960` (`.ch-panel/.ch-head/.ch-msg/.ch-stream/
  .ch-composer*/.ch-empty`) is present in `globals.css`.

### Step 4 — Bubble + ⌘K side dock (replace the top-center float)
File: rewrite `components/ask/ChatBubble.tsx` (rename from/replace `AskDock.tsx`'s
shell; keep `useAskDock` as the open-state hook, extend it to carry `mode`).
- State `mode ∈ null|"bubble"|"dock"`; default active thread = most recent
  (`threads[0]`) on open (`mod_12.js:12–16`).
- ⌘K/Ctrl+K toggles **dock**; Esc closes (replaces current float toggle in
  `AskDock.tsx:189–201` and `useAskDock`).
- Trigger pill `.ch-bubble` (bottom-right, solid accent, spark + "Ask" + `⌘K`).
- Bubble panel `.ch-bubble-panel` (440×620) = `BubbleHeader` + `ChatPanel mode="bubble"`.
- Dock `.ch-dock` + `.ch-dock-overlay` (480px, overlay click closes) =
  `BubbleHeader` + `ChatPanel mode="dock"`.
- `BubbleHeader` (`.ch-bub-head`): thread-picker dropdown (`.ch-bub-thread-list`)
  + New / Open-as-page (`router.push('/ask')`) / Dock↔Float / Close icon-btns.
- Keep the existing **no-account gate** + **real send**; drop the drag/collapse/
  `spade-ask-pos`/`spade-ask-collapsed` localStorage behavior (reference has none).
- CSS: port `inner.html:2962–3050` (`.ch-bubble*, .ch-dock*, .ch-bub-*`).
- Update `app/layout.tsx:48` to mount `<ChatBubble/>` (still global, still
  `atWorkspace`-hideable if/when a workspace shell exists).

### Step 5 — Full `/ask` page
File: `apps/client/app/ask/page.tsx` (new), `components/ask/AskView.tsx` +
`ThreadRow`. Port `mod_02.js`.
- 3-col `.ask-body` grid; `.page-head` breadcrumb + Settings + New thread.
- `.ask-threads`: `.ask-search` (filter by title), PINNED/RECENT groups of
  `ThreadRow`, footer "New thread".
- `.ask-main`: `<ChatPanel mode="page">` for the active thread; honor a
  deep-link (query `?thread=<id>` set by "open as page" from the bubble — replaces
  the reference's `window.SpadeChatThreadId` global).
- `.ask-context` rail: PROJECT CONTEXT (SPRINT seed; BACKLOG = real `tasks.length`;
  DECISIONS = real brain-derived count; BRAIN = real `brainNodes.length`; MEETINGS/
  FEEDBACK = SEED counts), RECENT ACTIONS (SEED, mirrors `mod_02.js:110–126`),
  MODEL (AGENT seed; ACCOUNT = real first account; SPENT seed).
- Add an **"Ask"** nav entry pointing to `/ask` (wherever the sidebar/nav nav list
  lives — confirm during impl; no central nav array was found, links are per-page).
- CSS: port `inner.html:2605–2685` (`.ask-body/.ask-threads/.ask-search/
  .ask-thread*/.ask-main/.ask-context/.ask-ctx-*`).

### Step 6 — Citation pills + @mentions (inline + autocomplete)
Files: `components/ask/CitePill.tsx`, mention logic in `ChatPanel.tsx`, pool in
`lib/useMentionPool.ts` (new).
- **Mention pool** (`mod_10.js:13–20`): `{id,label,kind,target}[]` built from
  decisions (ADR) + tasks (Task) + feedbackClusters (Feedback) + meetings (Meeting).
  REAL: tasks (`api.tasks`), decisions (brain-derived, same selector as decisions
  page). SEED: feedback clusters + meetings (no endpoint yet).
- **Inline mentions** (`renderText`, `mod_10.js:179–192`): split text on
  `/(@[\w-]+)/`, render `@x` as `.ch-mention-inline` link → `chatRefs.resolveMention`.
- **Citation pills** (`CitePill`, `mod_10.js:201–218`): `.ch-cite k-<kind>`,
  kind label + mono id, click → resolve.
- **Composer autocomplete** (`mod_10.js:36–61, 63–74, 119–129`): `@`-trigger regex
  `/@([\w-]*)$/` on the textarea, `.ch-mention-pop` with up to 6 filtered rows
  (`.ch-mention-row` = kind chip + mono id + label); Enter/Tab inserts the top hit
  (`@<id> `); click inserts.
- CSS: port `inner.html:2774–2802` (mentions/cites) + `2916–2950` (`.ch-mention-pop/
  .ch-mention-row/.ch-mention-kind`).

### Step 7 — Plan card + Action/Diff card
Files: `components/ask/PlanCard.tsx`, `components/ask/ActionCard.tsx`.
- `PlanCard` (`mod_10.js:220–245`): `.ch-plan` header (orch icon + "Proposed plan"
  + mono `{n} steps · {risk}`), numbered `<ol>` (`.ch-plan-num` zero-pad), Modify
  (ghost) + Run plan (primary). Buttons are presentational now (no backend);
  wire to no-op handlers with a TODO → backend follow-up.
- `ActionCard` (`mod_10.js:247–275`): `.ch-action risk-<risk>`, kind chip +
  clickable target (`resolveMention`) + `risk:` label, summary, and for
  `type==="adr-edit"` the `.ch-diff` block driven by `action.diff` (`.del`
  strike-through red / `.add` green). Footer Reject / Modify / Send to gates /
  Apply (presentational; "Send to gates" is the natural future hook into the
  existing brakes/gates API).
- CSS: port `inner.html:2804–2914` (`.ch-plan*, .ch-action*, .ch-diff*`).

### Step 8 — Retire the old float; reconcile send path
- Delete `.ask-float/.ask-handle/.ask-card/.ask-msg*/.ask-composer*` float CSS from
  `globals.css` (or keep only what `ChatPanel`/seed tests still reference) once
  `ChatBubble` + `/ask` are the only entry points. Keep `Markdown.tsx`,
  `ThinkingIndicator.tsx`, `lib/useAskDock.ts` (extended), `lib/api.ts` send methods.
- Update `app/layout.tsx` import (`AskDock` → `ChatBubble`).
- Migrate/expand `components/ask/__tests__/ask.test.tsx` to the new components.

---

## Data sourcing (REAL | SEED | BACKEND-FEATURE)

| Surface / data | Sourcing | Notes |
|---|---|---|
| **Sending a message / assistant reply** | **REAL** | Reuse `resolveOrchestrator` + `api.setCurrentProject` + `api.promptSession` from `AskDock.send()`; reply Markdown-rendered. |
| No-account gate | **REAL** | `api.accounts()` (keep existing gate). |
| Mention/cite pool — **Tasks** | **REAL** | `api.tasks(projectId)`. |
| Mention/cite pool — **Decisions (ADR)** | **REAL (derived)** | Brain-node-derived, same selector as `app/decisions/page.tsx`. |
| Context rail — BACKLOG / BRAIN / DECISIONS counts | **REAL** | `tasks.length` / `brainNodes.length` / decisions count. |
| Context rail — ACCOUNT | **REAL** | first `api.accounts()` entry. |
| **Thread list / sessions** (titles, pinned, msgCount, updated, message logs) | **SEED** | Port `SpadeData.chatThreads` (`mod_01.js`) + `generateMockMessages` (`mod_10.js`). New chats are ephemeral (live send) appended onto the seed thread until the backend lands. |
| **Plan cards / Action+Diff cards / citations on seeded msgs** | **SEED** | The structured payloads live in the seed thread (`th-1`). Live orchestrator replies render as Markdown only (no structured cards) until the backend emits structured tool-output. |
| Mention/cite pool — **Meetings / Feedback clusters** | **SEED** | No `api.meetings`/`api.feedback`; mirror `SpadeData.meetings`/`feedbackClusters`. `mtg-*`/`fc-*` links are no-ops until those pages exist. |
| Context rail — SPRINT / MEETINGS / FEEDBACK / SPENT / AGENT / RECENT ACTIONS | **SEED** | Mirror `mod_02.js:84–142`; no sprint/spend/meetings/feedback endpoints. |

**BACKEND-FEATURE (planned follow-up PR + test):**
1. **Chat threads/sessions API** — persist threads (`id/title/pinned/updated/
   msgCount`) + message logs per project; CRUD for "New thread", rename/title,
   pin, switch. Replaces the SEED thread store and the ephemeral-on-close behavior.
   *Test:* create thread → send → reload → thread + messages persist.
2. **Structured tool-output from the orchestrator** — emit typed `cites` / `plan` /
   `action(adr-edit + diff)` blocks so live replies render real Plan/Action/Diff/
   citation cards (not just Markdown). *Test:* a reply with a structured plan
   renders a `.ch-plan`; an `adr-edit` renders a `.ch-diff` with add/del lines.
3. **Action wiring** — "Run plan" → spawn/pipeline; "Send to gates" → existing
   brakes/gates API; "Apply" → ADR edit. *Test:* "Send to gates" creates a brake.
4. **Meetings + Feedback endpoints/pages** so `mtg-*`/`fc-*` cites/mentions resolve
   and the rail counts go REAL. *Test:* `fc-2` cite navigates to the feedback page.

---

## Validation

### Playwright (`apps/client` e2e)
- **Bubble:** trigger pill is bottom-right, solid-accent, text "Ask" + "⌘K";
  clicking opens the 440×620 bubble; header shows the most-recent seed thread title.
- **⌘K dock:** ⌘K opens the right-edge dock (480px) with overlay; overlay click
  and Esc close it; ⌘K again toggles.
- **Thread picker:** open dropdown → switch thread → stream + composer update.
- **/ask page:** navigate to `/ask`; 3 columns present; search filters threads;
  PINNED + RECENT groups; clicking a row sets `.active` and swaps the panel;
  context rail shows real BACKLOG/BRAIN counts; "open as page" from the bubble lands
  on `/ask?thread=<id>` with that thread active.
- **Rich messages (seed th-1):** assistant message renders avatar + "Spade · Claude"
  + timestamp; citation pills (ADR amber / Task blue) clickable; the `adr-edit`
  Action card renders `.ch-diff` with a red `.del` + two green `.add` lines and the
  Reject/Modify/Send-to-gates/Apply footer; the th-1 Plan path (if seeded) renders
  `.ch-plan`.
- **@mentions:** typing `@SPD` opens `.ch-mention-pop`; Enter inserts `@SPD-144 `;
  rendered inline `@SPD-144` link routes to `/task/SPD-144`.
- **Real send (mocked API):** type → Send → user bubble appears, ThinkingIndicator
  shows, assistant Markdown reply appears; no-account state shows the gate + link.

### Manual
- Side-by-side vs `docs/Spade (standalone).html`: bubble color/glow/position, the
  ⌘K dock slide + overlay dim, page 3-col proportions (260/1fr/280), avatar discs,
  user-right/assistant-left alignment, cite/plan/action card spacing, diff colors,
  mention popup, composer placeholder + hint + Send button.
- Verify icons map (`spark/orch/flag/arrow/plus/search/chev/link/cog/x`).
- Dark-mode tokens only (reference is dark); confirm `--accent/--amber/--blue/
  --green/--red` chip colors match.

---

## PR breakdown

| PR | Scope | Depends on | Sourcing |
|---|---|---|---|
| **PR 1 — Chat data + shared ChatPanel** | Steps 1–3: `lib/chat.ts` types, `lib/seed/chatThreads.ts`, `useChatThreads`, `lib/useOrchestratorSend.ts` (lift real send), `ChatPanel.tsx` (header/stream/composer/Message/empty), port `.ch-panel/.ch-msg/.ch-stream/.ch-composer/.ch-empty` CSS. | — | REAL send + SEED threads |
| **PR 2 — Bubble + ⌘K side dock** | Step 4 + 8 (partial): `ChatBubble.tsx` + `BubbleHeader`, trigger pill, 440×620 bubble, 480px dock + overlay, thread picker; extend `useAskDock` w/ mode; swap `layout.tsx`; retire top-center float; port `.ch-bubble/.ch-dock/.ch-bub-*` CSS. | PR 1 | REAL send + SEED threads |
| **PR 3 — Full /ask page** | Step 5: `app/ask/page.tsx`, `AskView`/`ThreadRow`, 3-col layout, search, pin/recent, context rail (real counts where available), nav entry, "open as page" deep-link; port `.ask-*` CSS. | PR 1 | REAL counts + SEED rail |
| **PR 4 — Rich cards + @mentions** | Steps 6–7: `CitePill`, inline mentions + `.ch-mention-pop` autocomplete, `useMentionPool` (real tasks/decisions + seed meetings/feedback), `PlanCard`, `ActionCard`+`.ch-diff`; port mention/cite/plan/action/diff CSS. | PR 1 (PR 3 for routes) | REAL pool (tasks/ADR) + SEED payloads/cards |
| **PR 5 — Backend follow-ups** | BACKEND-FEATURE 1–4: threads/sessions persistence API + SWR swap; structured orchestrator tool-output → live cards; action wiring (Run plan / Send to gates / Apply); meetings+feedback endpoints/pages + `?adr=` deep-link on decisions. Each with the test noted above. | PR 1–4 | REAL (new backend) |

---

## Summary (10 lines)
1. **5 PRs**: (1) chat types/seed + shared `ChatPanel`, (2) bubble + ⌘K side dock,
   (3) full `/ask` page, (4) rich cards + @mentions, (5) backend follow-ups.
2. **Bubble gap**: ours is a top-center glass "Ask the brain ⌘K" float; reference is
   a **bottom-right solid-accent pill** ("Ask" + ⌘K) → 440×620 bubble + 480px right
   dock w/ overlay. Full replacement, not a restyle.
3. **Chat-card gaps**: no citation pills, Plan cards, or Action/Diff (ADR-EDIT
   red/green diff + Reject/Modify/Send-to-gates/Apply) cards; no avatars, no
   user-right/assistant-left bubble alignment, no who+timestamp, no @mentions.
4. **Session-list gaps**: no `/ask` route, no thread list/search/pin-recent groups,
   no thread picker/switcher, no context rail — we have one ephemeral conversation.
5. **Real today**: orchestrator send, tasks, brain-derived decisions, accounts,
   brain counts — all reused, not rebuilt.
6. **Seeded**: thread list + th-1 message log (cites/plan/action+diff) mirroring
   `SpadeData.chatThreads`; meetings/feedback pool; rail SPRINT/SPENT/AGENT/actions.
7. **Backend needs (PR 5)**: (a) chat threads/sessions persistence API; (b)
   structured orchestrator tool-output (cites/plan/action) so live replies render
   real cards; (c) action wiring (Run plan / Send to gates → brakes / Apply); (d)
   meetings + feedback endpoints/pages so `mtg-*`/`fc-*` resolve.
8. Each backend item ships with a Playwright test (persist-on-reload, structured
   plan→`.ch-plan`, Send-to-gates→brake, fc-2 cite→feedback page).
9. CSS is ported verbatim from `inner.html:2605–3050`; every `i-*` icon already
   exists in `components/Icon.tsx`.
10. Net: PRs 1–4 reach full visual + seeded-data parity; PR 5 makes the seeded
    surfaces real.
