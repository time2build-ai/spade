from pathlib import Path
from tui_pilot.session import install_comms_skill


def test_install_copies_skill_into_cwd(tmp_path):
    install_comms_skill(tmp_path)
    skill = tmp_path / ".claude" / "skills" / "agent-comms" / "SKILL.md"
    assert skill.is_file()
    assert "ask_question" in skill.read_text()
