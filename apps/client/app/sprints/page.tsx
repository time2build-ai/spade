"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { DEMO_SPRINTS } from "@/lib/demo";

const SEGS = [
  { k: "shipped", color: "var(--green)", label: "Shipped" },
  { k: "review", color: "var(--accent)", label: "Review" },
  { k: "progress", color: "var(--blue)", label: "In progress" },
  { k: "queued", color: "var(--bg-3)", label: "Queued" },
] as const;

function StackBar({ s }: { s: { shipped: number; review: number; progress: number; queued: number; total: number } }) {
  return (
    <div className="stack-bar" data-testid="stack-bar">
      {SEGS.map((seg) => {
        const n = s[seg.k];
        return n > 0 ? <span key={seg.k} style={{ background: seg.color, flex: n }} title={`${n} ${seg.label}`} /> : null;
      })}
    </div>
  );
}

/** Burn-down SVG: remaining vs ideal. */
function BurnSvg({ rem, ideal }: { rem: number[]; ideal: number[] }) {
  const W = 520, H = 130, pad = 6;
  const max = Math.max(...rem, ...ideal);
  const sx = (i: number) => pad + (i / (rem.length - 1)) * (W - pad * 2);
  const sy = (v: number) => pad + (1 - v / (max || 1)) * (H - pad * 2);
  const path = (pts: number[]) => pts.map((v, i) => (i ? "L" : "M") + sx(i).toFixed(1) + "," + sy(v).toFixed(1)).join(" ");
  return (
    <svg className="burn-svg" viewBox={`0 0 ${W} ${H}`} data-testid="burn-svg" preserveAspectRatio="none" style={{ width: "100%", height: 130 }}>
      <path d={path(ideal)} fill="none" stroke="var(--text-4)" strokeWidth="1" strokeDasharray="4 4" />
      <path d={path(rem)} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      <circle cx={sx(rem.length - 1)} cy={sy(rem[rem.length - 1])} r="3" fill="var(--accent)" />
    </svg>
  );
}

export default function SprintsPage() {
  const { project } = useProject();
  const { data } = useSWR(
    project ? ["sprints", project.id] : null,
    () => api.sprints(project!.id),
  );
  // Real-wins: real sprint rows drive the hero + rows (counts derived server-side
  // from pipeline runs); when there are none we fall back to DEMO_SPRINTS so the
  // page still looks full. Burn-down has no real source yet → always seeded.
  const real = data?.sprints ?? [];
  const useReal = real.length > 0;

  const rows = useReal
    ? real.map((s) => ({
        num: s.number,
        state: s.state === "active" ? "current" : s.state,
        shipped: s.shipped, review: s.review, progress: s.progress, queued: s.queued,
        total: s.total, velocity: "—",
      }))
    : DEMO_SPRINTS.rows;

  const cur = useReal ? (real.find((s) => s.state === "active") ?? real[0]) : null;
  const c = cur
    ? { num: cur.number, day: cur.day_label ?? "", shipped: cur.shipped, review: cur.review, progress: cur.progress, queued: cur.queued }
    : DEMO_SPRINTS.current;
  const burndown = DEMO_SPRINTS.burndown;
  const ideal = DEMO_SPRINTS.ideal;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Sprints" />
      <div className="sprint-wrap">
        {/* Current sprint hero */}
        <section className="sprint-hero" data-testid="sprint-hero">
          <div className="sprint-hero-top">
            <div>
              <div className="sprint-hero-num">Sprint {c.num}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>{c.day} · acme/web-app</div>
            </div>
            <div className="sprint-hero-stats">
              <div><div className="val" style={{ color: "var(--green)" }}>{c.shipped}</div><div className="lbl">shipped</div></div>
              <div><div className="val" style={{ color: "var(--accent)" }}>{c.review}</div><div className="lbl">review</div></div>
              <div><div className="val" style={{ color: "var(--blue)" }}>{c.progress}</div><div className="lbl">in progress</div></div>
              <div><div className="val">{c.queued}</div><div className="lbl">queued</div></div>
            </div>
          </div>
          <StackBar s={{ ...c, total: c.shipped + c.review + c.progress + c.queued }} />
        </section>

        {/* Burn-down */}
        <section className="sprint-burn" data-testid="sprint-burn">
          <div className="sprint-sec-h">Burn-down</div>
          <BurnSvg rem={burndown} ideal={ideal} />
        </section>

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
                <StackBar s={r} />
                <div className="sprint-row-stats mono">
                  <span style={{ color: "var(--green)" }}>{r.shipped}</span>/{r.total} · {r.velocity}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
