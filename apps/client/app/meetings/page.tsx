"use client";

import * as React from "react";
import { PageHead } from "@/components/ui";
import { DEMO_MEETINGS } from "@/lib/demo";

const OUTCOME_COLOR: Record<string, string> = {
  task: "var(--accent)", decision: "var(--amber)", feedback: "var(--teal)",
};

export default function MeetingsPage() {
  const meetings = DEMO_MEETINGS;
  const [activeId, setActiveId] = React.useState(meetings[0].id);
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
              className={"mtg-item" + (mt.id === activeId ? " on" : "")}
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
