import * as React from "react";
import Link from "next/link";
import { Priority } from "@/components/ui";
import { groupNodesByType } from "@/lib/adapters";
import { taskCardSeed } from "@/lib/demo";
import type { BrainNode, Task } from "@/lib/types";

export interface TaskCardProps {
  task: Task;
  /** Project brain nodes keyed by id, for resolving task.nodes ids. */
  nodesById: Record<string, BrainNode>;
}

/**
 * Backlog card (reference TaskCard). Intel bar + chips summarise the task's
 * linked intelligence; feedback/bug/decision/metric counts come from the real
 * linked brain nodes, meetings + assignee + flag are seeded (real-wins).
 */
export function TaskCard({ task, nodesById }: TaskCardProps) {
  const resolved: BrainNode[] = [];
  for (const id of task.nodes) {
    const node = nodesById[id];
    if (node) resolved.push(node);
  }
  const g = groupNodesByType(resolved);
  const seed = taskCardSeed(task.id);

  const links = {
    feedback: g.feedback.length,
    bugs: g.bug.length,
    decisions: g.decision.length,
    meetings: seed.meetings,
    metrics: g.metric.length,
  };
  const segs: { k: string; color: string; n: number }[] = [
    { k: "feedback", color: "var(--blue)", n: links.feedback },
    { k: "bug", color: "var(--red)", n: links.bugs },
    { k: "decision", color: "var(--amber)", n: links.decisions },
    { k: "meeting", color: "#c9c9c9", n: links.meetings },
    { k: "metric", color: "var(--teal)", n: links.metrics },
  ];
  const total = segs.reduce((acc, s) => acc + s.n, 0);
  const a = seed.assignee;
  const building = a?.ai && task.status === "in_progress";

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
        {links.meetings > 0 && <span className="chip meeting"><span className="d" />{links.meetings} mtg</span>}
        {links.metrics > 0 && <span className="chip metric"><span className="d" />metric</span>}
      </div>

      <div className="tc-foot">
        <div className="left">
          {a ? (
            <span className={"avatar" + (a.ai ? " ai" : "")} title={a.name}>
              {a.ai ? "◆" : a.name.slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <span className="avatar" style={{ background: "transparent", borderStyle: "dashed" }} aria-hidden="true">·</span>
          )}
          {building && (
            <span className="agent-running">
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
              building
            </span>
          )}
        </div>
        {seed.flag && <span className="muted" style={{ color: "var(--amber)", marginLeft: "auto" }}>{seed.flag}</span>}
      </div>
    </Link>
  );
}
