import * as React from "react";
import Link from "next/link";
import { Priority } from "@/components/ui";
import { groupNodesByType, type TaskExecState } from "@/lib/adapters";
import type { BrainNode, LifecycleRun, Task } from "@/lib/types";

export interface TaskCardProps {
  task: Task;
  /** Project brain nodes keyed by id, for resolving task.nodes ids. */
  nodesById: Record<string, BrainNode>;
  /** Dependency-derived readiness (startable / blocked / epic). */
  exec?: TaskExecState;
  /** The task has a `waiting` lifecycle gate → amber "waiting on you" + Review link. */
  gated?: boolean;
  /** The task's active lifecycle run → env badges on shipped cards. */
  run?: LifecycleRun;
}

/**
 * Backlog card (reference TaskCard). Intel bar + chips summarise the task's
 * linked intelligence — feedback/bug/decision/metric counts come from the REAL
 * linked brain nodes; the "building" pill reflects the real task status.
 */
export function TaskCard({ task, nodesById, exec, gated, run }: TaskCardProps) {
  const resolved: BrainNode[] = [];
  for (const id of task.nodes) {
    const node = nodesById[id];
    if (node) resolved.push(node);
  }
  const g = groupNodesByType(resolved);

  const links = {
    feedback: g.feedback.length,
    bugs: g.bug.length,
    decisions: g.decision.length,
    metrics: g.metric.length,
  };
  const segs: { k: string; color: string; n: number }[] = [
    { k: "feedback", color: "var(--blue)", n: links.feedback },
    { k: "bug", color: "var(--red)", n: links.bugs },
    { k: "decision", color: "var(--amber)", n: links.decisions },
    { k: "metric", color: "var(--teal)", n: links.metrics },
  ];
  const total = segs.reduce((acc, s) => acc + s.n, 0);
  const building = task.status === "building";

  // Env badges on shipped cards — the furthest deployment env the run reached.
  const envs: { key: "dev" | "staging" | "prod"; label: string; at: string | null | undefined }[] = [
    { key: "dev", label: "dev", at: run?.env_dev_at },
    { key: "staging", label: "staging", at: run?.env_staging_at },
    { key: "prod", label: "prod", at: run?.env_prod_at },
  ];
  const reachedEnvs = envs.filter((e) => e.at);

  return (
    <Link
      href={`/task/${task.id}`}
      className="task-card"
      data-testid="task-card"
      style={{ display: "block", textDecoration: "none", color: "inherit" }}
    >
      <div className="tc-head">
        <Priority level={task.priority} />
        <span>{task.id}</span>
        {task.feature ? <span style={{ marginLeft: "auto" }}>{task.feature}</span> : null}
      </div>

      <h4>{task.title}</h4>

      {total > 0 && (
        <div className="intel-bar" title={`${total} linked intelligence items`}>
          {segs.filter((s) => s.n > 0).map((s) => (
            <span key={s.k} data-intel-type={s.k} style={{ background: s.color, flex: s.n }} title={`${s.n} ${s.k}`} />
          ))}
        </div>
      )}

      <div className="tc-meta">
        {links.feedback > 0 && <span className="chip feedback"><span className="d" />{links.feedback} feedback</span>}
        {links.bugs > 0 && <span className="chip bug"><span className="d" />{links.bugs} bug</span>}
        {links.decisions > 0 && <span className="chip decision"><span className="d" />{links.decisions} ADR</span>}
        {links.metrics > 0 && <span className="chip metric"><span className="d" />metric</span>}
      </div>

      {/* Waiting on a human gate — amber banner + inline Review link. The whole
          card already links to the task, so this reads as a link (not a nested
          anchor, which would be invalid). */}
      {gated && (
        <div
          className="tc-gate"
          style={{
            marginTop: 8, display: "flex", alignItems: "center", gap: 8,
            padding: "6px 8px", borderRadius: 8,
            border: "1px solid rgba(230,184,106,.35)",
            background: "rgba(230,184,106,.08)", color: "var(--amber)", fontSize: 11.5,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)" }} />
          <span style={{ fontWeight: 500 }}>waiting on you</span>
          <span data-testid="card-gate-review" style={{ marginLeft: "auto", fontWeight: 500 }}>
            Review →
          </span>
        </div>
      )}

      {/* Env badges — the furthest deployment env a shipped run has reached. */}
      {reachedEnvs.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {reachedEnvs.map((e) => (
            <span
              key={e.key}
              data-testid={`env-badge-${e.key}`}
              className="chip"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}
            >
              <span className="d" style={{ background: "var(--green)" }} />
              {e.label}
            </span>
          ))}
        </div>
      )}

      <div className="tc-foot">
        <div className="left">
          {building ? (
            <span className="agent-running">
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
              building
            </span>
          ) : exec?.startable ? (
            <span className="tc-ready" data-testid="tc-startable" title="No open blockers — ready to start now">
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
              ready to start
            </span>
          ) : task.status === "ready" && exec?.blockedByOpen ? (
            <span className="tc-blocked" data-testid="tc-blocked" title="Waiting on upstream tasks">
              blocked by {exec.blockedByOpen}
            </span>
          ) : exec?.isEpic ? (
            <span className="muted mono" style={{ fontSize: 10.5 }} data-testid="tc-epic">epic</span>
          ) : (
            <span className="muted mono" style={{ fontSize: 10.5 }}>{task.status}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
