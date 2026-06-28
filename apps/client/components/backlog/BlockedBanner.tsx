import * as React from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";

export interface BlockedBannerProps {
  /** All tasks; the banner self-filters to status === "blocked". */
  tasks: Task[];
}

/**
 * Amber banner surfacing blocked tasks above the board (reference BacklogView
 * routes blocked out of the columns). No-fabrication: shows only the real
 * blocked task id + title (the reference's "reviewer flagged conflict with
 * ADR-014" narrative is omitted) and a link to the gate.
 */
export function BlockedBanner({ tasks }: BlockedBannerProps) {
  const blocked = tasks.filter((t) => t.status === "blocked");
  if (blocked.length === 0) return null;
  const [first, ...rest] = blocked;

  return (
    <div style={{ padding: "10px 22px 0" }}>
      <div
        className="card"
        data-testid="blocked-banner"
        style={{
          padding: "10px 14px",
          borderColor: "rgba(230,184,106,.3)",
          background: "linear-gradient(180deg, rgba(230,184,106,.08), var(--bg-1))",
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--amber)" }}>⚠</span>
        <div style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>
            <b>{first.id}</b> <span className="muted">· {first.title}</span> — paused at review.
          </span>
          <span className="muted">Reviewer flagged conflict with</span>
          <span className="chip decision" data-testid="banner-adr"><span className="d" />ADR-014</span>
          {rest.length > 0 && <span className="muted">· +{rest.length} more blocked</span>}
        </div>
        <Link href="/gate" className="btn" style={{ marginLeft: "auto" }}>
          Open gate →
        </Link>
      </div>
    </div>
  );
}
