# Shell & design system parity

Reference: decoded React mockup (`inner.html` + `modules/mod_22.js`, `modules/mod_01.js`).
Ours: Next.js client at `apps/client` (`app/layout.tsx`, `app/globals.css`,
`components/shell/Sidebar.tsx`, `components/shell/Topbar.tsx`,
`components/shell/ProjectSwitcher.tsx`, `components/ui/*`).

## Reference: what it renders

**Shell grid** (`inner.html` :500): `.app` grid is `232px 1fr` cols / `44px 1fr` rows.
- `body.home-mode` (view = `home`) collapses to a single column and hides `.sidebar`;
  `home` and `workspace` views are full-bleed.
- `body.workspace-level` (view = `home` or `workspace`) tints topbar + sidebar with a
  lavender wash and swaps the sidebar nav from `proj-only` to `ws-only` items.

**Topbar** (`inner.html` :4552):
- `.brand` = `.brand-mark` gradient chip + text "Spade" (no `small` tagline rendered).
- `.proj-switcher`: glyph (mono, colored) + `.proj-name` + chevron svg, dropdown menu.
- Command pill `.topbar-pill` (margin-left 4px): search icon + "Ask the brain…" + `.kbd` ⌘K.
- `.topbar-right`: three pills + spark ghost button + RM avatar:
  - `<span class="topbar-pill"><span class="pulse-dot"></span> daemon · 7 sessions</span>`
  - `<span class="topbar-pill mono">sprint 26 · day 2/10</span>` (the **sprint pill**, hidden at workspace level via JS, `mod_22.js` :56)
  - `<span class="topbar-pill" title="Active Claude account">` green dot + `acct: rmurphy@acme · 62%`
  - `.btn.ghost` spark icon button (`#tweak-btn`)
  - `.avatar` "RM"

**Sidebar** (`inner.html` :4594): a `sb-proj-head` (project) **or** `sb-proj-head ws-only-h`
(workspace) card, then grouped nav. Project-scoped groups & items, in order:
- **Project**: Overview (`i-graph`), Ask (`i-spark`, trailing `badge mono ⌘K`)
- **Plan**: Sprints (`i-board`, 26), Backlog (`i-tasks`, 23), Product brain (`i-brain`, 847), Graph & Issues (`i-graph`, 7)
- **Execution**: Orchestrator (`i-orch`, `live` "7 live"), Agent pool (`i-spark`, 10), Human gates (`i-gate`, amber 2)
- **Inputs**: Meetings (`i-mic`, 42), Feedback (`i-flag`, 312), Decisions (`i-doc`, 94)
- **System**: CLI / logs (`i-term`), Settings (`i-cog`)

Workspace-scoped groups (shown only when `workspace-level`):
- **Workspace**: Settings (`i-cog`), Agents pool (`i-spark`, 5), Integrations (`i-link`, 7), CLI / logs (`i-term`)
- **Projects**: All projects (`i-graph`, 4)

Footer: `margin-top:auto` block "Local‑first · v1.0.0" + mono "~/.spade · 84 MB".

**Tokens** (`inner.html` :460): exact hex set per brief. Fonts wired as literal
`"Instrument Serif"` / `"Inter Tight"` / `"JetBrains Mono"` in `--serif/--sans/--mono`.

## Ours: what it renders (with file paths)

**Shell grid** — `app/globals.css` :342 `.app` is `232px 1fr` / `44px 1fr`. **Matches.**
But **there is no `home-mode` / `workspace-level` machinery at all**: no `body.home-mode`,
`.home-mode .sidebar{display:none}`, `.proj-only`/`.ws-only` rules, and no lavender
topbar/sidebar tint. The shell always renders the sidebar; full-bleed home and the
workspace nav variant do not exist. (`app/page.tsx` is the home route but the sidebar
still shows.) `layout.tsx` :46 wraps children in `<main className="overflow-auto">`.

**Topbar** — `components/shell/Topbar.tsx`:
- Brand: `<Link href="/">` mark + "Spade". Matches (ref uses div+JS, ours uses Link — fine).
- ProjectSwitcher rendered.
- Command pill present, search icon + "Ask the brain…" + `Kbd ⌘K`. Matches.
- `topbar-right`: sessions pill (`daemon · N sessions`, live), conditional default-account
  pill (`mono`, green dot + `account.label`), `IconBtn spark`, `Avatar RM`.
- **No sprint pill** (`sprint 26 · day 2/10`).
- Account pill shows only `account.label` (no `acct:` prefix, no `· 62%` usage).
- Spark button is an `IconBtn` (bordered square, `app/globals.css` :131) **not** `.btn.ghost`
  (transparent, borderless) as in the reference.

