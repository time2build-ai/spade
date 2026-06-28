"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead, TogglePill } from "@/components/ui";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { DEMO_INTEGRATIONS, INT_STATUS_COLOR } from "@/lib/demo";

// Glyphs aren't stored server-side; derive from the known names (seed glyphs).
const GLYPH: Record<string, string> = Object.fromEntries(
  DEMO_INTEGRATIONS.map((i) => [i.name.toLowerCase(), i.glyph]),
);

type Item = { id: string; name: string; cat: string; glyph: string; status: string; usage: string; connected: boolean };

export default function IntegrationsPage() {
  const { project } = useProject();
  const { data, mutate } = useSWR(
    project ? ["integrations", project.id] : null,
    () => api.integrations(project!.id),
  );
  // Real-wins: real connections drive the grid; seed fills it when empty.
  const real = data?.integrations ?? [];
  const useReal = real.length > 0;
  const items: Item[] = useReal
    ? real.map((r) => ({
        id: r.id, name: r.name, cat: r.category ?? "Other",
        glyph: GLYPH[r.name.toLowerCase()] ?? "◦",
        status: r.status, usage: r.usage ?? "", connected: r.connected === 1,
      }))
    : DEMO_INTEGRATIONS.map((i) => ({ ...i }));

  const [state, setState] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    setState(Object.fromEntries(items.map((i) => [i.id, i.connected])));
  }, [data]); // re-seed when the real list loads

  const isOn = (i: Item) => state[i.id] ?? i.connected;
  const toggle = (i: Item) => {
    const next = !isOn(i);
    setState((p) => ({ ...p, [i.id]: next }));
    if (useReal) {
      // Persist real connections; revert on failure.
      api.setIntegrationConnected(i.id, next).then(() => mutate()).catch(() =>
        setState((p) => ({ ...p, [i.id]: !next })),
      );
    }
  };

  const cats = Array.from(new Set(items.map((i) => i.cat)));

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Integrations" />
      <div className="int-wrap" data-testid="integrations">
        {cats.map((cat) => (
          <section className="int-group" key={cat} data-testid="int-group">
            <div className="int-group-h">{cat}</div>
            <div className="int-grid">
              {items.filter((i) => i.cat === cat).map((i) => {
                const on = isOn(i);
                return (
                  <div className="int-card" data-testid="int-card" key={i.id}>
                    <div className="int-card-top">
                      <span className="int-glyph">{i.glyph}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="int-name">{i.name}</div>
                        <div className="int-cat muted mono">{i.cat}</div>
                      </div>
                      <span className="int-status" data-status={i.status}>
                        <span className="int-status-dot" style={{ background: INT_STATUS_COLOR[i.status] ?? "var(--text-4)" }} />
                        {i.status}
                      </span>
                    </div>
                    <div className="int-usage muted">{i.usage}</div>
                    <div className="int-card-foot">
                      <TogglePill on={on} onChange={() => toggle(i)} aria-label={`${i.name} connection`} />
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
