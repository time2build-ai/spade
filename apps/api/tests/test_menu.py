from tui_pilot.screen import parse_menu

CLARIFY = """\
□ Website stack
Where does your website live, and what is it built with?
❯ 1. Plain HTML/CSS/JS
    A static site — drop-in page
  2. React / Next.js
    A React or Next.js app
  3. Other framework
  4. No site yet
  5. Type something.
  6. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel
"""

PERMISSION = """\
 Bash command
   touch /tmp/x
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to tmp/ from this project
   3. No
 Esc to cancel · Tab to amend · ctrl+e to explain
"""

IDLE = """\
╭─ Claude Code ─╮
╰───────────────╯
❯
  ? for shortcuts
"""

NUMBERED_PROSE = """\
Here is the plan:
1. do this
2. do that
3. finish
"""

def test_clarify_menu():
    m = parse_menu(CLARIFY)
    assert m is not None
    assert m["selected"] == 1
    assert [o["index"] for o in m["options"]] == [1, 2, 3, 4, 5, 6]
    assert m["options"][0]["label"].startswith("Plain HTML")
    assert "Where does your website live" in m["prompt"]

def test_permission_menu():
    m = parse_menu(PERMISSION)
    assert m is not None
    assert m["selected"] == 1
    assert [o["label"] for o in m["options"]][0] == "Yes"
    assert "proceed" in m["prompt"].lower()

def test_idle_composer_is_not_a_menu():
    assert parse_menu(IDLE) is None        # lone ❯ prompt, no numbered options

def test_numbered_prose_is_not_a_menu():
    assert parse_menu(NUMBERED_PROSE) is None   # numbered list but NO ❯ cursor

def test_selected_reflects_cursor_position():
    s = CLARIFY.replace("❯ 1. Plain", "  1. Plain").replace("  2. React", "❯ 2. React")
    assert parse_menu(s)["selected"] == 2
