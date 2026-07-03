"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { PageHead, TogglePill } from "@/components/ui";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { DEMO_SETTINGS_GROUPS } from "@/lib/demo";

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

  // Initial state: real autopilot wins; the rest from the seeded defaults
  // (BACKEND: those non-column toggles aren't persisted yet).
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

  // Repository config — the separate ProjectGit entity (repo_ssh_url + the three
  // env branches). Load current values via SWR; persist via PUT.
  const gitKey = project ? (["project-git", project.id] as const) : null;
  const { data: gitData, mutate: mutateGit } = useSWR(gitKey, () => api.projectGit(project!.id));
  const [repo, setRepo] = React.useState({ repo_ssh_url: "", dev_branch: "", staging_branch: "", prod_branch: "" });
  const [savingRepo, setSavingRepo] = React.useState(false);
  const [repoSaved, setRepoSaved] = React.useState(false);
  const [repoErr, setRepoErr] = React.useState<string | null>(null);

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
  };

  const saveRepo = async () => {
    if (!project || savingRepo) return;
    setSavingRepo(true);
    setRepoErr(null);
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

  // Autopilot is a real project column → persist via PATCH (optimistic). Other
  // toggles stay local until their backend columns exist.
  const toggle = (key: string, real?: "autopilot") => {
    const next = !state[key];
    setState((p) => ({ ...p, [key]: next }));
    if (real === "autopilot" && project) {
      api.updateProject(project.id, { autopilot: next ? 1 : 0 })
        .then(() => mutate("projects"))
        .catch(() => setState((p) => ({ ...p, [key]: !next }))); // revert on failure
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Settings" />
      <div className="set-wrap" data-testid="settings">
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
          Automation for <b style={{ color: "var(--text-2)" }}>{project?.name ?? "this project"}</b>
          {project && (
            <span className="mono"> · strategy {project.account_strategy} · ceiling {project.model_ceiling ?? "—"}</span>
          )}
        </div>

        <div className="set-groups">
          {DEMO_SETTINGS_GROUPS.map((g) => (
            <section className="set-group" key={g.title} data-testid="set-group">
              <div className="set-group-h">{g.title}</div>
              {g.rows.map((r) => (
                <div className="set-row" data-testid="set-row" key={r.key}>
                  <div className="set-row-text">
                    <div className="set-row-label">
                      {r.label}
                      {r.real && <span className="set-row-real mono">live</span>}
                    </div>
                    <div className="set-row-desc muted">{r.desc}</div>
                  </div>
                  <TogglePill on={!!state[r.key]} onChange={() => toggle(r.key, r.real)} aria-label={r.label} />
                </div>
              ))}
            </section>
          ))}
        </div>

        {/* Repository — the per-project git config that the lifecycle engine
            clones and promotes across env branches (dev / staging / prod). */}
        {project && (
          <section className="set-group" data-testid="repo-group">
            <div className="set-group-h">Repository</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
              The lifecycle engine clones this repo into a worktree per task and opens PRs against these branches.
            </div>
            {[
              { k: "repo_ssh_url", label: "Repo SSH URL", testid: "repo-ssh-url", placeholder: "git@github.com:org/repo.git", mono: true },
              { k: "dev_branch", label: "Development branch", testid: "branch-dev", placeholder: "development", mono: true },
              { k: "staging_branch", label: "Staging branch", testid: "branch-staging", placeholder: "staging", mono: true },
              { k: "prod_branch", label: "Production branch", testid: "branch-prod", placeholder: "main", mono: true },
            ].map((f) => (
              <div className="set-row" data-testid="set-row" key={f.k}>
                <div className="set-row-text">
                  <div className="set-row-label">{f.label}</div>
                </div>
                <input
                  data-testid={f.testid}
                  className={f.mono ? "mono" : undefined}
                  value={repo[f.k as keyof typeof repo]}
                  onChange={(e) => setRepoField(f.k as keyof typeof repo, e.target.value)}
                  placeholder={f.placeholder}
                  style={{ minWidth: 260, fontSize: 12.5, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-2)", color: "inherit" }}
                />
              </div>
            ))}
            {repoErr && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 8 }}>{repoErr}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <button type="button" className="btn primary" data-testid="save-repo" onClick={saveRepo} disabled={savingRepo}>
                {savingRepo ? "Saving…" : "Save repository"}
              </button>
              {repoSaved && <span className="muted" style={{ fontSize: 12.5, color: "var(--green)" }}>Saved</span>}
            </div>
          </section>
        )}

        {/* Danger zone — delete the project and everything in it. */}
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
