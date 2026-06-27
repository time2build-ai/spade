import * as React from "react";
import { TaskCard } from "./TaskCard";
import { tasksByStatus } from "@/lib/adapters";
import type { BrainNode, Status, Task } from "@/lib/types";

/**
 * Column display order + label + dot color (reference BacklogView). Blocked is
 * NOT a column — blocked tasks surface in the amber banner above the board.
 */
const COLUMNS: { status: Status; label: string; color: string }[] = [
  { status: "ready", label: "Ready", color: "var(--text-4)" },
  { status: "in_progress", label: "In progress", color: "var(--blue)" },
  { status: "review", label: "Review", color: "var(--accent)" },
  { status: "shipped", label: "Shipped", color: "var(--green)" },
];

export interface BoardProps {
  tasks: Task[];
  nodesById: Record<string, BrainNode>;
}

/** 4-column backlog board. Buckets tasks by status into ordered columns. */
export function Board({ tasks, nodesById }: BoardProps) {
  const buckets = tasksByStatus(tasks);

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
                <TaskCard key={task.id} task={task} nodesById={nodesById} />
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
