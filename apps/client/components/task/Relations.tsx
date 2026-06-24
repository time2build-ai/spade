import * as React from "react";
import Link from "next/link";
import { taskRelations } from "@/lib/adapters";
import type { TaskLink } from "@/lib/types";

/** Buckets in display order, with their human labels. */
const BUCKETS = [
  { key: "blockedBy", label: "Blocked by" },
  { key: "blocks", label: "Blocks" },
  { key: "parent", label: "Parent" },
  { key: "subtasks", label: "Subtasks" },
  { key: "related", label: "Related" },
] as const;

export interface RelationsProps {
  taskId: string;
  links: TaskLink[];
}

/**
 * "Dependencies" section for the task detail. Renders only the non-empty
 * derived buckets (Blocked by / Blocks / Parent / Subtasks / Related); each
 * entry is a chip linking to the other task. When every bucket is empty it
 * shows an honest "No dependencies" empty state.
 */
export function Relations({ taskId, links }: RelationsProps) {
  const rel = taskRelations(taskId, links);
  const nonEmpty = BUCKETS.filter((b) => rel[b.key].length > 0);

  return (
    <section>
      <div className="section-h">
        Dependencies
        {links.length > 0 ? (
          <span className="count">{links.length}</span>
        ) : null}
      </div>
      {nonEmpty.length === 0 ? (
        <div className="section-empty">No dependencies</div>
      ) : (
        nonEmpty.map((b) => (
          <div className="rel-group" key={b.key}>
            <div className="rel-label">{b.label}</div>
            <div className="rel-chips">
              {rel[b.key].map((otherId) => (
                <Link
                  className="rel-chip mono"
                  href={`/task/${otherId}`}
                  key={`${b.key}-${otherId}`}
                >
                  {otherId}
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
