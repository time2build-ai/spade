from unittest.mock import MagicMock, patch
from tui_pilot.session import TmuxSession, build_cmd


def _make_session(**kwargs) -> TmuxSession:
    """Create a TmuxSession with tmux path stubbed so no binary required."""
    with patch("tui_pilot.session._ensure_tmux_on_path", return_value="/usr/bin/tmux"):
        return TmuxSession("test-session", "claude", **kwargs)


def test_spawn_injects_env_flags():
    """When env={'CLAUDE_CONFIG_DIR': '/cfg'}, spawn must pass -e CLAUDE_CONFIG_DIR=/cfg."""
    session = _make_session(env={"CLAUDE_CONFIG_DIR": "/cfg"})
    captured_args = []

    def fake_run(self, *args, **kwargs):
        captured_args.extend(args)
        return MagicMock(returncode=0)

    with patch.object(TmuxSession, "_run", fake_run), \
         patch.object(TmuxSession, "is_alive", return_value=False):
        session.spawn()

    assert "-e" in captured_args
    assert "CLAUDE_CONFIG_DIR=/cfg" in captured_args


def test_spawn_no_env_no_e_flag():
    """A session with no env must spawn without any -e flag."""
    session = _make_session()
    captured_args = []

    def fake_run(self, *args, **kwargs):
        captured_args.extend(args)
        return MagicMock(returncode=0)

    with patch.object(TmuxSession, "_run", fake_run), \
         patch.object(TmuxSession, "is_alive", return_value=False):
        session.spawn()

    assert "-e" not in captured_args


def test_build_cmd_plain():
    assert build_cmd("claude", None) == "claude"


def test_build_cmd_with_model():
    assert build_cmd("claude", "claude-sonnet-4-6") == "claude --model claude-sonnet-4-6"


def test_build_cmd_preserves_existing_flags():
    assert build_cmd("claude --dangerously-skip-permissions", "claude-opus-4-8") \
        == "claude --dangerously-skip-permissions --model claude-opus-4-8"


def test_build_cmd_no_double_model():
    assert build_cmd("claude --model x", "claude-haiku-4-5") == "claude --model x"
