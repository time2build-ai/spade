import * as React from "react";
import Link from "next/link";
import { Priority } from "@/components/ui";
import { groupNodesByType } from "@/lib/adapters";
import type { BrainNode, Task } from "@/lib/types";

export interface TaskCardProps {
  task: Task;
  /** Project brain nodes keyed by id, for resolving task.nodes ids. */
  nodesById: Record<string, BrainNode>;
}

/**
 * Backlog card (reference TaskCard). Intel bar + chips summarise the task's
 * linked intelligence — feedback/bug/decision/metric counts come from the REAL
 * linked brain nodes; the "building" pill reflects the real task status.
 */
export function TaskCard({ task, nodesById }: TaskCardProps) {
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
  const building = task.status === "in_progress";

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

      <div className="tc-foot">
        <div className="left">
          {building ? (
            <span className="agent-running">
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
              building
            </span>
          ) : (
            <span className="muted mono" style={{ fontSize: 10.5 }}>{task.status}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
