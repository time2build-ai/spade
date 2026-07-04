import * as React from "react";
import { TaskCard } from "./TaskCard";
import { tasksByColumn, taskExecutionStates, type BoardColumn } from "@/lib/adapters";
import type { BrainNode, LifecycleRun, LifecycleTemplates, Task } from "@/lib/types";

/**
 * The 5 UNIVERSAL board columns (Task-Type Router). Every kind's phases map into
 * one of these via the `/lifecycle/templates` mapping — code (shaping→building→
 * pr_review), research (scoping→investigating→synthesis), docs (outline→drafting)
 * all share the same board. Blocked is NOT a column — blocked tasks surface in
 * the amber banner above the board.
 */
const COLUMNS: { key: BoardColumn; color: string }[] = [
  { key: "Ready", color: "var(--text-4)" },
  { key: "Planning", color: "var(--amber)" },
  { key: "In progress", color: "var(--blue)" },
  { key: "Review", color: "var(--accent)" },
  { key: "Done", color: "var(--green)" },
];

export interface BoardProps {
  tasks: Task[];
  nodesById: Record<string, BrainNode>;
  /** Per-kind phase→column mapping (GET /lifecycle/templates) — drives bucketing. */
  templates?: LifecycleTemplates;
  /** Task ids with a `waiting` lifecycle gate → the amber "waiting on you" card. */
  gatedTaskIds?: Set<string>;
  /** Active lifecycle run per task id → phase/fan-out/env badges on cards. */
  runsByTask?: Record<string, LifecycleRun>;
}

/** Universal 5-column backlog board. Buckets tasks into columns via `columnFor`
 *  using the per-kind template mapping. */
export function Board({ tasks, nodesById, templates, gatedTaskIds, runsByTask }: BoardProps) {
  const buckets = tasksByColumn(tasks, templates);
  const exec = taskExecutionStates(tasks);

  return (
    <div className="backlog-grid">
      {COLUMNS.map((col) => {
        const items = buckets[col.key];
        return (
          <div className="col" key={col.key} data-status={col.key}>
            <div className="col-head">
              <span className="col-dot" style={{ background: col.color }} />
              <span>{col.key}</span>
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
