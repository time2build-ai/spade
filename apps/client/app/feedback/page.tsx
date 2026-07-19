"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { PageEmpty } from "@/components/PageEmpty";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="muted" style={{ margin: "auto", padding: 24, fontSize: 13, textAlign: "center", color: "var(--text-4)" }}>
      {children}
    </div>
  );
}

export default function FeedbackPage() {
  const { project } = useProject();
  const { data } = useSWR(
    project ? ["feedback", project.id] : null,
    () => api.feedbackClusters(project!.id),
  );
  // Real clusters only — label/count/sources drive the list, source bar and
  // platform pills; honest empty state when there are none (verbatim quotes have
  // no real source yet).
  const clusters = data?.clusters ?? [];

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const c = clusters.find((x) => x.id === activeId) ?? clusters[0] ?? null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Feedback" />
      {!project ? (
        <Empty>Select a project to see its feedback.</Empty>
      ) : !c ? (
        <PageEmpty
          icon="flag" tone="var(--amber)" testid="feedback-empty"
          title="No feedback yet"
          sub="Feedback you capture gets clustered into themes and linked to the tasks that address it — so you can see what users keep asking for."
        />
      ) : (
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
            {c.sources.length ? (
              <>
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
              </>
            ) : (
              <div className="muted" style={{ fontSize: 12.5 }}>No sources recorded.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
