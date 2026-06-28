"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { DEMO_FEEDBACK_CLUSTERS } from "@/lib/demo";

export default function FeedbackPage() {
  const { project } = useProject();
  const { data } = useSWR(
    project ? ["feedback", project.id] : null,
    () => api.feedbackClusters(project!.id),
  );
  // Real-wins: real label/count/sources drive the list + source bar + platform
  // pills; the seed fills verbatim quotes (no real source yet) and the whole list
  // when there are no real clusters, so the page always looks full.
  const real = data?.clusters ?? [];
  const clusters = real.length > 0
    ? real.map((cl, i) => ({
        id: cl.id,
        label: cl.label,
        count: cl.count,
        sources: cl.sources.length ? cl.sources : DEMO_FEEDBACK_CLUSTERS[i % DEMO_FEEDBACK_CLUSTERS.length].sources,
        quotes: DEMO_FEEDBACK_CLUSTERS[i % DEMO_FEEDBACK_CLUSTERS.length].quotes,
      }))
    : DEMO_FEEDBACK_CLUSTERS;

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const c = clusters.find((x) => x.id === activeId) ?? clusters[0];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Feedback" />
      <div className="fb-wrap" data-testid="feedback">
        {/* Cluster list */}
        <aside className="fb-list">
          {clusters.map((cl) => (
            <button key={cl.id} className={"fb-cluster" + (cl.id === c.id ? " on" : "")} data-testid="fb-cluster" onClick={() => setActiveId(cl.id)}>
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