**Sidebar** — `components/shell/Sidebar.tsx`. Project header card + ws header card both
exist (ws shown only when no project — driven by data, not a `workspace-level` mode).
Groups/items (ours):
- **Project**: Overview (`board`, `#` soon), Ask (`brain`, `#` soon)
- **Plan**: Sprints (`cal`, `#`), Backlog (`tasks`, `/backlog` live count), Product brain (`brain`, `/brain`), Graph & Issues (`graph`, `#`)
- **Execution**: Orchestrator (`orch`, live), Agent pool (`board`, `/agent-pool`), Human gates (`gate`, amber)
- **Inputs**: Meetings (`mic`, `#`), Feedback (`link`, `#`), Decisions (`doc`, `/decisions`)
- **System**: CLI / logs (`term`, `#`), Settings (`cog`, `#`)
- **No Workspace / Projects (ws-only) groups.**
- Unbuilt items render dimmed `.sb-item.soon` with a "Próximamente" badge (ref has no such state).
- Footer matches ("Local‑first · v1.0.0" + "~/.spade · 84 MB").

**Tokens** — `app/globals.css` :3 `:root` block is hex-identical to the reference.
Plus an `@theme` block mapping tokens to Tailwind v4 `--color-*` / `--font-*`. Fonts are
wired via `next/font` (`layout.tsx`) and prefixed (`var(--font-sans), "Inter Tight"…`).

**Extra route**: `app/dev-tokens/` — a token/primitive gallery with no reference equivalent
(dev-only; not a parity concern but should be excluded from prod nav/sitemap).

## Diff table

| Aspect | Reference | Ours | Severity |
|---|---|---|---|
| home-mode full-bleed | `body.home-mode` hides sidebar, single col | absent — sidebar always shows on home | Blocker |
| workspace-level mode | tints + swaps to `ws-only` nav | absent entirely | Blocker |
| Sidebar Workspace group | Settings / Agents pool / Integrations / CLI | missing | Blocker |
| Sidebar Projects group | "All projects" (i-graph, 4) | missing | Major |
| Topbar sprint pill | `sprint 26 · day 2/10` mono pill | missing | Major |
| Account pill copy | `acct: rmurphy@acme · 62%` (prefix + usage %) | `label` only | Major |
| Overview icon | `i-graph` | `board` | Minor |
| Ask icon | `i-spark` | `brain` | Minor |
| Ask trailing badge | `badge mono ⌘K` | none (rendered as `soon`) | Minor |
| Sprints icon | `i-board` | `cal` | Minor |
| Graph & Issues icon | `i-graph` | `graph` (no `graph` id in ref set) | Minor |
| Agent pool icon | `i-spark` | `board` | Minor |
| Feedback icon | `i-flag` | `link` | Minor |
| Spark/tweaks button | `.btn.ghost` (borderless) | `IconBtn` (bordered square) | Minor |
| "Próximamente" soon state | none | dimmed unbuilt items | Minor (intentional PoC) |
| Brand `small` tagline | `.brand small` style exists (unused in markup) | absent | Minor |
| `@theme` Tailwind block | none | present (additive, harmless) | Minor |
| dev-tokens route | none | extra dev gallery | Minor |

## Concrete parity changes

- Add `home-mode` behavior: on the home route, hide the sidebar and make `main` full-bleed
  (`.app` single column). Mirror `inner.html` :506-508 (`body.home-mode .app{grid-template-columns:1fr} .sidebar{display:none} .main{grid-column:1/-1}`).
- Add `workspace-level` mode (home + a future `/workspace` view): lavender topbar/sidebar
  wash (`inner.html` :519-527) and swap project nav for the **Workspace** + **Projects** groups.
- Add the **Workspace** sidebar group: Settings (`cog`), Agents pool (`spark`, 5),
  Integrations (`link`, 7), CLI / logs (`term`); and **Projects** group: All projects (`graph`, 4).
- Add the topbar **sprint pill** `<span class="topbar-pill mono">sprint 26 · day 2/10</span>`,
  hidden at workspace level (mirror `mod_22.js` :56).
- Account pill: prefix `acct: ` and append ` · {usage}%` so it reads `acct: rmurphy@acme · 62%`.
- Fix sidebar icons to match reference `<use>` ids: Overview `board`→`graph`; Ask `brain`→`spark`;
  Sprints `cal`→`board`; Agent pool `board`→`spark`; Feedback `link`→`flag`. (Graph & Issues uses
  `i-graph` in ref; our `graph` icon is acceptable if it renders the same glyph.)
- Add the Ask trailing `badge mono ⌘K` (font-size 9.5px) on the Ask nav item.
- Change the topbar tweaks/spark button from `IconBtn` to `.btn.ghost` (transparent, borderless)
  to match `#tweak-btn`.
- Optionally render the brand `small` tagline (style exists at ref :553 but markup omits it — leave out).
- Exclude `dev-tokens` from any production nav/build.

## Suggested PR grouping

1. **PR-shell-modes**: introduce `home-mode` / `workspace-level` body classes + CSS (full-bleed
   home, lavender wash) and route-driven mode detection. (Blocker)
2. **PR-sidebar-workspace-nav**: add Workspace + Projects (`ws-only`) groups and the
   proj-only / ws-only visibility switch. (Blocker/Major)
3. **PR-topbar-pills**: add sprint pill, fix account-pill copy (`acct:` + usage %), switch
   tweaks button to `.btn.ghost`. (Major/Minor)
4. **PR-sidebar-icons**: align nav icons + add Ask ⌘K badge. (Minor, low-risk)
</content>
</invoke>
