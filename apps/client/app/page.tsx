"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import { projectColor, projectGlyph, projectSlug } from "@/lib/adapters";
import type { Brake, PipelineRun, Project, Session, Task } from "@/lib/types";

type SortKey = "name" | "backlog" | "brain" | "workers";

const KIND_COLOR: Record<string, string> = {
  gate: "var(--amber)", pipeline: "var(--blue)", task: "var(--teal)",
};

type TriageItem = { key: string; kind: string; title: string; project: string; meta: string };

/**
 * Home — full-bleed cross-project triage dashboard. Sidebar is hidden
 * (home-mode). Everything is REAL: the triage feed is built from real signals
 * (human gates, running pipelines, recent tasks), KPIs and the projects table
 * are derived from the API. Honest empty states when there's no data.
 */
export default function Home() {
  const { data } = useSWR("projects", () => api.projects());
  const projects: Project[] = React.useMemo(() => data?.projects ?? [], [data]);

  // Global signals.
  const { data: brakesD } = useSWR("brakes", () => api.brakes());
  const { data: sessionsD } = useSWR("sessions", () => api.sessions());
  const brakes: Brake[] = brakesD?.brakes ?? [];
  const sessions: Session[] = sessionsD?.sessions ?? [];

  return (
    <Dashboard projects={projects} brakes={brakes} sessions={sessions} />
  );
}

