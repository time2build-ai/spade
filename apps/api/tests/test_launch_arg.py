from pathlib import Path
from tui_pilot.server import _launch_arg, _MAX_INLINE_PROMPT


def test_small_prompt_passes_inline(tmp_path):
    msg = "do the thing"
    assert _launch_arg(msg, str(tmp_path)) == msg
    assert not (tmp_path / "TASK.md").exists()


def test_large_prompt_is_written_to_file_with_a_pointer(tmp_path):
    # REGRESSION: a big first message (research synthesis with several large
    # findings) blew tmux's command-length limit ("command too long"). It must be
    # staged to TASK.md and the launch arg replaced with a short pointer.
    big = "X" * (_MAX_INLINE_PROMPT + 5000)
    arg = _launch_arg(big, str(tmp_path))
    assert "TASK.md" in arg and len(arg) < 200
    assert (tmp_path / "TASK.md").read_text() == big
