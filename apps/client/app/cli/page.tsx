"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { statusMeta } from "@/lib/status";

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

  // Resolve each session to its task (session.mission = run id → run.task_id →
  // task title) so the list reads "SPD-037 · Add toggle · Building" not raw ids.
  const { project } = useProject();
  const { data: runsData } = useSWR(
    project ? ["lifecycle-runs", project.id] : null,
    () => api.lifecycleList(project!.id),
    { refreshInterval: 5000 },
  );
  const { data: tasksData } = useSWR(project ? ["tasks", project.id] : null, () => api.tasks(project!.id));
  const runById = React.useMemo(
    () => new Map((runsData?.runs ?? []).map((r) => [r.id, r])),
    [runsData],
  );
  const taskTitle = React.useMemo(
    () => new Map((tasksData?.tasks ?? []).map((t) => [t.id, t.title])),
    [tasksData],
  );
  const sessionTask = (mission: string | null) => {
    const run = mission ? runById.get(mission) : undefined;
    if (!run) return null;
    return { taskId: run.task_id, title: taskTitle.get(run.task_id) ?? run.task_id };
  };
  const roleLabel = (s: (typeof sessions)[number]) =>
    s.role === "orchestrator" ? "Orchestrator" : s.role ? statusMeta(s.role).label : s.state;

  // Group the live sessions by ticket (task) so every agent for an issue sits
  // together under a collapsible header; sessions with no task (e.g. the
  // orchestrator) group under their own label.
  const groups = React.useMemo(() => {
    const map = new Map<string, { key: string; taskId?: string; title: string; sessions: typeof sessions }>();
    for (const s of sessions) {
      const t = sessionTask(s.mission);
      const key = t ? t.taskId : (s.label ?? s.role ?? "Other");
      if (!map.has(key)) map.set(key, { key, taskId: t?.taskId, title: t?.title ?? key, sessions: [] });
      map.get(key)!.sessions.push(s);
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, runById, taskTitle]);

  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const [activeId, setActiveId] = React.useState<string | null>(null);
  // Preselect a session when arrived from the Orchestrator "watch ↗" link
  // (/cli?session=<id>). Read the query directly to avoid a Suspense boundary.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const s = new URLSearchParams(window.location.search).get("session");
    if (s) setActiveId(s);
  }, []);
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
            <div className="cli-runs-h">Live sessions · by ticket</div>
            {groups.map((g) => {
              const isClosed = collapsed.has(g.key);
              return (
                <div className={"cli-group" + (isClosed ? " closed" : "")} key={g.key} data-testid="cli-group">
                  <button className="cli-group-h" onClick={() => toggleCollapse(g.key)}>
                    <span className="cli-group-chev"><Icon name="chev" size={12} /></span>
                    {g.taskId && <span className="cli-run-taskid mono">{g.taskId}</span>}
                    <span className="cli-group-title">{g.title}</span>
                    <span className="cli-group-count mono">{g.sessions.length}</span>
                  </button>
                  {!isClosed && (
                    <div className="cli-group-body">
                      {g.sessions.map((s) => (
                        <button
                          key={s.id}
                          className={"cli-run" + (s.id === selectedId ? " on" : "")}
                          data-testid="cli-run"
                          onClick={() => setActiveId(s.id)}
                        >
                          <div className="cli-run-when mono">
                            <span className={"cli-live" + (s.alive ? "" : " dead")} />
                            {roleLabel(s)}{s.alive ? "" : " · dead"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </aside>

          {/* Log block — live terminal screen */}
          <section className="cli-log" data-testid="cli-log">
            <div className="cli-log-h mono">
              {session
                ? (() => {
                    const t = sessionTask(session.mission);
                    return t ? `${t.taskId} · ${t.title} · ${roleLabel(session)}` : (session.label ?? roleLabel(session));
                  })()
                : ""}
            </div>
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
