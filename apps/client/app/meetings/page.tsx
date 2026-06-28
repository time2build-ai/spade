"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { DEMO_MEETINGS } from "@/lib/demo";

const OUTCOME_COLOR: Record<string, string> = {
  task: "var(--accent)", decision: "var(--amber)", feedback: "var(--teal)",
};

export default function MeetingsPage() {
  const { project } = useProject();
  const { data } = useSWR(
    project ? ["meetings", project.id] : null,
    () => api.meetings(project!.id),
  );
  // Real-wins: real meeting title/date/summary/attendees show through; the seed
  // fills outcomes/transcript (no real extraction yet) and the whole list when
  // there are no real meetings, so the page always looks full.
  const real = data?.meetings ?? [];
  const meetings = real.length > 0
    ? real.map((mt, i) => {
        const seed = DEMO_MEETINGS[i % DEMO_MEETINGS.length];
        return {
          id: mt.id,
          title: mt.title,
          date: mt.date ?? seed.date,
          attendees: mt.attendees.length ? mt.attendees : seed.attendees,
          summary: mt.summary ?? seed.summary,
          outcomes: seed.outcomes,
          transcript: seed.transcript,
        };
      })
    : DEMO_MEETINGS;

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const m = meetings.find((x) => x.id === activeId) ?? meetings[0];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Meetings" />
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
          <div className="muted mono" style={{ fontSize: 11.5 }}>{m.date}</div>
          <div className="mtg-attendees">
            {m.attendees.map((a) => (
              <span className="mtg-att" key={a}><span className="avatar" style={{ width: 18, height: 18, fontSize: 9 }}>{a.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>{a}</span>
            ))}
          </div>

          <div className="section-h">Summary</div>
          <div className="mtg-summary serif">{m.summary}</div>

          <div className="section-h">Key outcomes<span className="count">{m.outcomes.length}</span></div>
          <div className="mtg-outcomes">
            {m.outcomes.map((o, i) => (
              <div className="mtg-outcome" data-testid="mtg-outcome" key={i}>
                <span className="mtg-outcome-kind" style={{ color: OUTCOME_COLOR[o.kind] }}>{o.kind}</span>
                <span>{o.text}</span>
              </div>
            ))}
          </div>

          <div className="section-h">Transcript<span className="count">highlighted evidence</span></div>
          <div className="mtg-transcript">
            {m.transcript.map((line, i) => (
              <div className={"mtg-line" + (line.hl ? " hl" : "")} data-testid={line.hl ? "mtg-hl" : "mtg-line"} key={i}>
                <span className="mtg-speaker mono">{line.speaker}</span>
                <span className="mtg-text">{line.text}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
