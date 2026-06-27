# Ask + Chat parity

Goal: our Ask/Chat surfaces should look IDENTICAL to the reference Spade mockup.
Reference files: `modules/mod_02.js` (AskView — full Ask page), `modules/mod_10.js`
(ChatPanel — shared chat), `modules/mod_12.js` (ChatBubble — floating pill + dock),
`inner.html` (tokens + CSS).
Our files: `apps/client/components/ask/AskDock.tsx`, `components/ask/Markdown.tsx`,
`components/ask/ThinkingIndicator.tsx`, `lib/useAskDock.ts`, CSS in `app/globals.css`
(lines ~912–1170).

---

## Reference: what it renders

The reference ships **three** chat surfaces, all sharing one `ChatPanel`:

### 1. Full Ask page — `AskView` (`mod_02.js`), route `goto('ask')`
A full-page, **three-column** layout (`.ask-body`, CSS `inner.html:2605`):

- **Page header** (`.page-head`): breadcrumb `**Ask** · conversations with this
  project`, right side has `Settings` (ghost btn w/ cog) + `New thread` (primary
  btn w/ plus).
- **Left column — thread list** (`.ask-threads`, ~260px):
  - Search box (`.ask-search`) with magnifier icon + "Search threads" input.
  - Grouped thread rows: a `PINNED` group (mono uppercase header) then a `RECENT`
    group. Each `ThreadRow` (`.ask-thread`) shows title (`.ask-thread-t`) + a mono
    meta line `{n} msgs · {updated}`. Active row gets `.active` (accent-tinted bg,
    bolder white title). Hover → `--bg-2`.
  - Footer (`.ask-thread-foot`): full-width ghost "New thread" button.
- **Center column — active thread** (`.ask-main`): renders `<ChatPanel mode="page">`.
- **Right column — context rail** (`.ask-context`, ~260px): three mono-headed
  cards — `PROJECT CONTEXT` (SPRINT / BACKLOG / DECISIONS / BRAIN / MEETINGS /
  FEEDBACK rows), `RECENT ACTIONS` (kind chip + title + mono meta), `MODEL`
  (AGENT / ACCOUNT / SPENT rows). Pure read-only label/value rows.

### 2. Shared chat panel — `ChatPanel` (`mod_10.js`, CSS `inner.html:2687`)
`mode` ∈ `"page" | "dock" | "bubble"`. Anatomy:

- **Header** (`.ch-head`): optional pin flag, title + mono subtitle
  `{n} msgs · updated {updated}`. Right side: in dock/bubble shows an "open as page"
  arrow `icon-btn`, and a close `×` when `onClose` provided.
- **Message stream** (`.ch-stream`): `Message` rows (`.ch-msg`):
  - **Avatar** (`.ch-msg-avatar`, ~26px): user = initials "RM" on accent disc;
    assistant = spark icon. User row is **right-aligned** (avatar `order:2`, body
    right-aligned, text in an accent/`--bg-2` bubble); assistant is left-aligned,
    no bubble background.
  - **Header line**: `who` (`Robert` / `Spade · Claude`) + mono timestamp.
  - **Text**: paragraphs split on `\n`; inline `@mentions` rendered as clickable
    mono accent links (`.ch-mention-inline`) that route via `resolveMention`.
  - **Citation pills** (`.ch-cites` / `.ch-cite`): kind-colored chips
    (ADR=amber, Task=blue, Meeting=accent, Feedback=green) showing `kind` + mono id,
    click → navigate to the record.
  - **Plan card** (`.ch-plan`): header with orch icon + "Proposed plan" + mono meta
    `{n} steps · {risk}`; numbered `<ol>` steps (zero-padded mono index, title +
    muted detail); footer `Modify` (ghost) + `Run plan` (primary).
  - **Action / diff card** (`.ch-action`, risk border tint): kind chip + clickable
    target + `risk:` label; summary; for `adr-edit` an inline **diff** (`.ch-diff`)
    with red strike-through `- del` lines and green `+ add` lines; footer
    `Reject` / `Modify` / `Send to gates` / `Apply`.
- **Composer** (`.ch-composer-wrap`): auto-growing textarea (max 160px) with
  placeholder "Ask about this project, or @mention an ADR/task/cluster"; an
  **@-mention autocomplete popup** (`.ch-mention-pop`) over the project pool
  (ADR/Task/Feedback/Meeting); footer hint row `@ to mention · Enter to send ·
  ⇧Enter newline` + a `Send` primary button with arrow icon (disabled when empty).
- **Empty state** (`.ch-empty`): spark icon + "No thread selected".

### 3. Floating bubble + dock — `ChatBubble` (`mod_12.js`, CSS `inner.html:2962`)
A single component managing `mode` ∈ `null | "bubble" | "dock"`:

- **Trigger pill** (`.ch-bubble`): `position:fixed; bottom:18px; right:22px`,
  pill-shaped, **solid accent** background, dark text, spark icon + "Ask" +
  `⌘K` kbd chip; accent glow shadow, hover lift. Shown only when nothing is open.
