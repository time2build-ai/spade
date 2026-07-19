"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { PageHead, TogglePill } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { DEMO_SETTINGS_GROUPS } from "@/lib/demo";

const ENV_BRANCHES = [
  { env: "dev", key: "dev_branch", label: "Development", testid: "branch-dev", guesses: ["development", "develop", "main", "master"], placeholder: "development" },
  { env: "staging", key: "staging_branch", label: "Staging", testid: "branch-staging", guesses: ["staging", "stage", "release"], placeholder: "staging" },
  { env: "prod", key: "prod_branch", label: "Production", testid: "branch-prod", guesses: ["main", "master", "production", "prod"], placeholder: "main" },
] as const;

function guessBranch(branches: string[], prefs: readonly string[]): string {
  for (const p of prefs) if (branches.includes(p)) return p;
  return "";
}

export default function SettingsPage() {
  const { project } = useProject();
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const deleteProject = async () => {
    if (!project || deleting) return;
    setDeleting(true);
    try {
      await api.deleteProject(project.id);
      try { localStorage.removeItem("spade.projectId"); } catch { /* ignore */ }
      await mutate("projects");
      router.push("/");
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  // Toggle state (real autopilot wins; the rest are seeded defaults not yet
  // persisted server-side).
  const initial = React.useMemo(() => {
    const s: Record<string, boolean> = {};
    for (const g of DEMO_SETTINGS_GROUPS) {
      for (const r of g.rows) {
        s[r.key] = r.real === "autopilot" && project ? project.autopilot === 1 : r.on;
      }
    }
    return s;
  }, [project]);
  const [state, setState] = React.useState<Record<string, boolean>>(initial);
  React.useEffect(() => setState(initial), [initial]);

  const toggle = (key: string, real?: "autopilot") => {
    const next = !state[key];
    setState((p) => ({ ...p, [key]: next }));
    if (real === "autopilot" && project) {
      api.updateProject(project.id, { autopilot: next ? 1 : 0 })
        .then(() => mutate("projects"))
        .catch(() => setState((p) => ({ ...p, [key]: !next })));
    }
  };

  // Repository config (the ProjectGit entity).
  const gitKey = project ? (["project-git", project.id] as const) : null;
  const { data: gitData, mutate: mutateGit } = useSWR(gitKey, () => api.projectGit(project!.id));
  const [repo, setRepo] = React.useState({ repo_ssh_url: "", dev_branch: "", staging_branch: "", prod_branch: "" });
  const [savingRepo, setSavingRepo] = React.useState(false);
  const [repoSaved, setRepoSaved] = React.useState(false);
  const [repoErr, setRepoErr] = React.useState<string | null>(null);
  // Branch scan: null = not scanned (free-text fallback); [] or [...] = scanned.
  const [branches, setBranches] = React.useState<string[] | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [scanErr, setScanErr] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  // Scanned and the repo has no branches (a fresh/empty repo).
  const emptyRepo = branches !== null && branches.length === 0;

  React.useEffect(() => {
    if (gitData) {
      setRepo({
        repo_ssh_url: gitData.repo_ssh_url ?? "",
        dev_branch: gitData.dev_branch ?? "",
        staging_branch: gitData.staging_branch ?? "",
        prod_branch: gitData.prod_branch ?? "",
      });
    }
  }, [gitData]);

  const setRepoField = (k: keyof typeof repo, v: string) => {
    setRepo((p) => ({ ...p, [k]: v }));
    setRepoSaved(false);
    if (k === "repo_ssh_url") { setBranches(null); setScanErr(null); }
  };

  const scan = async () => {
    if (!project || scanning || !repo.repo_ssh_url.trim()) return;
    setScanning(true); setScanErr(null);
    try {
      const { branches: found } = await api.scanBranches(project.id, repo.repo_ssh_url.trim());
      setBranches(found);
      if (found.length === 0) {
        // Empty repo — offer sensible names for the user to create.
        setRepo((p) => ({
          ...p,
          dev_branch: p.dev_branch || "development",
          staging_branch: p.staging_branch || "staging",
          prod_branch: p.prod_branch || "main",
        }));
      } else {
        // Pre-fill any empty env branch with a sensible guess from the real list.
        setRepo((p) => ({
          ...p,
          dev_branch: p.dev_branch || guessBranch(found, ENV_BRANCHES[0].guesses),
          staging_branch: p.staging_branch || guessBranch(found, ENV_BRANCHES[1].guesses),
          prod_branch: p.prod_branch || guessBranch(found, ENV_BRANCHES[2].guesses),
        }));
      }
    } catch (e) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const createBranches = async () => {
    if (!project || creating) return;
    const names = [repo.dev_branch, repo.staging_branch, repo.prod_branch]
      .map((s) => s.trim()).filter(Boolean);
    if (!names.length) { setScanErr("Name at least one branch first."); return; }
    setCreating(true); setScanErr(null);
    try {
      const { branches: created } = await api.createBranches(project.id, repo.repo_ssh_url.trim(), names);
      setBranches(created); // now populated → dropdowns
    } catch (e) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const saveRepo = async () => {
    if (!project || savingRepo) return;
    setSavingRepo(true); setRepoErr(null);
    try {
      await api.updateProjectGit(project.id, repo);
      await mutateGit();
      setRepoSaved(true);
    } catch (e) {
      setRepoErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRepo(false);
    }
  };

  // Advanced groups (Automation minus Autopilot, which is promoted to essentials).
  const advancedGroups = DEMO_SETTINGS_GROUPS.map((g) => ({
    ...g,
    rows: g.rows.filter((r) => r.real !== "autopilot"),
  })).filter((g) => g.rows.length > 0);
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggleOpen = (t: string) =>
    setOpen((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const inputStyle: React.CSSProperties = {
    fontSize: 12.5, padding: "8px 10px", borderRadius: 8,
    border: "1px solid var(--line-strong)", background: "var(--bg-1)", color: "inherit", outline: "none",
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Settings" />
      <div className="set-wrap" data-testid="settings">
        <p className="set-intro">
          Tune how Spade runs <b>{project?.name ?? "this project"}</b>. The defaults are already sensible —
          the one thing you need to start shipping code is to <b>connect a repository</b> below. Everything
          else is optional and can wait.
        </p>

        {/* ---- GET STARTED — the two things that actually matter ---- */}
        <div className="set-sech">Get started</div>

        {project && (
          <section className="set-card essential" data-testid="repo-group">
            <div className="set-card-h"><Icon name="term" size={15} /> Repository</div>
            <div className="set-card-desc">
              Spade clones this repo into its own worktree for each task and opens a pull request against your
              branches — your working copy is never touched. Only <b>code</b> tasks need it; research and docs work without one.
            </div>

            <label className="set-fieldlabel">Repo SSH URL</label>
            <div className="set-scan-row">
              <input
                data-testid="repo-ssh-url"
                className="mono"
                value={repo.repo_ssh_url}
                onChange={(e) => setRepoField("repo_ssh_url", e.target.value)}
                placeholder="git@github.com:org/repo.git"
                style={{ ...inputStyle, flex: 1, minWidth: 0 }}
              />
              <button
                type="button" className="btn" data-testid="scan-branches"
                onClick={scan} disabled={scanning || !repo.repo_ssh_url.trim()}
              >
                {scanning ? "Scanning…" : "Scan branches"}
              </button>
            </div>
            {scanErr && <div className="set-scan-err">Couldn’t reach the repo — you can still type branch names below. ({scanErr})</div>}
            {branches && branches.length > 0 && (
              <div className="set-scan-ok">Found {branches.length} branch{branches.length === 1 ? "" : "es"} — pick which is which:</div>
            )}
            {emptyRepo && (
              <div className="set-scan-empty">This repo has no branches yet. Name your environments below and Spade will create them (it adds an initial commit).</div>
            )}

            <div className="set-branchgrid">
              {ENV_BRANCHES.map((b) => (
                <div className="set-branchcol" key={b.env}>
                  <label className="set-fieldlabel">{b.label} branch</label>
                  {branches && branches.length > 0 ? (
                    <select
                      data-testid={b.testid}
                      value={repo[b.key as keyof typeof repo]}
                      onChange={(e) => setRepoField(b.key as keyof typeof repo, e.target.value)}
                      style={{ ...inputStyle, width: "100%" }}
                    >
                      <option value="">— none —</option>
                      {branches.map((br) => <option key={br} value={br}>{br}</option>)}
                    </select>
                  ) : (
                    <input
                      data-testid={b.testid}
                      className="mono"
                      value={repo[b.key as keyof typeof repo]}
                      onChange={(e) => setRepoField(b.key as keyof typeof repo, e.target.value)}
                      placeholder={b.placeholder}
                      style={{ ...inputStyle, width: "100%" }}
                    />
                  )}
                </div>
              ))}
            </div>

            {repoErr && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 10 }}>{repoErr}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              {emptyRepo && (
                <button type="button" className="btn" data-testid="create-branches" onClick={createBranches} disabled={creating}>
                  {creating ? "Creating…" : "Create branches"}
                </button>
              )}
              <button type="button" className="btn primary" data-testid="save-repo" onClick={saveRepo} disabled={savingRepo}>
                {savingRepo ? "Saving…" : "Save repository"}
              </button>
              {repoSaved && <span style={{ fontSize: 12.5, color: "var(--green)" }}>Saved ✓</span>}
            </div>
          </section>
        )}

        {/* Autopilot — the one automation setting worth surfacing up front. */}
        <section className="set-card essential">
          <div className="set-row" data-testid="set-row">
            <div className="set-row-text">
              <div className="set-row-label">✨ Autopilot {state["autopilot"] && <span className="set-row-real mono">on</span>}</div>
              <div className="set-row-desc muted">
                When on, the orchestrator picks up ready tasks and ships them without asking. Leave it off while
                you’re getting comfortable — you can flip it on any time.
              </div>
            </div>
            <TogglePill on={!!state["autopilot"]} onChange={() => toggle("autopilot", "autopilot")} aria-label="Autopilot" />
          </div>
        </section>

        {/* ---- ADVANCED — collapsed; open only what you care about ---- */}
        <div className="set-sech">Advanced</div>
        <div className="set-groups">
          {advancedGroups.map((g) => {
            const isOpen = open.has(g.title);
            const onCount = g.rows.filter((r) => state[r.key]).length;
            return (
              <section className={"set-group collapsible" + (isOpen ? " open" : "")} key={g.title} data-testid="set-group">
                <div className="set-group-h" onClick={() => toggleOpen(g.title)}>
                  <span>{g.title}</span>
                  <span className="set-group-sum">· {onCount} on of {g.rows.length}</span>
                  <span className="set-group-chev"><Icon name="chev" size={13} /></span>
                </div>
                {isOpen && (
                  <div className="set-group-body">
                    {g.rows.map((r) => (
                      <div className="set-row" data-testid="set-row" key={r.key}>
                        <div className="set-row-text">
                          <div className="set-row-label">{r.label}</div>
                          <div className="set-row-desc muted">{r.desc}</div>
                        </div>
                        <TogglePill on={!!state[r.key]} onChange={() => toggle(r.key, r.real)} aria-label={r.label} />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Danger zone. */}
        {project && (
          <section className="set-danger" data-testid="set-danger">
            <div className="set-group-h" style={{ color: "var(--red)" }}>Danger zone</div>
            <div className="set-danger-row">
              <div className="set-row-text">
                <div className="set-row-label">Delete this project</div>
                <div className="set-row-desc muted">
                  Permanently removes <b style={{ color: "var(--text-2)" }}>{project.name}</b> and all its data —
                  backlog, brain, pipelines, sprints, meetings and feedback. This can’t be undone.
                </div>
              </div>
              {confirming ? (
                <div className="set-danger-confirm">
                  <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
                  <button type="button" className="btn danger" data-testid="confirm-delete" onClick={deleteProject} disabled={deleting}>
                    {deleting ? "Deleting…" : "Delete forever"}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn danger" data-testid="delete-project" onClick={() => setConfirming(true)}>
                  Delete project
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
