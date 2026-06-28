"use client";

import * as React from "react";
import { mutate } from "swr";
import { PageHead, TogglePill } from "@/components/ui";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { DEMO_SETTINGS_GROUPS } from "@/lib/demo";

export default function SettingsPage() {
  const { project } = useProject();

  // Initial state: real autopilot wins; the rest from the seeded defaults
  // (BACKEND: those non-column toggles aren't persisted yet).
  const initial = React.useMemo(() => {
    const s: Record<string, boolean> = {};
    for (const g of DEMO_SETTINGS_GROUPS) {
      for (const r of g.rows) {
        s[r.key] = r.real === "autopilot" && project ? project.autopilot === 1 : r.on;
      }
    }
    return s;
  }, [project]);

  const [state, setState] = React.useState<Record<string, boolean>>(initial);
  React.useEffect(() => setState(initial), [initial]);

  // Autopilot is a real project column → persist via PATCH (optimistic). Other
  // toggles stay local until their backend columns exist.
  const toggle = (key: string, real?: "autopilot") => {
    const next = !state[key];
    setState((p) => ({ ...p, [key]: next }));
    if (real === "autopilot" && project) {
      api.updateProject(project.id, { autopilot: next ? 1 : 0 })
        .then(() => mutate("projects"))
        .catch(() => setState((p) => ({ ...p, [key]: !next }))); // revert on failure
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Settings" />
      <div className="set-wrap" data-testid="settings">
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
          Automation for <b style={{ color: "var(--text-2)" }}>{project?.name ?? "this project"}</b>
          {project && (
            <span className="mono"> · strategy {project.account_strategy} · ceiling {project.model_ceiling ?? "—"}</span>
          )}
        </div>

        {DEMO_SETTINGS_GROUPS.map((g) => (
          <section className="set-group" key={g.title} data-testid="set-group">
            <div className="set-group-h">{g.title}</div>
            {g.rows.map((r) => (
              <div className="set-row" data-testid="set-row" key={r.key}>
                <div className="set-row-text">
                  <div className="set-row-label">
                    {r.label}
                    {r.real && <span className="set-row-real mono">live</span>}
                  </div>
                  <div className="set-row-desc muted">{r.desc}</div>
                </div>
                <TogglePill on={!!state[r.key]} onChange={() => toggle(r.key, r.real)} aria-label={r.label} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
