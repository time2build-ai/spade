import pytest
from tui_pilot import gitops
from tui_pilot.gitops import GitError, list_remote_branches


class _FakeRunner:
    def __init__(self, cwd): self.cwd = cwd
    def run(self, *args):
        assert args[:2] == ("ls-remote", "--heads")
        return (
            "9f8a\trefs/heads/main\n"
            "aa11\trefs/heads/development\n"
            "bb22\trefs/heads/staging\n"
        )


class _FailRunner:
    def __init__(self, cwd): pass
    def run(self, *args): raise GitError("Repository not found")


def test_list_remote_branches_parses_heads():
    out = list_remote_branches("git@github.com:org/repo.git", runner_factory=_FakeRunner)
    assert out == ["development", "main", "staging"]  # sorted, deduped


def test_list_remote_branches_empty_url_raises():
    with pytest.raises(GitError):
        list_remote_branches("  ", runner_factory=_FakeRunner)


def test_list_remote_branches_propagates_git_error():
    with pytest.raises(GitError):
        list_remote_branches("git@github.com:bad/repo.git", runner_factory=_FailRunner)


class _RecRunner:
    """Records git command sequences; simulates an EMPTY repo (no HEAD)."""
    calls = []
    def __init__(self, cwd): self.cwd = cwd
    def run(self, *args):
        _RecRunner.calls.append(args)
        if args[:2] == ("rev-parse", "--abbrev-ref"): return "development\n"
        return ""
    def run_code(self, *args):
        _RecRunner.calls.append(args)
        if args[:1] == ("rev-parse",): return 1   # no HEAD → empty repo
        return 0


def test_create_remote_branches_seeds_and_pushes(tmp_path, monkeypatch):
    import tempfile
    from tui_pilot import gitops
    _RecRunner.calls = []
    # make the "repo" dir exist so the README write succeeds
    monkeypatch.setattr(tempfile, "mkdtemp", lambda **k: str(tmp_path))
    (tmp_path / "repo").mkdir()
    out = gitops.create_remote_branches(
        "git@github.com:me/fresh.git", ["development", "staging", "main"],
        runner_factory=_RecRunner)
    assert out == ["development", "staging", "main"]
    flat = [a for c in _RecRunner.calls for a in c]
    assert "clone" in flat and "commit" in flat        # cloned + seeded a commit
    pushed = {c[-1] for c in _RecRunner.calls if c and c[0] == "push"}
    assert {"development", "staging", "main"} <= pushed  # pushed all three


def test_create_remote_branches_dedups_and_validates():
    from tui_pilot.gitops import create_remote_branches, GitError
    with pytest.raises(GitError):
        create_remote_branches("git@x:y.git", [], runner_factory=_RecRunner)
    with pytest.raises(GitError):
        create_remote_branches("  ", ["main"], runner_factory=_RecRunner)
