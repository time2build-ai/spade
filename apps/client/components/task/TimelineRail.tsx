import * as React from "react";
import type { Comment } from "@/lib/types";

export interface TimelineRailProps {
  comments: Comment[];
}

/**
 * Vertical activity trail (`.timeline`) built from a task's comments. Each item
 * is a dot + author/kind + body + a short relative timestamp; the most recent
 * item is marked `.now` (accent green dot). Honest empty state for no activity.
 */
export function TimelineRail({ comments }: TimelineRailProps) {
  if (comments.length === 0) {
    return <div className="tl-empty">No activity yet</div>;
  }

  const lastIndex = comments.length - 1;

  return (
    <div className="timeline">
      {comments.map((c, i) => {
        const author = c.author?.trim() || c.kind || "system";
        return (
          <div
            className={i === lastIndex ? "tl-item now" : "tl-item"}
            key={c.id}
          >
            <div>
              <b>{author}</b>
              {c.kind ? <span className="muted"> · {c.kind}</span> : null}
            </div>
            <div>{c.body}</div>
            <div className="when">{relativeTime(c.created_at)}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Short relative timestamp ("just now", "5m ago", "3h ago", "2d ago"). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
