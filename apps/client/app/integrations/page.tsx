"use client";

import * as React from "react";
import { PageHead, TogglePill } from "@/components/ui";
import { DEMO_INTEGRATIONS, INT_STATUS_COLOR } from "@/lib/demo";

export default function IntegrationsPage() {
  const [state, setState] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(DEMO_INTEGRATIONS.map((i) => [i.id, i.connected])),
  );

  const cats = Array.from(new Set(DEMO_INTEGRATIONS.map((i) => i.cat)));

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Integrations" />
      <div className="int-wrap" data-testid="integrations">
        {cats.map((cat) => (
          <section className="int-group" key={cat} data-testid="int-group">
            <div className="int-group-h">{cat}</div>
            <div className="int-grid">
              {DEMO_INTEGRATIONS.filter((i) => i.cat === cat).map((i) => {
                const on = !!state[i.id];
                return (
                  <div className="int-card" data-testid="int-card" key={i.id}>
                    <div className="int-card-top">
                      <span className="int-glyph">{i.glyph}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="int-name">{i.name}</div>
                        <div className="int-cat muted mono">{i.cat}</div>
                      </div>
                      <span className="int-status" data-status={i.status}>
                        <span className="int-status-dot" style={{ background: INT_STATUS_COLOR[i.status] }} />
                        {i.status}
                      </span>
                    </div>
                    <div className="int-usage muted">{i.usage}</div>
                    <div className="int-card-foot">
                      <TogglePill on={on} onChange={() => setState((p) => ({ ...p, [i.id]: !p[i.id] }))} aria-label={`${i.name} connection`} />
                      <span className="muted" style={{ fontSize: 11 }}>{on ? "Connected" : "Connect"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
