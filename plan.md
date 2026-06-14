# plan.md — `tui-pilot`

A programmatic controller for an **interactive** terminal TUI, driven entirely through
**tmux**, exposed over an HTTP API. The reference target is the Claude Code interactive
REPL, but nothing here is Claude-specific — it should work against any line-or-screen
oriented TUI.

This is a learning exercise. The goal is to **reconstruct programmatic control from raw
terminal-automation primitives**, not to use the shortcuts the tool already ships.

---

## ⛔ Hard constraints (do not violate)

The entire point of this project is defeated if you take the easy path. Therefore:

- **DO NOT** use `claude -p` / `--print`.
- **DO NOT** use `--output-format json|stream-json` or `--input-format stream-json`.
- **DO NOT** use `--resume`, `--bare`, or any other non-interactive flag.
- **DO NOT** use the Claude Agent SDK / `@anthropic-ai/claude-agent-sdk` or any official
  headless wrapper.
- **DO NOT** call the Anthropic API directly.

The **only** sanctioned interface to the running program is the terminal: keystrokes in
via `tmux send-keys`, rendered screen out via `tmux capture-pane`. If a task feels like it
"obviously" wants headless mode — that is expected, and the answer is still no. Treat the
TUI as a black box you can only see and type into.

---

## Why this is hard (the problem to actually solve)

Driving an interactive TUI decomposes into three sub-problems:

1. **Input injection** — easy. `tmux send-keys`. Watch the literal-vs-keyname distinction:
   send prompt *body* with `-l` (literal), then send `Enter` as a separate key. Menus and
   permission dialogs are arrow-key driven (`Up`/`Down`/`Enter`).
2. **Output capture** — `tmux capture-pane -p` returns the **rendered** screen as plain
   text. tmux is itself a terminal emulator, so escape sequences, cursor moves, and
   redraws are already resolved into a 2D character grid. We get the de-ANSI'd screen for
   free; do **not** hand-roll an ANSI parser.
3. **Synchronization** — the hard 90%. Nothing signals when the program is booting,
   thinking, streaming, done/idle, or blocked on a permission prompt. We must **infer
   state from the rendered screen**. This is the classic `expect` problem.

---

## Tech stack

- Python 3.11+
- `tmux` (must be installed and on PATH — check at startup, fail loudly if missing)
- `fastapi` + `uvicorn` for the HTTP layer
- `pyyaml` for the tunable pattern config
- `pytest` for unit tests
- No other runtime deps. (`pyte` is explicitly **not** needed — tmux does the screen
  emulation for us.)

---

## Project layout

```
tui-pilot/
  README.md
  requirements.txt
  patterns.yaml            # version-specific regexes — TUNE THESE per target TUI
  tui_pilot/
    __init__.py
    session.py             # TmuxSession: tmux mechanics only
    screen.py              # PURE functions: normalize() + classify()
    controller.py          # synchronization + high-level prompt()/approve()/interrupt()
    server.py              # FastAPI HTTP layer
    cli.py                 # `dump` (fixture capture) + `repl` (demo)
  tests/
    test_screen.py         # unit tests over captured fixtures — no live TUI needed
  fixtures/                # saved capture-pane snapshots (one per state)
```

---

## Component specs

### `session.py` — `TmuxSession` (mechanics only, no logic)

Thin wrapper over the tmux CLI. Each method shells out to `tmux ...` via `subprocess`.

```python
class TmuxSession:
    def __init__(self, name: str, cmd: str, cols: int = 200, rows: int = 50): ...
    def spawn(self) -> None:        # tmux new-session -d -s {name} -x {cols} -y {rows} {cmd}
    def send_text(self, text: str): # send-keys -l {text}  ; then  send-keys Enter
    def send_key(self, key: str):   # send-keys {key}     (e.g. "Down", "Enter", "C-c", "Escape")
    def interrupt(self):            # send-keys Escape  (fallback: C-c)
    def capture(self, history: bool = False) -> str:
                                    # capture-pane -p   (+ -S - for full scrollback)
    def is_alive(self) -> bool:     # has-session
    def kill(self) -> None:         # kill-session
```

Requirements:
- **Fix the pane size** (`-x`/`-y`) at spawn so line wrapping is deterministic across
  captures. Do not let it inherit a variable terminal width.
- Every method must tolerate the session not existing (raise a typed `SessionError`).

### `screen.py` — pure, testable functions

No tmux, no I/O. Operates on captured strings so it can be unit-tested against fixtures.

```python
class State(Enum):
    BOOTING; IDLE; THINKING; STREAMING; AWAITING_PERMISSION; AWAITING_INPUT; ERROR; EXITED

def normalize(screen: str) -> str: ...
def classify(screen: str, patterns: dict) -> State: ...
```

