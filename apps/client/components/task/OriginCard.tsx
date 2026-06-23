import * as React from "react";
import { Avatar } from "@/components/ui";
import type { Task } from "@/lib/types";

export interface OriginCardProps {
  task: Pick<Task, "origin_quote" | "origin_source">;
}

/**
 * The `.origin` card: a serif-italic quote + source line. Honest empty state:
 * if there is no origin quote, render nothing (never fabricate a quote).
 */
export function OriginCard({ task }: OriginCardProps) {
  if (!task.origin_quote) return null;

  return (
    <div className="origin">
      <h5>Origin</h5>
      <blockquote>“{task.origin_quote}”</blockquote>
      {task.origin_source ? (
        <div className="src">
          <Avatar style={{ width: 18, height: 18, fontSize: 10 }}>
            {originGlyph(task.origin_source)}
          </Avatar>
          <span className="mono">{task.origin_source}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Initials from a "Speaker · Source" line, falling back to a marker. */
function originGlyph(source: string): string {
  const speaker = source.split("·")[0]?.trim() ?? "";
  const initials = speaker
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  return initials || "“”";
}