- **Bubble panel** (`.ch-bubble-panel`): fixed bottom-right, **440×620px**
  (max `100vh-36px`), `--bg-1` card, 12px radius, slide-up-fade in. Contains a
  `BubbleHeader` (thread picker dropdown + new/open-page/dock/close icon-btns) and
  `<ChatPanel mode="bubble">`.
- **Dock** (`.ch-dock`): triggered by **⌘K / Ctrl+K**. A right-edge side panel,
  `top:0 right:0 bottom:0`, **width 480px** (max 92vw), with a dimmed
  **overlay** (`.ch-dock-overlay`, `rgba(0,0,0,.32)`), slide-in-from-right.
  `BubbleHeader` + `<ChatPanel mode="dock">`. Esc closes; ⌘K toggles.
- **Thread picker** (`.ch-bub-thread-list`): clicking the header title opens a
  dropdown of all threads to switch the active one.
- Hidden entirely at the workspace level (`atWorkspace` → null).

---

## Ours: what it renders

We have **only one** surface: a single floating "Ask the brain" companion,
mounted globally in `app/layout.tsx:48`. **No `/ask` route exists** (routes:
`backlog, brain, decisions, gate, orchestrator, task/[id], agent-pool, dev-tokens,
/`). Opened via the Topbar pill + global ⌘K (`useAskDock`, `lib/useAskDock.ts`).

`AskDock.tsx` renders (CSS `globals.css:912`):

- **`.ask-float`**: fixed, `top:16px; left:50%` translateX(-50%) → **top-center**,
  width **540px**. Draggable; position persisted to `localStorage`
  (`spade-ask-pos`).
- **Control pill `.ask-handle`**: a glass/blurred pill (NOT solid accent) with a
  gradient brain mark, a 6-dot drag grip, a `▾ Hide` / `▸ Show` collapse toggle,
  label "Ask the brain" + the project name, and a `×` close button.
