import * as React from "react";
import { TaskCard } from "./TaskCard";
import { tasksByStatus, taskExecutionStates } from "@/lib/adapters";
import type { BrainNode, LifecycleRun, Status, Task } from "@/lib/types";

/**
 * Column display order + label + dot color (Task Lifecycle V2 phases). Blocked
 * is NOT a column — blocked tasks surface in the amber banner above the board.
 * (The legacy in_progress/review statuses were retired with the pipeline write
 * path in Chunk 6 and remapped to building/pr_review.)
 */
const COLUMNS: { status: Status; label: string; color: string }[] = [
  { status: "ready", label: "Ready", color: "var(--text-4)" },
  { status: "shaping", label: "Shaping", color: "var(--pink)" },
  { status: "plan_review", label: "Plan review", color: "var(--amber)" },
  { status: "building", label: "Building", color: "var(--blue)" },
  { status: "pr_review", label: "PR review", color: "var(--accent)" },
  { status: "shipped", label: "Shipped", color: "var(--green)" },
];

export interface BoardProps {
  tasks: Task[];
  nodesById: Record<string, BrainNode>;
  /** Task ids with a `waiting` lifecycle gate → the amber "waiting on you" card. */
  gatedTaskIds?: Set<string>;
  /** Active lifecycle run per task id → env badges on shipped cards. */
  runsByTask?: Record<string, LifecycleRun>;
}

/** 6-column backlog board. Buckets tasks by status into ordered columns. */
export function Board({ tasks, nodesById, gatedTaskIds, runsByTask }: BoardProps) {
  const buckets = tasksByStatus(tasks);
  const exec = taskExecutionStates(tasks);

  return (
    <div className="backlog-grid">
      {COLUMNS.map((col) => {
        const items = buckets[col.status];
        return (
          <div className="col" key={col.status} data-status={col.status}>
            <div className="col-head">
              <span className="col-dot" style={{ background: col.color }} />
              <span>{col.label}</span>
              <span className="count">{items.length}</span>
            </div>
            <div className="col-body">
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  nodesById={nodesById}
                  exec={exec.get(task.id)}
                  gated={gatedTaskIds?.has(task.id)}
                  run={runsByTask?.[task.id]}
                />
              ))}
              {items.length === 0 && (
                <div
                  className="muted"
                  style={{ fontSize: 12, padding: 8, color: "var(--text-4)" }}
                >
                  —
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
