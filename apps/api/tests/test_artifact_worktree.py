from tui_pilot.spade_server import _read_worktree_file


def test_reads_committed_or_uncommitted_worktree_file(tmp_path):
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "review.md").write_text("# Review\nlooks good")
    assert _read_worktree_file(str(tmp_path), "docs/review.md") == "# Review\nlooks good"


def test_missing_file_returns_none(tmp_path):
    assert _read_worktree_file(str(tmp_path), "docs/nope.md") is None


def test_path_traversal_is_blocked(tmp_path):
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("top secret")
    # a repo_path escaping the worktree must NOT be read
    assert _read_worktree_file(str(tmp_path), "../secret.txt") is None


def test_none_inputs_return_none(tmp_path):
    assert _read_worktree_file(None, "x") is None
    assert _read_worktree_file(str(tmp_path), None) is None
