import * as React from "react";
import Link from "next/link";
import { Priority, Chip } from "@/components/ui";
import { groupNodesByType } from "@/lib/adapters";
import type { BrainNode, BrainNodeType, Task } from "@/lib/types";
import type { ChipType } from "@/components/ui";

/** Render order + token color per brain-node type, matching .intel-bar / .chip. */
const NODE_TYPES: { type: BrainNodeType; color: string }[] = [
  { type: "feature", color: "var(--accent)" },
  { type: "decision", color: "var(--amber)" },
  { type: "feedback", color: "var(--blue)" },
  { type: "bug", color: "var(--red)" },
  { type: "metric", color: "var(--teal)" },
  { type: "convention", color: "var(--pink)" },
];

export interface TaskCardProps {
  task: Task;
  /** Project brain nodes keyed by id, for resolving task.nodes ids. */
  nodesById: Record<string, BrainNode>;
}

/**
 * Presentational backlog card. Resolves the task's grounded brain-node ids to
 * objects, summarizes them by type into an intel bar + chip meta, and links to
 * the task detail route. No agent endpoint in M1 -> footer shows "unassigned".
 */
export function TaskCard({ task, nodesById }: TaskCardProps) {
  const resolved: BrainNode[] = [];
  for (const id of task.nodes) {
    const node = nodesById[id];
    if (node) resolved.push(node);
  }
  const grouped = groupNodesByType(resolved);

  const segments = NODE_TYPES.map((t) => ({
    ...t,
    count: grouped[t.type].length,
  })).filter((s) => s.count > 0);

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
        {task.feature ? (
          <span style={{ marginLeft: "auto" }}>{task.feature}</span>
        ) : null}
      </div>

      <h4>{task.title}</h4>

      <div
        className="intel-bar"
        title={
          resolved.length > 0
            ? `${resolved.length} linked intelligence items`
            : "no linked intelligence"
        }
      >
        {segments.length > 0 ? (
          segments.map((s) => (
            <span
              key={s.type}
              data-intel-type={s.type}
              style={{ background: s.color, flex: s.count }}
              title={`${s.count} ${s.type}`}
            />
          ))
        ) : (
          <span style={{ background: "var(--line)", opacity: 0.5 }} />
        )}
      </div>

      <div className="tc-meta">
        {segments.map((s) => (
          <Chip key={s.type} type={s.type as ChipType} data-chip-type={s.type}>
            {s.count} {s.type}
          </Chip>
        ))}
      </div>

      <div className="tc-foot">
        <div className="left">
          {/* no agent endpoint M1 */}
          <span
            className="avatar"
            style={{ background: "transparent", borderStyle: "dashed" }}
            aria-hidden="true"
          >
            ·
          </span>
          <span>unassigned</span>
        </div>
      </div>
    </Link>
  );
}
