"use client";

import * as React from "react";
import { PageHead } from "@/components/ui";
import { Sparkline } from "@/components/task/Sparkline";
import { useProject } from "@/lib/useProject";
import { DEMO_OVERVIEW } from "@/lib/demo";

export default function OverviewPage() {
  const { project } = useProject();
  const o = DEMO_OVERVIEW;
  const name = project?.name ?? "Acme Storefront";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Overview" />
      <div className="ov-wrap">
        {/* Hero */}
        <section className="ov-hero" data-testid="ov-hero">
          <div className="ov-hero-l">
            <div className="muted mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase" }}>
              {name} · sprint 26 · day 2/10
            </div>
            <div className="ov-hero-metric">
              <span className="ov-hero-val">{o.headline.value}</span>
              <span className="muted" style={{ fontSize: 13 }}>{o.headline.target}</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>{o.headline.label}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>{o.headline.delta}</div>
          </div>
          <div className="ov-hero-r">
            <Sparkline pts={o.headline.series} />
          </div>
        </section>

        {/* KPI band */}
        <div className="ov-kpis" data-testid="ov-kpis">
          {o.kpis.map((k) => (
            <div className="ov-kpi" key={k.lbl}>
              <div className="lbl">{k.lbl}</div>
              <div className="val" style={k.color ? { color: k.color } : undefined}>{k.val}</div>
              <div className="sub muted">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Mini charts + now executing */}
        <div className="ov-mid">
          <div className="ov-charts" data-testid="ov-charts">
            {o.charts.map((c) => (
              <div className="ov-chart" key={c.label}>
                <div className="ov-chart-h">{c.label}</div>
                <Sparkline pts={c.series} color={c.color} />
              </div>
            ))}
          </div>
          <div className="ov-now" data-testid="ov-now">
            <div className="ov-card-h">Now executing</div>
            {o.nowExecuting.map((n) => (
              <div className="ov-now-row" key={n.task}>
                <span className="mono">{n.task}</span>
                <span className="muted" style={{ fontSize: 11 }}>{n.role}</span>
                <span className="mono" style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11 }}>{n.eta}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card grid */}
        <div className="ov-grid" data-testid="ov-grid">
          {o.cards.map((card) => (
            <div className="ov-card" key={card.title} data-testid="ov-card">
              <div className="ov-card-h">{card.title}</div>
              {card.items.map((it, i) => (
                <div className="ov-card-item" key={i}>{it}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
