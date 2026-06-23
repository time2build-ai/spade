# CLI / logs — `/cli`

**Status:** 🟢 Ready (real data). **Handoff:** `views/cli.jsx`, `Spade.html` (`.term`, `.lvl-*` console spans).

## What it is
A terminal-styled view: a left list of commands/sessions, a right `#08080a` console showing
the selected session's live screen output.

## Data source (real)
- `GET /api/sessions` → `{ sessions: Session[] }` (global fleet; already typed in `lib/types.ts`, `api.sessions`).
- `GET /api/sessions/{id}/screen` → **plain text** terminal screen. Already have `api.sessionScreen(id)`.
  Also accepts `?history=true` for scrollback (`GET /sessions/{id}/screen?history=true`) — add an `api.sessionScreen(id, history?)` overload.

## Scope
- Left rail: list sessions (name/role/state) — reuse `sessionStatusVisual`. Clicking selects.
- Right: the `<Terminal>` surface (reuse/extract `components/orchestrator/Terminal.tsx`) polling the selected session's screen (`refreshInterval` ~2000), preserved whitespace, #08080a bg.
- `<PageHead title="CLI / logs" />`. Sidebar `CLI / logs` (System group) `href="#"` → `/cli`.

## Components
- Reuse `Terminal` (consider lifting it to `components/shared/Terminal.tsx` so both Orchestrator and CLI use it).
- `SessionRow` for the left list.

## Acceptance
- Lists real sessions; selecting one streams its real screen text (polled); honest empty state when no sessions.
- States: loading / empty / error. tsc clean; render tests for the row + terminal-null path.

## Honesty notes
- The handoff's syntax-colored prompt/arg/flag/ok/err spans assume structured log lines; our
  screen endpoint returns raw terminal text. Render it as-is (mono, preserved whitespace) —
  do NOT fabricate `.lvl-*` classification. (Optional later: a heuristic colorizer, clearly best-effort.)
- `data.cliRuns` in the handoff is mock; there is no saved command-history endpoint — drive purely off live sessions.
