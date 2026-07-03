from tui_pilot import project_git, projects


def _proj():
    projects.create(id="acme", name="Acme", path="/w")


def test_get_returns_none_before_set():
    _proj()
    assert project_git.get("acme") is None


def test_upsert_creates_then_updates_with_branch_defaults():
    _proj()
    row = project_git.upsert("acme", repo_ssh_url="git@github.com:acme/app.git")
    assert row["repo_ssh_url"] == "git@github.com:acme/app.git"
    assert row["dev_branch"] == "development"
    assert row["staging_branch"] == "staging"
    assert row["prod_branch"] == "main"
    # second upsert updates in place (still one row)
    row2 = project_git.upsert("acme", staging_branch="stage")
    assert row2["staging_branch"] == "stage"
    assert row2["repo_ssh_url"] == "git@github.com:acme/app.git"  # preserved


def test_worktrees_root_defaults_under_home_when_unset():
    _proj()
    row = project_git.upsert("acme", repo_ssh_url="git@github.com:acme/app.git")
    assert row["worktrees_root"] and "acme" in row["worktrees_root"]
