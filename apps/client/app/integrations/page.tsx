"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead, TogglePill } from "@/components/ui";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";

// Status → dot color (generic UI mapping, not seed data).
const STATUS_COLOR: Record<string, string> = {
  connected: "var(--green)", degraded: "var(--amber)", off: "var(--text-4)",
};

type Item = { id: string; name: string; cat: string; status: string; usage: string; connected: boolean };

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="muted" style={{ margin: "auto", padding: 24, fontSize: 13, textAlign: "center", color: "var(--text-4)" }}>
      {children}
    </div>
  );
}

export default function IntegrationsPage() {
  const { project } = useProject();
  const { data, mutate } = useSWR(
    project ? ["integrations", project.id] : null,
    () => api.integrations(project!.id),
  );
  // Real integrations only — connections drive the grid; honest empty state when
  // there are none.
  const items: Item[] = (data?.integrations ?? []).map((r) => ({
    id: r.id, name: r.name, cat: r.category ?? "Other",
    status: r.status, usage: r.usage ?? "", connected: r.connected === 1,
  }));

  const [state, setState] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    setState(Object.fromEntries(items.map((i) => [i.id, i.connected])));
  }, [data]); // re-seed when the real list loads

  const isOn = (i: Item) => state[i.id] ?? i.connected;
  const toggle = (i: Item) => {
    const next = !isOn(i);
    setState((p) => ({ ...p, [i.id]: next }));
    // Persist real connections; revert on failure.
    api.setIntegrationConnected(i.id, next).then(() => mutate()).catch(() =>
      setState((p) => ({ ...p, [i.id]: !next })),
    );
  };

  const cats = Array.from(new Set(items.map((i) => i.cat)));

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Integrations" />
      {!project ? (
        <Empty>Select a project to see its integrations.</Empty>
      ) : items.length === 0 ? (
        <Empty>No integrations connected yet.</Empty>
      ) : (
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
                        <span className="int-glyph">◦</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="int-name">{i.name}</div>
                          <div className="int-cat muted mono">{i.cat}</div>
                        </div>
                        <span className="int-status" data-status={i.status}>
                          <span className="int-status-dot" style={{ background: STATUS_COLOR[i.status] ?? "var(--text-4)" }} />
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
      )}
    </div>
  );
}