function Dashboard({ projects, brakes, sessions }: { projects: Project[]; brakes: Brake[]; sessions: Session[] }) {
  const [sort, setSort] = React.useState<SortKey>("backlog");

  // Per-project real data (tasks / brain nodes / pipelines). One SWR key per
  // project; falls back to empty until loaded.
  const perProject = useProjectStats(projects);

  const rows = projects
    .map((p) => ({ p, m: perProject[p.id] ?? { backlog: 0, brain: 0, workers: 0, running: [] as PipelineRun[], tasks: [] as Task[] } }))
    .sort((a, b) =>
      sort === "name" ? a.p.name.localeCompare(b.p.name) : (b.m[sort] as number) - (a.m[sort] as number),
    );

  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? id ?? "—";

  // Triage feed from real signals: gates needing a human, running pipelines,
  // recent ready/blocked tasks.
  const triage: TriageItem[] = [];
  for (const b of brakes) {
    triage.push({ key: `gate-${b.id}`, kind: "gate", title: b.mission, project: projName(null), meta: b.brake });
  }
  for (const { p, m } of rows) {
    for (const r of m.running) {
      const t = m.tasks.find((tk) => tk.id === r.task_id);
      triage.push({ key: `pipe-${r.id}`, kind: "pipeline", title: t?.title ?? r.task_id, project: p.name, meta: "running" });
    }
    for (const t of m.tasks.filter((tk) => tk.status === "blocked").slice(0, 3)) {
      triage.push({ key: `task-${t.id}`, kind: "task", title: t.title, project: p.name, meta: "blocked" });
    }
  }

  const totalBacklog = rows.reduce((n, r) => n + r.m.backlog, 0);
  const totalBrain = rows.reduce((n, r) => n + r.m.brain, 0);
  const liveAgents = sessions.filter((s) => s.alive).length;

  const kpis = [
    { lbl: "Open triage", val: String(triage.length), sub: `across ${projects.length} project${projects.length === 1 ? "" : "s"}` },
    { lbl: "Gates pending", val: String(brakes.length), sub: "need a human", color: brakes.length ? "var(--amber)" : undefined },
    { lbl: "Backlog", val: String(totalBacklog), sub: "all projects" },
    { lbl: "Brain nodes", val: String(totalBrain), sub: "all projects" },
    { lbl: "Live agents", val: String(liveAgents), sub: `${sessions.length} session${sessions.length === 1 ? "" : "s"}` },
  ];

  return (
    <div data-testid="home-root" className="home">
      <div className="home-head">
        <h1>Home</h1>
        <div className="muted" style={{ fontSize: 13 }}>Cross-project triage · {projects.length} project{projects.length === 1 ? "" : "s"}</div>
      </div>

      {/* KPI band */}
      <div className="home-kpis" data-testid="home-kpis">
        {kpis.map((k) => (
          <div className="home-kpi" key={k.lbl}>
            <div className="lbl">{k.lbl}</div>
            <div className="val" style={k.color ? { color: k.color } : undefined}>{k.val}</div>
            <div className="sub muted">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="home-grid">
        {/* Triage feed */}
        <section className="home-triage" data-testid="triage-feed">
          <div className="home-sec-h">Triage feed<span className="count mono">{triage.length}</span></div>
          {triage.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, padding: "16px 0", color: "var(--text-4)" }}>
              Nothing in the triage feed yet.
            </div>
          ) : (
            triage.map((t) => (
              <div className="tri-item" data-testid="tri-item" key={t.key}>
                <span className="tri-dot" style={{ background: KIND_COLOR[t.kind] ?? "var(--text-3)" }} />
                <div className="tri-body">
                  <div className="tri-title">{t.title}</div>
                  <div className="tri-meta muted">{t.project} · {t.meta}</div>
                </div>
                <span className="tri-kind mono">{t.kind}</span>
              </div>
            ))
          )}
        </section>

        {/* Projects health table */}
        <aside className="home-projects">
          <div className="home-sec-h">Projects</div>
          <div className="proj-table" data-testid="projects-table">
            <div className="th">Project</div>
            <button className="th sortable" onClick={() => setSort("backlog")}>Backlog</button>
            <button className="th sortable" onClick={() => setSort("brain")}>Brain</button>
            <button className="th sortable" onClick={() => setSort("workers")}>Agents</button>
            {rows.length === 0 ? (
              <div className="muted" style={{ gridColumn: "1 / -1", fontSize: 12.5, padding: "16px 0", color: "var(--text-4)" }}>
                No projects yet.
              </div>
            ) : (
              rows.map(({ p, m }) => (
                <Link className="proj-row" href="/overview" key={p.id} data-testid="proj-row">
                  <div className="td">
                    <span className="proj-glyph" style={{ background: projectColor(p) + "18", color: projectColor(p), width: 20, height: 20, fontSize: 10 }}>
                      {projectGlyph(p)}
                    </span>
                    <span>
                      <div className="proj-name">{p.name}</div>
                      <div className="proj-slug mono muted">{projectSlug(p)}</div>
                    </span>
                  </div>
                  <div className="td mono">{m.backlog}</div>
                  <div className="td mono">{m.brain}</div>
                  <div className="td mono">{m.workers}</div>
                </Link>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

type ProjectStats = { backlog: number; brain: number; workers: number; running: PipelineRun[]; tasks: Task[] };

/** Fetch real per-project stats (tasks / brain nodes / pipelines) for the table
 *  and the triage feed. Returns a map keyed by project id. */
function useProjectStats(projects: Project[]): Record<string, ProjectStats> {
  // SWR keys are stable per project list; the inner fetcher batches the three
  // endpoints. Empty result until loaded.
  const ids = projects.map((p) => p.id).join(",");
  const { data } = useSWR(ids ? ["home-project-stats", ids] : null, async () => {
    const entries = await Promise.all(
      projects.map(async (p) => {
        const [tasksD, nodesD, pipesD] = await Promise.all([
          api.tasks(p.id),
          api.brainNodes(p.id),
          api.pipelines(p.id),
        ]);
        const tasks = tasksD.tasks;
        const running = pipesD.pipelines.filter((r) => r.status === "running");
        const stats: ProjectStats = {
          backlog: tasks.filter((t) => t.status !== "shipped").length,
          brain: nodesD.nodes.length,
          workers: running.length,
          running,
          tasks,
        };
        return [p.id, stats] as const;
      }),
    );
    return Object.fromEntries(entries);
  });
  return data ?? {};
}
