"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";

const STATUS = [
  { k: "ready", color: "var(--text-3)", label: "ready" },
  { k: "in_progress", color: "var(--blue)", label: "in progress" },
  { k: "review", color: "var(--accent)", label: "review" },
  { k: "shipped", color: "var(--green)", label: "shipped" },
  { k: "blocked", color: "var(--red)", label: "blocked" },
] as const;

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="ov-empty muted" style={{ fontSize: 12.5, padding: "8px 0", color: "var(--text-4)" }}>{children}</div>;
}

export default function OverviewPage() {
  const { project } = useProject();
  const pid = project?.id ?? null;
  const key = (k: string) => (pid ? [k, pid] : null);

  const { data: tasksD } = useSWR(key("tasks"), () => api.tasks(pid!));
  const { data: brainD } = useSWR(key("brain"), () => api.brainNodes(pid!));
  const { data: edgesD } = useSWR(key("brain-edges"), () => api.brainEdges(pid!));
  const { data: pipesD } = useSWR(key("pipelines"), () => api.pipelines(pid!));
  const { data: sprintsD } = useSWR(key("sprints"), () => api.sprints(pid!));
  const { data: brakesD } = useSWR("brakes", () => api.brakes());
  const { data: fbD } = useSWR(key("feedback"), () => api.feedbackClusters(pid!));

  const tasks = tasksD?.tasks ?? [];
  const nodes = brainD?.nodes ?? [];
  const byStatus = (s: string) => tasks.filter((t) => t.status === s).length;
  const shipped = byStatus("shipped");
  const total = tasks.length;
  const progress = total ? Math.round((shipped / total) * 100) : 0;

  const nodesByType = (t: string) => nodes.filter((n) => n.type === t);
  const decisions = nodesByType("decision");
  const bugs = nodesByType("bug");
  const metrics = nodesByType("metric");

  const sprint = sprintsD?.sprints.find((s) => s.state === "active") ?? sprintsD?.sprints[0] ?? null;
  const taskTitle = (id: string) => tasks.find((t) => t.id === id)?.title ?? id;
  const running = (pipesD?.pipelines ?? [])
    .filter((p) => p.status === "running")
    .map((p) => ({ id: p.id, task: taskTitle(p.task_id), role: p.stages.find((s) => s.state === "running")?.role ?? "—" }));
  const brakes = brakesD?.brakes ?? [];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Overview" />
      <div className="ov-wrap">
        {/* Hero — real task progress (no fabricated headline metric) */}
        <section className="ov-hero" data-testid="ov-hero">
          <div className="ov-hero-l">
            <div className="muted mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase" }}>
              {project?.name ?? "Project"}{sprint ? ` · sprint ${sprint.number}${sprint.day_label ? ` · ${sprint.day_label}` : ""}` : ""}
            </div>
            {project?.path && (
              <div className="muted mono" data-testid="ov-path" title={project.path}
                style={{ fontSize: 11.5, marginTop: 4, display: "flex", alignItems: "center", gap: 5, wordBreak: "break-all" }}>
                <Icon name="term" size={11} /> {project.path}
              </div>
            )}
            {total > 0 ? (
              <>
                <div className="ov-hero-metric">
                  <span className="ov-hero-val">{progress}%</span>
                  <span className="muted" style={{ fontSize: 13 }}>{shipped} of {total} tasks shipped</span>
                </div>
                <div className="src-bar" data-testid="ov-statusbar" style={{ maxWidth: 520 }}>
                  {STATUS.map((s) => {
                    const n = byStatus(s.k);
                    return n > 0 ? <span key={s.k} style={{ background: s.color, flex: n }} title={`${n} ${s.label}`} /> : null;
                  })}
                </div>
              </>
            ) : (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 17, color: "var(--text)" }}>Nothing planned yet.</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  Press <span className="mono">⌘K</span> and tell Spade what you’re building — it’ll draft the brain and backlog.
                </div>
              </div>
            )}
          </div>
        </section>

        {/* KPI band — all real */}
        <div className="ov-kpis" data-testid="ov-kpis">
          <Link href="/backlog" className="ov-kpi">
            <div className="lbl">Backlog</div>
            <div className="val">{total}</div>
            <div className="sub muted">{byStatus("in_progress")} in progress</div>
          </Link>
          <div className="ov-kpi">
            <div className="lbl">Shipped</div>
            <div className="val" style={{ color: shipped ? "var(--green)" : undefined }}>{shipped}</div>
            <div className="sub muted">of {total}</div>
          </div>
          <Link href="/gate" className="ov-kpi">
            <div className="lbl">Gates</div>
            <div className="val" style={{ color: brakes.length ? "var(--amber)" : undefined }}>{brakes.length}</div>
            <div className="sub muted">{brakes[0]?.mission ?? "none pending"}</div>
          </Link>
          <Link href="/brain" className="ov-kpi">
            <div className="lbl">Brain nodes</div>
            <div className="val">{nodes.length}</div>
            <div className="sub muted">{edgesD?.edges.length ?? 0} edges</div>
          </Link>
        </div>

        {/* Now executing */}
        <div className="ov-mid">
          <div className="ov-now" data-testid="ov-now" style={{ gridColumn: "1 / -1" }}>
            <div className="ov-card-h">Now executing</div>
            {running.length ? (
              running.map((n) => (
                <div className="ov-now-row" key={n.id}>
                  <span className="mono">{n.task}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{n.role}</span>
                  <span className="mono" style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11 }}>running</span>
                </div>
              ))
            ) : (
              <Empty>Nothing running. Ask Spade to start a task.</Empty>
            )}
          </div>
        </div>

        {/* Real summaries — honest empty states */}
        <div className="ov-grid" data-testid="ov-grid">
          <div className="ov-card" data-testid="ov-card">
            <div className="ov-card-h">Recent decisions</div>
            {decisions.length ? decisions.slice(0, 4).map((d) => (
              <div className="ov-card-item" key={d.id}>{d.label}</div>
            )) : <Empty>No decisions yet.</Empty>}
          </div>
          <div className="ov-card" data-testid="ov-card">
            <div className="ov-card-h">Top feedback</div>
            {(fbD?.clusters.length ?? 0) ? fbD!.clusters.slice(0, 4).map((c) => (
              <div className="ov-card-item" key={c.id}>{c.label} · {c.count}</div>
            )) : <Empty>No feedback yet.</Empty>}
          </div>
          <div className="ov-card" data-testid="ov-card">
            <div className="ov-card-h">Open bugs</div>
            {bugs.length ? bugs.slice(0, 4).map((b) => (
              <div className="ov-card-item" key={b.id}>{b.label}</div>
            )) : <Empty>No bugs logged.</Empty>}
          </div>
          <div className="ov-card" data-testid="ov-card">
            <div className="ov-card-h">Tracked metrics</div>
            {metrics.length ? metrics.slice(0, 4).map((m) => (
              <div className="ov-card-item" key={m.id}>{m.label}</div>
            )) : <Empty>No metrics tracked.</Empty>}
          </div>
        </div>
      </div>
    </div>
  );
}
