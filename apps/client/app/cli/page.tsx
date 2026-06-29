"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { api } from "@/lib/api";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="muted"
      style={{ margin: "auto", textAlign: "center", fontSize: 13, color: "var(--text-3)", padding: "40px 22px" }}
    >
      {children}
    </div>
  );
}

export default function CliPage() {
  // Real: live agent sessions are the "runs". Selecting one streams its live
  // terminal screen (plain text) from the server. No seed data.
  const { data, isLoading } = useSWR("sessions", () => api.sessions(), { refreshInterval: 4000 });
  const sessions = data?.sessions ?? [];

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const selectedId = activeId && sessions.some((s) => s.id === activeId) ? activeId : sessions[0]?.id ?? null;
  const session = sessions.find((s) => s.id === selectedId) ?? null;

  const { data: screen } = useSWR(
    selectedId ? ["session-screen", selectedId] : null,
    () => api.sessionScreen(selectedId!),
    { refreshInterval: 2000 },
  );

  const lines = (screen ?? "").split("\n");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="CLI / logs" />
      {isLoading && !data ? (
        <Empty>Loading…</Empty>
      ) : sessions.length === 0 ? (
        <Empty>No live sessions right now.</Empty>
      ) : (
        <div className="cli-wrap" data-testid="cli">
          {/* Live sessions */}
          <aside className="cli-runs">
            <div className="cli-runs-h">Live sessions</div>
            {sessions.map((s) => (
              <button
                key={s.id}
                className={"cli-run" + (s.id === selectedId ? " on" : "")}
                data-testid="cli-run"
                onClick={() => setActiveId(s.id)}
              >
                <div className="cli-run-cmd mono">{s.label ?? s.name}</div>
                <div className="cli-run-when mono">{s.role ?? s.state}{s.alive ? "" : " · dead"}</div>
              </button>
            ))}
          </aside>

          {/* Log block — live terminal screen */}
          <section className="cli-log" data-testid="cli-log">
            <div className="cli-log-h mono">{session?.cmd ?? session?.name ?? ""}</div>
            <div className="term">
              {screen ? (
                lines.map((l, i) => (
                  <div className="tline" key={i}>
                    <span style={{ color: "var(--text)" }}>{l}</span>
                  </div>
                ))
              ) : (
                <div className="tline"><span style={{ color: "var(--text-4)" }}>No log output yet.</span></div>
              )}
              <div className="tline"><span className="ts blink">▌</span></div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