`normalize()` must strip the things that change without meaning, so two "same" screens
hash equal:
- spinner glyphs (braille block `U+2800–U+28FF`, plus common ASCII spinners `|/-\`)
- elapsed-time counters like `(12s)`, `· 4s`, etc.
- trailing whitespace per line; collapse runs of blank lines

`classify()` is a regex-driven state machine reading from `patterns.yaml`. Match order
matters: check `AWAITING_PERMISSION` and `ERROR` before `IDLE`.

### `patterns.yaml` — the tunable knobs (⚠ must be discovered, not guessed)

```yaml
spinner_chars: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/-\\"
timer_regex: '\(\d+s\)|·\s*\d+s'
idle_regex: '...'            # signature of the empty, ready input box
thinking_regex: '...'        # spinner / "Thinking" / "Esc to interrupt" hint
permission_regex: '...'      # "Do you want to proceed", numbered Yes/No options, ❯ marker
error_regex: '...'
```

The defaults you write here **will be wrong** for the grader's Claude Code version. The
plan is to discover the real signatures via `cli.py dump` (below), then fill these in.
README must say this explicitly.

### `controller.py` — synchronization + high-level API

Owns the state machine and the round-trip logic.

```python
class Controller:
    def state(self) -> State: ...
    def wait_for_settle(self, settle_polls=4, poll=0.25, timeout=120) -> str: ...
    def wait_until(self, target: State, timeout=120) -> None: ...
    def prompt(self, text: str, timeout=180) -> str: ...   # send, wait, return response
    def approve(self): ...        # resolve a permission dialog (yes)
    def deny(self): ...           # resolve a permission dialog (no)
    def interrupt(self): ...
```

**Quiescence loop** (`wait_for_settle`) — implement this precisely:

```
prev_hash = None
stable = 0
loop until timeout:
    raw   = session.capture()
    norm  = normalize(raw)
    h     = sha1(norm)
    if h == prev_hash: stable += 1
    else:              stable = 0; prev_hash = h
    if stable >= settle_polls: return raw   # screen has settled
    sleep(poll)
```

Note the trap: while THINKING, the spinner animates every frame, so without `normalize()`
the hash never stabilises. Normalisation is what makes "thinking" register as
stable-content-plus-spinner rather than as motion.

**`prompt(text)`** algorithm:
1. capture full history (`history=True`), record its line count as a boundary marker.
2. `session.send_text(text)`.
3. `wait_for_settle`, then `classify`. If `AWAITING_PERMISSION`, surface that to the
   caller (do **not** auto-approve) and stop. If `IDLE`, continue.
4. capture full history again; the response is the new suffix beyond the boundary.
5. run a `clean_response()` pass to drop the echoed prompt and UI chrome.

### `server.py` — FastAPI

In-memory registry of named sessions. Endpoints:

```
POST   /sessions                 {name, cmd}      -> spawn
GET    /sessions/{name}/state                     -> current State
GET    /sessions/{name}/screen   ?history=bool    -> raw capture
POST   /sessions/{name}/prompt   {text}           -> {response, state}
POST   /sessions/{name}/key      {key}            -> ok
POST   /sessions/{name}/approve                   -> ok
POST   /sessions/{name}/interrupt                 -> ok
DELETE /sessions/{name}                           -> kill
```

This endpoint set is the "programmatic mode" we are reconstructing — the deliverable proof
that the TUI can be controlled over an API without touching headless mode.

### `cli.py` — two subcommands

- **`dump`** — spawn the target, let the user drive it live in another pane
  (`tmux attach -t {name}`), and on a keypress snapshot `capture-pane -p` into
  `fixtures/{label}.txt`. This is how you collect real BOOTING / IDLE / THINKING /
  STREAMING / PERMISSION screens to tune `patterns.yaml` and seed the tests. **Build this
  early** — everything downstream depends on having real fixtures.
- **`repl`** — a demo loop: read a line from the user, call `controller.prompt()`, print
  the extracted response. The end-to-end smoke test.

---

## Build order (incremental, each milestone independently testable)

- **M0** — scaffolding, `requirements.txt`, startup check that `tmux` is on PATH.
- **M1** — `TmuxSession.spawn/capture/kill`. Smoke test: spawn `claude`, print the screen,
  confirm you see the boot/idle UI.
- **M2** — `cli.py dump`. Capture real fixtures for every state into `fixtures/`. *(Gate:
  do not tune patterns before this exists.)*
- **M3** — `screen.normalize` + `classify`, with `tests/test_screen.py` asserting the
  correct `State` for each fixture. Runs offline, no live TUI.
- **M4** — `controller.wait_for_settle` + `prompt()` happy-path round trip via `repl`.
- **M5** — permission handling: detect `AWAITING_PERMISSION`, expose `approve`/`deny`.
- **M6** — `server.py` FastAPI layer over the controller.
- **M7** — hardening: per-call timeouts, `interrupt()`, multiple concurrent sessions,
  graceful handling of `ERROR`/`EXITED`.

---

## Testing

- **Unit (offline, required):** `test_screen.py` runs `normalize`/`classify` over the
  saved fixtures — no live Claude Code needed, so it's CI-safe and deterministic.
- **Integration (live, flagged):** an opt-in smoke test behind an env var that actually
  spawns the TUI and runs one `prompt()`. Skipped by default.

---

## Definition of done

- `repl` can send a prompt and print a clean response, end to end, with **zero** use of any
  forbidden flag/SDK (grep the codebase for `--print`, `-p`, `output-format`,
  `agent-sdk` — there must be no matches).
- The FastAPI server exposes the full endpoint set and a second process can drive a session
  purely over HTTP.
- `test_screen.py` passes against committed fixtures.
- README documents the **pattern-tuning step** and the known brittleness (patterns are
  version-specific; capture fresh fixtures if the TUI changes).

## Out of scope

- Persisting sessions across server restarts.
- Authentication on the HTTP API.
- Any TUI other than the one demoed (keep `patterns.yaml` the single point of adaptation).

---

## Notes for the implementer

- Lean on tmux as the terminal emulator; never parse raw escape codes.
- Keep `screen.py` pure — it's the only way this stays testable.
- The fragile part is `patterns.yaml`. When something misbehaves, the first move is to
  `dump` the live screen and compare against your regexes, not to add retries.