from tui_pilot.session import build_cmd


def test_build_cmd_plain():
    assert build_cmd("claude", None) == "claude"


def test_build_cmd_with_model():
    assert build_cmd("claude", "claude-sonnet-4-6") == "claude --model claude-sonnet-4-6"


def test_build_cmd_preserves_existing_flags():
    assert build_cmd("claude --dangerously-skip-permissions", "claude-opus-4-8") \
        == "claude --dangerously-skip-permissions --model claude-opus-4-8"


def test_build_cmd_no_double_model():
    assert build_cmd("claude --model x", "claude-haiku-4-5") == "claude --model x"
