"""TmuxSession: thin mechanical wrapper over the tmux CLI.

This module contains *mechanics only* — no synchronization logic, no screen
interpretation. Every method shells out to ``tmux`` via :mod:`subprocess`.

Design notes
------------
* The pane size is fixed at spawn (``-x``/``-y``) so line wrapping is
  deterministic across captures. We never inherit a variable terminal width.
* Every method tolerates the session not existing and raises a typed
  :class:`SessionError` instead of leaking a raw ``CalledProcessError``.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


class SessionError(RuntimeError):
    """Raised when a tmux operation fails or the target session is missing."""


def _ensure_tmux_on_path() -> str:
    """Return the path to the tmux binary or raise loudly if it is missing."""
    tmux = shutil.which("tmux")
    if tmux is None:
        raise SessionError(
            "tmux is not installed or not on PATH. Install it (e.g. "
            "`brew install tmux` / `apt-get install tmux`) and retry."
        )
    return tmux


class TmuxSession:
    """A single detached tmux session running one command.

    Parameters
    ----------
    name:
        tmux session name (must be unique within the tmux server).
    cmd:
        The command line to run inside the session, e.g. ``"claude"``.
    cols, rows:
        Fixed pane geometry. Locked at spawn for deterministic wrapping.
    """

    def __init__(
        self,
        name: str,
        cmd: str,
        cols: int = 200,
        rows: int = 50,
        cwd: str | None = None,
    ) -> None:
        self.name = name
        self.cmd = cmd
        self.cols = cols
        self.rows = rows
        self.cwd = cwd
        self._tmux = _ensure_tmux_on_path()

    # -- internal helpers --------------------------------------------------

    def _run(self, *args: str, check: bool = True) -> subprocess.CompletedProcess:
        """Run ``tmux <args>`` and return the completed process.

        Raises :class:`SessionError` on a non-zero exit when ``check`` is set.
        """
        try:
            return subprocess.run(
                [self._tmux, *args],
                capture_output=True,
                text=True,
                check=check,
            )
        except subprocess.CalledProcessError as exc:
            raise SessionError(
                f"tmux {' '.join(args)} failed (rc={exc.returncode}): "
                f"{exc.stderr.strip() or exc.stdout.strip()}"
            ) from exc
        except FileNotFoundError as exc:  # pragma: no cover - guarded by ctor
            raise SessionError("tmux binary disappeared from PATH") from exc

    def _require_alive(self) -> None:
        if not self.is_alive():
            raise SessionError(f"session {self.name!r} does not exist")

    # -- lifecycle ---------------------------------------------------------

    def spawn(self) -> None:
        """Create the detached session with a fixed pane size.

        Equivalent to::

            tmux new-session -d -s {name} -x {cols} -y {rows} {cmd}
        """
        if self.is_alive():
            raise SessionError(f"session {self.name!r} already exists")
        args = [
            "new-session",
            "-d",
            "-s",
            self.name,
            "-x",
            str(self.cols),
            "-y",
            str(self.rows),
        ]
        # Pin the working directory so a "developer" agent runs in the project
        # it is meant to work on (tmux new-session -c <dir>).
        if self.cwd:
            args += ["-c", self.cwd]
        args.append(self.cmd)
        self._run(*args)

    def is_alive(self) -> bool:
        """Return True if the tmux session currently exists."""
        proc = self._run("has-session", "-t", self.name, check=False)
        return proc.returncode == 0

    def kill(self) -> None:
        """Kill the session. Tolerates an already-dead session."""
        if self.is_alive():
            self._run("kill-session", "-t", self.name)

    # -- input -------------------------------------------------------------

    def send_text(self, text: str) -> None:
        """Type ``text`` literally, then press Enter as a separate keystroke.

        The literal flag (``-l``) prevents tmux from interpreting the body as
        key names (so a prompt containing the word "Enter" types the word, it
        does not press the key). Enter is sent as a distinct event afterwards.
        """
        self._require_alive()
        # send-keys with -l requires the literal text passed as the final arg.
        # Use "--" so a body starting with "-" is not parsed as a flag.
        self._run("send-keys", "-t", self.name, "-l", "--", text)
        self._run("send-keys", "-t", self.name, "Enter")

    def send_key(self, key: str) -> None:
        """Send a single tmux key name, e.g. ``Down``, ``Enter``, ``C-c``."""
        self._require_alive()
        self._run("send-keys", "-t", self.name, key)

    def interrupt(self) -> None:
        """Interrupt the running task: send Escape (Claude's interrupt key).

        Escape is the documented interrupt in the Claude Code REPL; we do not
        send C-c here because that tends to quit the whole program. Callers who
        want a hard stop can ``send_key("C-c")`` explicitly.
        """
        self._require_alive()
        self._run("send-keys", "-t", self.name, "Escape")

    # -- output ------------------------------------------------------------

    def capture(self, history: bool = False) -> str:
        """Return the rendered pane as plain text.

        tmux is itself a terminal emulator, so escape sequences and cursor
        moves are already resolved into a 2D character grid — we get the
        de-ANSI'd screen for free.

        Parameters
        ----------
        history:
            When True, include the full scrollback (``-S -``), not just the
            visible viewport.
        """
        self._require_alive()
        args = ["capture-pane", "-p", "-t", self.name]
        if history:
            args += ["-S", "-"]
        proc = self._run(*args)
        return proc.stdout


_ASSETS = Path(__file__).resolve().parent / "assets"


def install_comms_skill(
    cwd: str | Path,
    outbox_path: str | None = None,
    agent_id: str | None = None,
) -> None:
    """Install the agent-comms skill into <cwd>/.claude/skills/ so the spawned
    agent reads it on boot.

    The skill template carries ``__OUTBOX__`` / ``__AGENT_ID__`` placeholders;
    we render the agent's *actual* absolute outbox path and id into the copy
    that lands in its cwd. This is what makes signalling reliable: the agent
    loads this skill at the moment it wants to signal, so the exact path is
    right in front of it (rather than something it has to remember from an
    earlier priming turn). Idempotent.
    """
    _render_skill("agent-comms-skill", "agent-comms", cwd, outbox_path, agent_id)


def install_orchestrator_skill(
    cwd: str | Path,
    outbox_path: str | None = None,
    agent_id: str | None = None,
) -> None:
    """Install the orchestrator-comms skill (spawn/answer/kill/status actions)
    into an orchestrator's <cwd>/.claude/skills/. Same render-the-outbox-path
    trick as install_comms_skill, so the orchestrator has the exact JSON shapes
    + its outbox path in front of it when it issues commands. Idempotent."""
    _render_skill("orchestrator-comms", "orchestrator-comms", cwd, outbox_path, agent_id)


def _render_skill(
    asset_dir: str, skill_name: str, cwd: str | Path,
    outbox_path: str | None, agent_id: str | None,
) -> None:
    dst = Path(cwd) / ".claude" / "skills" / skill_name
    dst.mkdir(parents=True, exist_ok=True)
    template = (_ASSETS / asset_dir / "SKILL.md").read_text()
    rendered = template.replace(
        "__OUTBOX__", outbox_path or "(no control center attached)"
    ).replace("__AGENT_ID__", agent_id or "(none)")
    (dst / "SKILL.md").write_text(rendered)


def build_cmd(cmd: str, model_id: str | None) -> str:
    """Append `--model <id>` to a launch command when a model is requested.

    `--model` is an interactive-compatible flag (the REPL still runs normally),
    so it does not violate the no-headless constraint. Idempotent: skips if the
    command already names a model."""
    if not model_id or "--model" in cmd:
        return cmd
    return f"{cmd} --model {model_id}"
