"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="muted" style={{ margin: "auto", padding: 24, fontSize: 13, textAlign: "center", color: "var(--text-4)" }}>
      {children}
    </div>
  );
}

export default function MeetingsPage() {
  const { project } = useProject();
  const { data } = useSWR(
    project ? ["meetings", project.id] : null,
    () => api.meetings(project!.id),
  );
  // Real meetings only — title/date/summary/attendees from the API, honest empty
  // state when there are none (outcomes/transcript have no real source yet).
  const meetings = data?.meetings ?? [];

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const m = meetings.find((x) => x.id === activeId) ?? meetings[0] ?? null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Meetings" />
      {!project ? (
        <Empty>Select a project to see its meetings.</Empty>
      ) : !m ? (
        <Empty>No meetings captured yet.</Empty>
      ) : (
        <div className="mtg-wrap" data-testid="meetings">
          {/* List */}
          <aside className="mtg-list">
            {meetings.map((mt) => (
              <button
                key={mt.id}
                className={"mtg-item" + (mt.id === m.id ? " on" : "")}
                data-testid="mtg-item"
                onClick={() => setActiveId(mt.id)}
              >
                <div className="mtg-item-title">{mt.title}</div>
                <div className="mtg-item-sub mono">{mt.attendees.length} attendees</div>
              </button>
            ))}
          </aside>

          {/* Detail */}
          <section className="mtg-detail" data-testid="mtg-detail">
            <h2 className="mtg-title">{m.title}</h2>
            <div className="muted mono" style={{ fontSize: 11.5 }}>{m.date ?? "—"}</div>
            <div className="mtg-attendees">
              {m.attendees.map((a) => (
                <span className="mtg-att" key={a}><span className="avatar" style={{ width: 18, height: 18, fontSize: 9 }}>{a.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>{a}</span>
              ))}
            </div>

            <div className="section-h">Summary</div>
            {m.summary ? (
              <div className="mtg-summary serif">{m.summary}</div>
            ) : (
              <div className="muted" style={{ fontSize: 12.5 }}>No summary yet.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
