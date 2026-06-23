import * as React from "react";
import { TaskCard } from "./TaskCard";
import { tasksByStatus } from "@/lib/adapters";
import type { BrainNode, Status, Task } from "@/lib/types";

/** Column display order + label + dot color, lifted from views/backlog.jsx. */
const COLUMNS: { status: Status; label: string; color: string }[] = [
  { status: "ready", label: "Ready", color: "var(--text-4)" },
  { status: "in_progress", label: "In progress", color: "var(--blue)" },
  { status: "review", label: "Review", color: "var(--accent)" },
  { status: "shipped", label: "Shipped", color: "var(--green)" },
  { status: "blocked", label: "Blocked", color: "var(--amber)" },
];

export interface BoardProps {
  tasks: Task[];
  nodesById: Record<string, BrainNode>;
}

/** 5-column backlog board. Buckets tasks by status into ordered columns. */
export function Board({ tasks, nodesById }: BoardProps) {
  const buckets = tasksByStatus(tasks);

  return (
    <div className="backlog-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
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
