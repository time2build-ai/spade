"use client";

import * as React from "react";
import { PageHead } from "@/components/ui";
import { DEMO_FEEDBACK_CLUSTERS } from "@/lib/demo";

export default function FeedbackPage() {
  const clusters = DEMO_FEEDBACK_CLUSTERS;
  const [activeId, setActiveId] = React.useState(clusters[0].id);
  const c = clusters.find((x) => x.id === activeId) ?? clusters[0];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Feedback" />
      <div className="fb-wrap" data-testid="feedback">
        {/* Cluster list */}
        <aside className="fb-list">
          {clusters.map((cl) => (
            <button key={cl.id} className={"fb-cluster" + (cl.id === activeId ? " on" : "")} data-testid="fb-cluster" onClick={() => setActiveId(cl.id)}>
              <span className="fb-cluster-label">{cl.label}</span>
              <span className="fb-cluster-count mono">{cl.count}</span>
            </button>
          ))}
        </aside>

        {/* Detail */}
        <section className="fb-detail" data-testid="fb-detail">
          <h2 className="fb-title">{c.label}</h2>
          <div className="muted" style={{ fontSize: 12.5 }}>{c.count} reports · last 30 days</div>

          <div className="section-h">Source breakdown</div>
          <div className="src-bar" data-testid="src-bar">
            {c.sources.map((s) => (
              <span key={s.name} style={{ background: s.color, flex: s.n }} title={`${s.n} from ${s.name}`} />
            ))}
          </div>
          <div className="fb-platforms">
            {c.sources.map((s) => (
              <span className="fb-platform" key={s.name}>
                <span className="d" style={{ background: s.color }} />{s.name} · {s.n}
              </span>
            ))}
          </div>

          <div className="section-h">Verbatim quotes<span className="count">{c.quotes.length}</span></div>
          <div data-testid="fb-quotes">
            {c.quotes.map((q, i) => (
              <div className="quote-card" data-testid="quote-card" key={i}>
                <div className="q">“{q.q}”</div>
                <div className="src">— {q.src}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
