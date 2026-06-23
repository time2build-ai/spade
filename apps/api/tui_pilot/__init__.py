"""tui-pilot: programmatic control of an interactive terminal TUI via tmux.

The only sanctioned interface to the target program is the terminal itself:
keystrokes in via ``tmux send-keys``, rendered screen out via ``tmux capture-pane``.
No headless flags, no SDK, no direct API calls.
"""

from .screen import State, normalize, classify
from .session import TmuxSession, SessionError
from .controller import Controller

__all__ = [
    "State",
    "normalize",
    "classify",
    "TmuxSession",
    "SessionError",
    "Controller",
]

__version__ = "0.1.0"
