import * as React from "react";
import { Avatar } from "@/components/ui";
import { sessionStatusVisual } from "@/lib/adapters";
import type { Session } from "@/lib/types";

/** Avatar glyph: emoji if present, else the role's first letter, else "?". */
function agentGlyph(s: Session): string {
  if (s.emoji) return s.emoji;
  const src = s.role ?? s.name;
  const first = src.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

/** One row of meta, only rendered when the value is non-null. */
function MetaRow({ label, value }: { label: string; value: string | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="ap-meta-row">
      <span className="ap-meta-k mono">{label}</span>
      <span className="ap-meta-v mono">{value}</span>
    </div>
  );
}

/** One live session from the global fleet. Renders only real Session fields. */
export function AgentCard({ session }: { session: Session }) {
  const status = sessionStatusVisual(session);
  const live =
    session.alive &&
    (session.prep === "working" || session.prep === "ready");
  const title = session.label ?? session.name;

  return (
    <div className={"ap-agent" + (session.alive ? "" : " dead")}>
      <div className="ap-agent-h">
        <Avatar ai className="ap-agent-avatar">
          {agentGlyph(session)}
        </Avatar>
        <div className="ap-agent-id">
          <div className="ap-agent-name">{title}</div>
          <div className="ap-agent-model mono">
            {session.role ?? "—"}
            {session.model ? <> · {session.model}</> : null}
          </div>
        </div>
        <span
          className="ap-state-pill"
          style={{ color: status.color, borderColor: status.color }}
        >
          <span
            className={"ap-state-dot" + (live ? " pulse" : "")}
            style={{ background: status.color }}
          />
          {status.label}
        </span>
      </div>

      <div className="ap-agent-body">
        <MetaRow label="account" value={session.account_id} />
        <MetaRow label="project" value={session.project_id} />
        <MetaRow label="task" value={session.task} />
        <MetaRow label="mission" value={session.mission} />
      </div>
    </div>
  );
}