- **Glass card `.ask-card`**: blurred translucent card (`rgba(22,22,28,.66)`,
  blur 22px), 16px radius. Collapsible with a fold-up micro-animation.
  - **Body `.ask-body`** (`max-height:46vh`): hint line "Ask the orchestrator
    about this project…", then `MessageBubble` rows, then status / thinking.
  - **`MessageBubble`** (`.ask-msg`): a `role` label ("You" / "Brain") + text.
    Brain replies render `<Markdown>` (`.ask-md`, full GFM: lists, tables, code,
    headings, blockquote). User/error text is plain. Error variant tints red.
  - **`ThinkingIndicator`**: cycling phrases ("Consulting the brain", …) + 3
    bouncing dots. (Reference has **no** equivalent — it's a static mock.)
  - **Composer `.ask-composer`**: auto-growing textarea, placeholder "Ask the
    brain…", a hint "⇧↵ for newline" + a round send button (arrow icon).
- **No-account state**: brain icon + "No provider accounts configured…" + a
  "Go to Agent pool" link. (Reference has no such gate — it's a live-data concern.)

### Missing entirely (vs reference)
- **Full Ask page / `/ask` route** — no thread sidebar, no context rail, no page
  header, no thread list/search/pin/grouping. (`AskView` has no counterpart.)
- **Bottom-right trigger pill** + **bubble panel** (440×620) — we have a
  top-center floating card instead.
- **⌘K side dock** (right-edge 480px panel + overlay) — ⌘K only toggles our
  top-center float.
- **Multi-thread model** — no thread list, picker, pin/recent groups, per-thread
  metadata. Single ephemeral conversation, lost on close.
- **Rich message anatomy** — no avatars, no user/assistant left/right alignment,
  no "who"/timestamp header, no chat **bubble** styling for user messages.
- **@mentions** (inline links + composer autocomplete popup), **citation pills**,
  **Plan cards**, **Action/Diff cards** — none exist.
- **"Open as page" / "Dock" / "New thread" / thread-switch** affordances.

---

## Diff table

| Aspect | Reference | Ours | Severity |
|---|---|---|---|
| Full Ask page (`/ask`) | 3-col page: threads + chat + context rail | **Absent** — no route | **Blocker** |
| Thread list + search + pin/recent groups | Yes (`.ask-threads`) | None — single ephemeral convo | **Blocker** |
| Context rail (project/actions/model cards) | Yes (`.ask-context`) | None | Major |
| Trigger affordance | Solid-accent **pill, bottom-right**, `⌘K` chip | Glass pill, **top-center**, no chip | Major |
| Floating panel | Bottom-right **bubble 440×620** + ⌘K **side dock 480px** w/ overlay | Single top-center 540px float (drag/collapse) | Major |
| ⌘K behavior | Toggles a **right-edge dock** | Toggles the top-center float | Major |
| Message avatars | 26px disc: "RM" / spark icon | None | Major |
| User/assistant alignment | User **right + bubble**, assistant left no-bg | Both left, label-only | Major |
| Message header (who + timestamp) | "Robert" / "Spade · Claude" + mono time | Role label only ("You"/"Brain") | Major |
| Roles labels | "Robert" / "Spade · Claude" | "You" / "Brain" | Minor |
| @mentions (inline + autocomplete) | Inline accent links + composer popup | None | Major |
| Citation pills (kind-colored) | Yes (ADR/Task/Meeting/Feedback) | None | Major |
| Plan card | Yes (`.ch-plan`, steps + Run plan) | None | Major |
| Action / diff card | Yes (`.ch-action`/`.ch-diff`, add/del lines, Apply/Send to gates) | None | Major |
| Composer placeholder | "Ask about this project, or @mention…" | "Ask the brain…" | Minor |
| Composer hint | "@ to mention · Enter to send · ⇧Enter newline" | "⇧↵ for newline" | Minor |
| Send button | Labeled "Send" + arrow, primary btn | Icon-only round button | Minor |
| Thinking indicator | None (static mock) | Cycling phrases + dots | Minor (extra) |
| Markdown rendering | Plain text paragraphs (no MD parser) | Full GFM via react-markdown | Minor (ours richer) |
| Empty state | Spark + "No thread selected" | "Ask the orchestrator about…" hint | Minor |
| No-account gate | None | Yes (live-data) | Minor (ours-only) |
| Card style | Opaque `--bg-1`, 12px radius, hard shadow | Translucent glass blur, 16px radius | Minor |

---

## Concrete parity changes

1. **Build the full Ask page** at `app/ask/page.tsx` mirroring `AskView`: 3-col
   `.ask-body` grid (threads / `ChatPanel mode="page"` / context rail), page
   header with Settings + New thread, search box, PINNED/RECENT grouped
   `ThreadRow`s, and the PROJECT CONTEXT / RECENT ACTIONS / MODEL rail cards. Port
   CSS from `inner.html:2605–2685`.
2. **Extract a shared `ChatPanel`** component (currently the body/composer logic is
   inline in `AskDock`). Drive it by `mode = page | dock | bubble` so the page,
   dock, and bubble all share one renderer (matches the reference architecture).
3. **Rework messages to match `.ch-msg`**: add avatars (initials / spark), the
   who+timestamp header line, right-align + bubble the user message, left-align the
   assistant. Port `inner.html:2722–2779`. Rename roles to "Robert"/"Spade · Claude"
   (or project-appropriate equivalents).
4. **Add citation pills, Plan cards, and Action/Diff cards** (`.ch-cite`,
   `.ch-plan`, `.ch-action`, `.ch-diff`) — port CSS `inner.html:2781–2913` and the
   `CitePill`/`PlanCard`/`ActionCard` renderers from `mod_10.js`. Wire diff
   add/del line styling.
5. **Add @mentions**: inline clickable mono links in rendered text + the composer
   autocomplete popup (`.ch-mention-pop`) over the project pool (ADR/Task/Feedback/
   Meeting), incl. the `@`-trigger detection in the textarea handler.
6. **Replace the top-center float with the bottom-right bubble model**: a solid
   accent trigger pill (`.ch-bubble`, `bottom:18px right:22px`, `⌘K` chip) → a
   440×620 bubble panel (`.ch-bubble-panel`). Port CSS `inner.html:2962–2998`.
7. **Add the ⌘K side dock**: a right-edge 480px panel + dimmed overlay
   (`.ch-dock` / `.ch-dock-overlay`) with the `BubbleHeader` (thread picker +
   new/open-page/dock/close). Make ⌘K open the dock (not the float). Port CSS
   `inner.html:3000–3050`.
8. **Composer parity**: placeholder "Ask about this project, or @mention an
   ADR/task/cluster", hint "@ to mention · Enter to send · ⇧Enter newline", a
   labeled "Send" primary button with arrow icon.
9. **Decide on glass vs opaque**: reference panels are opaque `--bg-1` w/ 12px
   radius; our glass-blur card diverges. Align to reference for identical look
   (unless we intentionally keep the floating-companion aesthetic — flag for
   product).

Note: items 4–5 and the context rail / model cards depend on having a `SpadeData`-
equivalent client data layer (chatThreads, decisions, tasks, feedback, meetings).
Where we only have live orchestrator output, scope these as structured-output
rendering rather than mock data.

---

## Suggested PR grouping

- **PR A — Shared ChatPanel + message anatomy parity**: extract `ChatPanel`,
  rebuild `.ch-msg` (avatars, alignment, user bubble, who/timestamp), align
  composer copy + Send button, port `.ch-*` message CSS. (Changes 2, 3, 8.)
- **PR B — Bubble + dock relocation**: bottom-right accent trigger pill, 440×620
  bubble panel, ⌘K right-edge dock + overlay, `BubbleHeader` + thread picker.
  (Changes 6, 7; rewires `useAskDock`/⌘K.)
- **PR C — Full Ask page**: `app/ask/page.tsx` (3-col layout, thread list +
  search + groups, context rail), nav entry, "open as page" wiring. (Change 1.)
- **PR D — Rich content cards**: citation pills, Plan cards, Action/Diff cards,
  @mentions (inline + autocomplete). Depends on PR A and a client data layer.
  (Changes 4, 5.)
- **PR E (optional) — Visual finish**: opaque-vs-glass card decision, radii,
  shadows, role label naming. (Change 9.)
