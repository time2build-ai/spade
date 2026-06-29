"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";

const SEGS = [
  { k: "shipped", color: "var(--green)", label: "Shipped" },
  { k: "review", color: "var(--accent)", label: "Review" },
  { k: "progress", color: "var(--blue)", label: "In progress" },
  { k: "queued", color: "var(--bg-3)", label: "Queued" },
] as const;

type Counts = { shipped: number; review: number; progress: number; queued: number; total: number };

function StackBar({ s }: { s: Counts }) {
  const any = s.shipped + s.review + s.progress + s.queued > 0;
  return (
    <div className="stack-bar" data-testid="stack-bar">
      {any
        ? SEGS.map((seg) => {
            const n = s[seg.k];
            return n > 0 ? <span key={seg.k} style={{ background: seg.color, flex: n }} title={`${n} ${seg.label}`} /> : null;
          })
        : <span style={{ background: "var(--bg-3)", flex: 1 }} title="No tasks yet" />}
    </div>
  );
}

export default function SprintsPage() {
  const { project } = useProject();
  const { data, isLoading } = useSWR(
    project ? ["sprints", project.id] : null,
    () => api.sprints(project!.id),
  );
  const real = data?.sprints ?? [];

  // Counts are derived server-side from each sprint's pipeline runs.
  const rows = real.map((s) => ({
    num: s.number,
    state: s.state === "active" ? "current" : s.state,
    shipped: s.shipped, review: s.review, progress: s.progress, queued: s.queued,
    total: s.total,
  }));
  const cur = real.find((s) => s.state === "active") ?? real[0] ?? null;

  let content: React.ReactNode;
  if (!project) {
    content = <div className="sprint-empty" data-testid="sprints-empty">Select a project to see its sprints.</div>;
  } else if (isLoading) {
    content = <div className="sprint-empty">Loading…</div>;
  } else if (!real.length) {
    content = (
      <div className="sprint-empty" data-testid="sprints-empty">
        No sprints yet. Start one from the orchestrator (or ask Spade to “kick off a sprint”) and it’ll
        track shipped / review / in-progress / queued here.
      </div>
    );
  } else {
    content = (
      <>
        {/* Current sprint hero */}
        {cur ? (
          <section className="sprint-hero" data-testid="sprint-hero">
            <div className="sprint-hero-top">
              <div>
                <div className="sprint-hero-num">Sprint {cur.number}</div>
                <div className="muted mono" style={{ fontSize: 12 }}>{cur.day_label ?? ""} · {project.name}</div>
              </div>
              <div className="sprint-hero-stats">
                <div><div className="val" style={{ color: "var(--green)" }}>{cur.shipped}</div><div className="lbl">shipped</div></div>
                <div><div className="val" style={{ color: "var(--accent)" }}>{cur.review}</div><div className="lbl">review</div></div>
                <div><div className="val" style={{ color: "var(--blue)" }}>{cur.progress}</div><div className="lbl">in progress</div></div>
                <div><div className="val">{cur.queued}</div><div className="lbl">queued</div></div>
              </div>
            </div>
            <StackBar s={{ shipped: cur.shipped, review: cur.review, progress: cur.progress, queued: cur.queued, total: cur.total }} />
          </section>
        ) : null}

        {/* Sprint rows */}
        <section>
          <div className="sprint-sec-h">All sprints</div>
          <div className="sprint-rows">
            {rows.map((r) => (
              <div className={"sprint-row" + (r.state === "current" ? " current" : "")} data-testid="sprint-row" key={r.num}>
                <div className="sprint-row-num">
                  Sprint {r.num}
                  {r.state === "current" && <span className="sprint-row-tag">current</span>}
                </div>
                <StackBar s={{ shipped: r.shipped, review: r.review, progress: r.progress, queued: r.queued, total: r.total }} />
                <div className="sprint-row-stats mono">
                  <span style={{ color: "var(--green)" }}>{r.shipped}</span>/{r.total}
                </div>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Sprints" />
      <div className="sprint-wrap">{content}</div>
    </div>
  );
}
