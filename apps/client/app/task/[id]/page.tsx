"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { PageHead, Priority, Chip } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { MetaRow } from "@/components/task/MetaRow";
import { Markdown } from "@/components/ask/Markdown";
import { api } from "@/lib/api";
import type { BrainNode } from "@/lib/types";

const PRIORITY_LABEL = ["critical", "high", "medium", "low"] as const;

/** Status → dot color, matching the backlog column colors. */
const STATUS_COLOR: Record<string, string> = {
  ready: "var(--text-4)",
  in_progress: "var(--blue)",
  review: "var(--accent)",
  shipped: "var(--green)",
  blocked: "var(--amber)",
};

const REL_LABEL: Record<string, string> = {
  blocks: "blocks",
  blocked_by: "blocked by",
  related: "related to",
  subtask: "subtask of",
};

/** A linked brain node → its record page. */
function nodeHref(n: BrainNode): string {
  return n.type === "decision" ? `/decisions#dec-${n.id}` : `/brain?node=${n.id}`;
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 28px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

/** A grouped section of linked records ("Architectural context", "Connected bugs"…). */
function LinkSection({
  title, count, items, tint, icon,
}: {
  title: string;
  count: string;
  items: { id: string; title: string; sub?: string | null; href: string }[];
  tint: { bg: string; fg: string };
  icon: string;
}) {
  if (!items.length) return null;
  return (
    <>
      <div className="section-h">{title}<span className="count">{count}</span></div>
      {items.map((it) => (
        <Link className="link-row" key={it.id} href={it.href} style={{ textDecoration: "none", color: "inherit" }} data-testid="td-link-row">
          <span className="lr-icon" style={{ background: tint.bg, color: tint.fg }}>
            <Icon name={icon as never} size={14} />
          </span>
          <div>
            <div className="lr-title">{it.title}</div>
            {it.sub ? <div className="lr-sub">{it.sub}</div> : null}
          </div>
        </Link>
      ))}
    </>
  );
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();

  const { data: task, error: taskError, isLoading: taskLoading } =
    useSWR(id ? ["task", id] : null, () => api.task(id));

  // Real linked records: resolve the task's brain-node ids against the project's
  // node list, pull the project's pipelines (filtered to this task), and the task
  // list (to label task→task links).
  const { data: nodesData } = useSWR(task ? ["brain", task.project_id] : null, () => api.brainNodes(task!.project_id));
  const { data: pipeData } = useSWR(task ? ["pipelines", task.project_id] : null, () => api.pipelines(task!.project_id));
  const { data: tasksData } = useSWR(task ? ["tasks", task.project_id] : null, () => api.tasks(task!.project_id));
  const { data: commentsData } = useSWR(task ? ["comments", task.id] : null, () => api.comments(task!.id));

  const router = useRouter();
  const [starting, setStarting] = React.useState(false);
  const [startErr, setStartErr] = React.useState<string | null>(null);

  // Has any pipeline ever run on this task? Drives Start vs Resume wording.
  const hasRun = !!task && (pipeData?.pipelines ?? []).some((pl) => pl.task_id === task.id);

  // Actually create + start a pipeline run (spawns the Developer agent), then go
  // watch it in the Orchestrator. If one already exists, just go watch it.
  const runPipeline = React.useCallback(async () => {
    if (!task || starting) return;
    setStartErr(null);
    if (hasRun) { router.push("/orchestrator"); return; }
    setStarting(true);
    try {
      const run = await api.createPipeline(task.project_id, task.id);
      await api.startPipeline(run.id);
      mutate(["pipelines", task.project_id]);
      mutate(["task", task.id]);
      router.push("/orchestrator");
    } catch (e) {
      setStartErr(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  }, [task, hasRun, starting, router]);

  const headerActions = task ? (
    <>
      <span className="chip" data-testid="task-status-chip">
        <span className="d" style={{ background: STATUS_COLOR[task.status] ?? "var(--text-4)" }} />
        {task.status}
      </span>
      <Link href="/brain" className="btn">
        <Icon name="graph" size={13} /> View in graph
      </Link>
      <button type="button" className="btn primary" data-testid="run-pipeline" onClick={runPipeline} disabled={starting}>
        <Icon name="play" size={13} /> {starting ? "Starting…" : hasRun ? "Resume pipeline" : "Start pipeline"}
      </button>
    </>
  ) : undefined;

  const header = (
    <PageHead actions={headerActions}>
      <div className="breadcrumb">
        <Link href="/backlog">Backlog</Link> / <b>{id ?? "…"}</b>
      </div>
    </PageHead>
  );

  let body: React.ReactNode;
  if (taskLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (taskError || !task) {
    body = (
      <StateMessage>
        <strong style={{ color: "var(--text-2)" }}>Task not found</strong>
        <div style={{ marginTop: 6 }}>
          We couldn’t load <span className="mono">{id}</span>. It may have been removed or the id is wrong.
        </div>
      </StateMessage>
    );
  } else {
    const p = Math.min(3, Math.max(0, Math.round(task.priority)));

    const byId = new Map((nodesData?.nodes ?? []).map((n) => [n.id, n] as const));
    const linked = task.nodes.map((nid) => byId.get(nid)).filter((n): n is BrainNode => !!n);
    const decisions = linked.filter((n) => n.type === "decision" || n.type === "convention");
    const bugs = linked.filter((n) => n.type === "bug");
    const features = linked.filter((n) => n.type === "feature");
    const metrics = linked.filter((n) => n.type === "metric");

    const taskTitle = new Map((tasksData?.tasks ?? []).map((t) => [t.id, t.title] as const));
    const links = task.links.map((l) => {
      const otherId = l.from_task === task.id ? l.to_task : l.from_task;
      const rel = l.from_task === task.id ? l.rel : (l.rel === "blocks" ? "blocked_by" : l.rel);
      return { id: l.id, otherId, rel, title: taskTitle.get(otherId) ?? otherId };
    });

    const pipelines = (pipeData?.pipelines ?? []).filter((pl) => pl.task_id === task.id);
    const hasLinks = decisions.length || bugs.length || features.length || metrics.length || links.length;

    body = (
      <div className="task-detail">
        <div className="td-main">
          {startErr && (
            <div data-testid="run-error" style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(238,136,136,.4)", background: "rgba(238,136,136,.06)", color: "var(--red)", fontSize: 12.5 }}>
              Couldn’t start the pipeline: {startErr}. Make sure this project has a connected, logged-in account in Agent pool.
            </div>
          )}
          <div className="td-meta-row">
            <Chip>
              <Priority level={task.priority} style={{ width: 6, height: 6 }} />
              P{p} {PRIORITY_LABEL[p]}
            </Chip>
            {task.feature ? <Chip type="feature">{task.feature}</Chip> : null}
            <span className="muted mono" style={{ fontSize: 11.5 }}>created {formatDate(task.created_at)}</span>
          </div>
          <h2 className="td-title">{task.title}</h2>

          {/* Description (real) */}
          {task.description ? (
            <div className="origin" style={{ marginTop: 14 }}>
              <h5>Description</h5>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-2)" }}>{task.description}</div>
            </div>
          ) : null}

          {/* Origin (real quote/source) */}
          {task.origin_quote ? (
            <div className="origin">
              <h5>Origin</h5>
              <blockquote>“{task.origin_quote}”</blockquote>
              {task.origin_source ? (
                <div className="src">
                  <Icon name="mic" size={13} />
                  <span>{task.origin_source}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Linked records (real brain nodes + task links) */}
          <LinkSection
            title="Architectural context" count={`${decisions.length} linked`}
            items={decisions.map((n) => ({ id: n.id, title: `${n.type === "convention" ? "Convention" : "Decision"} · ${n.label}`, sub: n.detail?.split("\n")[0] ?? null, href: nodeHref(n) }))}
            tint={{ bg: "rgba(230,184,106,.12)", fg: "var(--amber)" }} icon="doc"
          />
          <LinkSection
            title="Connected bugs" count={`${bugs.length} linked`}
            items={bugs.map((n) => ({ id: n.id, title: n.label, sub: n.detail?.split("\n")[0] ?? null, href: nodeHref(n) }))}
            tint={{ bg: "rgba(232,125,125,.12)", fg: "var(--red)" }} icon="flag"
          />
          <LinkSection
            title="Tracked metrics" count={`${metrics.length} linked`}
            items={metrics.map((n) => ({ id: n.id, title: n.label, sub: n.detail?.split("\n")[0] ?? null, href: nodeHref(n) }))}
            tint={{ bg: "rgba(122,162,247,.12)", fg: "var(--blue)" }} icon="graph"
          />
          <LinkSection
            title="Features" count={`${features.length} linked`}
            items={features.map((n) => ({ id: n.id, title: n.label, sub: n.detail?.split("\n")[0] ?? null, href: nodeHref(n) }))}
            tint={{ bg: "rgba(201,184,255,.12)", fg: "var(--accent)" }} icon="spark"
          />

          {/* Dependencies (real task→task links) */}
          {links.length ? (
            <>
              <div className="section-h">Dependencies<span className="count">{links.length} linked</span></div>
              {links.map((l) => (
                <Link className="link-row" key={l.id} href={`/task/${l.otherId}`} style={{ textDecoration: "none", color: "inherit" }} data-testid="td-link-row">
                  <span className="lr-icon" style={{ background: "rgba(230,155,182,.12)", color: "var(--pink)" }}>
                    <Icon name="link" size={14} />
                  </span>
                  <div>
                    <div className="lr-title">{l.otherId} · {l.title}</div>
                    <div className="lr-sub">{REL_LABEL[l.rel] ?? l.rel}</div>
                  </div>
                </Link>
              ))}
            </>
          ) : null}

          {!hasLinks ? (
            <>
              <div className="section-h">Linked records<span className="count">none yet</span></div>
              <div className="muted" style={{ fontSize: 12.5, padding: "2px 2px 8px" }}>
                No decisions, bugs, metrics or dependencies are grounded to this task yet. As you and the orchestrator work it, links show up here.
              </div>
            </>
          ) : null}

          {/* Pipeline history (real runs + each stage's finished report) */}
          {(() => {
            const activity = commentsData?.comments ?? [];
            if (!pipelines.length && !activity.length) {
              return (
                <>
                  <div className="section-h">Pipeline history</div>
                  <div className="muted" style={{ fontSize: 12.5, padding: "2px 2px" }}>
                    Not run yet. Use “Start pipeline” to put the developer → reviewer → integrator flow on it.
                  </div>
                </>
              );
            }
            return (
              <>
                <div className="section-h">Pipeline history{activity.length ? <span className="count">{activity.length} notes</span> : null}</div>
                {pipelines.length ? (
                  <div className="card" style={{ padding: "14px 16px", marginBottom: 10 }}>
                    <div className="timeline">
                      {pipelines.map((pl) => (
                        <div className={"tl-item" + (pl.status === "running" ? " now" : "")} key={pl.id}>
                          <div>{pl.status === "running" ? "Running" : pl.status} · {(pl.stages ?? []).map((st) => st.role).join(" → ") || "pipeline"}</div>
                          <div className="when mono">{typeof pl.progress === "number" ? `${pl.progress}%` : ""}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {activity.map((c) => (
                  <div className="td-act" key={c.id} data-testid="pipeline-note">
                    <div className="td-act-h">
                      <span className={"td-act-who" + (c.author === "system" ? " sys" : "")}>{c.author ?? "system"}</span>
                      <span className="td-act-when mono">{formatDate(c.created_at)}</span>
                    </div>
                    <div className="td-act-body"><Markdown>{c.body}</Markdown></div>
                  </div>
                ))}
              </>
            );
          })()}
        </div>

        <aside className="td-side">
          <h6>Properties</h6>
          <MetaRow label="Status">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[task.status] ?? "var(--text-4)" }} />
              {task.status}
            </span>
          </MetaRow>
          <MetaRow label="Priority">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Priority level={task.priority} />P{p} · {PRIORITY_LABEL[p]}
            </span>
          </MetaRow>
          <MetaRow label="Feature">
            {task.feature ? <span style={{ color: "var(--accent)" }}>{task.feature}</span> : <span className="muted">—</span>}
          </MetaRow>
          <MetaRow label="Created"><span className="mono">{formatDate(task.created_at)}</span></MetaRow>
          <MetaRow label="Task id"><span className="mono">{task.id}</span></MetaRow>

          <h6 style={{ marginTop: 22 }}>Linked records</h6>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            {linked.length} brain node{linked.length === 1 ? "" : "s"} · {links.length} task link{links.length === 1 ? "" : "s"}
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {header}
      {body}
    </div>
  );
}

/** Short date, falling back to the raw string if unparseable. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
