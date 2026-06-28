"use client";

import * as React from "react";
import { PageHead } from "@/components/ui";
import { DEMO_CLI_RUNS } from "@/lib/demo";

const LVL_COLOR: Record<string, string> = {
  ok: "var(--green)", warn: "var(--amber)", info: "var(--blue)", muted: "var(--text-4)",
};

export default function CliPage() {
  const runs = DEMO_CLI_RUNS;
  const [activeId, setActiveId] = React.useState(runs[0].id);
  const run = runs.find((r) => r.id === activeId) ?? runs[0];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="CLI / logs" />
      <div className="cli-wrap" data-testid="cli">
        {/* Recent runs */}
        <aside className="cli-runs">
          <div className="cli-runs-h">Recent runs</div>
          {runs.map((r) => (
            <button key={r.id} className={"cli-run" + (r.id === activeId ? " on" : "")} data-testid="cli-run" onClick={() => setActiveId(r.id)}>
              <div className="cli-run-cmd mono">{r.cmd}</div>
              <div className="cli-run-when mono">{r.when}</div>
            </button>
          ))}
        </aside>

        {/* Log block */}
        <section className="cli-log" data-testid="cli-log">
          <div className="cli-log-h mono">{run.cmd}</div>
          <div className="term">
            {run.lines.map((l, i) => (
              <div className="tline" key={i}>
                {l.p && <span style={{ color: "var(--text-3)" }}>{l.p}</span>}
                <span style={{ color: l.lvl ? LVL_COLOR[l.lvl] : "var(--text)" }}>{l.c}</span>
              </div>
            ))}
            <div className="tline"><span className="ts blink">▌</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
