"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { statusMeta } from "@/lib/status";
import type { LifecycleRun, Session, Task } from "@/lib/types";

/** Kind → icon (matches the backlog kind pills: spark/search/doc). */
const KIND_ICON: Record<string, IconName> = { code: "spark", research: "search", docs: "doc" };
const KIND_LABEL: Record<string, string> = { code: "Code", research: "Research", docs: "Docs" };

type RunState = "running" | "gate" | "blocked" | "done" | "queued";
const STATE_META: Record<RunState, { label: string; color: string }> = {
  running: { label: "running", color: "var(--green)" },
  gate: { label: "waiting on you", color: "var(--amber)" },
  blocked: { label: "blocked", color: "var(--red)" },
  done: { label: "done", color: "var(--text-3)" },
  queued: { label: "queued", color: "var(--blue)" },
};

const TERMINAL = new Set(["shipped", "delivered"]);
const FILTERS: { key: "all" | RunState; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "gate", label: "Waiting on you" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 22px", color: "var(--text-3)", fontSize: 13 }}>{children}</div>
  );
}

export default function OrchestratorPage() {
  const { project, loading: projectLoading } = useProject();
  const [filter, setFilter] = React.useState<"all" | RunState>("all");
  // Which runs have their instance list expanded (see the agents + what they do).
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Live lifecycle runs + live agent sessions are the REAL fleet. Poll both.
  const { data: runsData, error, isLoading } = useSWR(
    project ? ["lifecycle-runs", project.id] : null,
    () => api.lifecycleList(project!.id),
    { refreshInterval: 2000 },
  );
  const { data: sessionsData } = useSWR("sessions", () => api.sessions(), { refreshInterval: 2000 });
  const { data: gatesData } = useSWR(
    project ? ["lifecycle-gates", project.id] : null,
    () => api.lifecycleGates(project!.id),
    { refreshInterval: 2500 },
  );
  const { data: tasksData } = useSWR(project ? ["tasks", project.id] : null, () => api.tasks(project!.id));
  const { data: accountsData } = useSWR("accounts", () => api.accounts());

  const runs: LifecycleRun[] = runsData?.runs ?? [];
  const sessions: Session[] = React.useMemo(
    () => (sessionsData?.sessions ?? []).filter((s) => !project || s.project_id === project.id),
    [sessionsData, project],
  );
  const liveSessions = sessions.filter((s) => s.alive);

  const titleById: Record<string, string> = {};
  const statusById: Record<string, string> = {};
  for (const t of (tasksData?.tasks ?? []) as Task[]) {
    titleById[t.id] = t.title;
    statusById[t.id] = t.status;
  }
  const accountById: Record<string, string> = {};
  for (const a of accountsData?.accounts ?? []) accountById[a.id] = a.label;
  const gatedTaskIds = new Set((gatesData?.gates ?? []).map((g) => g.task_id));

  // Derive each run's fleet state + its live agent session(s).
  const rows = runs.map((run) => {
    const taskStatus = statusById[run.task_id];
    const gated = gatedTaskIds.has(run.task_id);
    // the current phase agent — by explicit session id, else by mission = run id
    const agent =
      sessions.find((s) => s.id === run.agent_session_id && s.alive) ??
      sessions.find((s) => s.mission === run.id && s.alive) ??
      null;
    const fanoutAgents = sessions.filter((s) => s.mission === run.id && s.alive);

    let state: RunState;
    if (run.blocked_reason) state = "blocked";
    else if (gated) state = "gate";
    else if (agent || run.active === 1) state = "running";
    else if (taskStatus && TERMINAL.has(taskStatus)) state = "done";
    else state = "queued";

    return { run, state, agent, fanoutAgents, title: titleById[run.task_id] ?? run.task_id };
  });

  // Sort: attention first (blocked, gate), then running, then queued, then done.
  const ORDER: RunState[] = ["blocked", "gate", "running", "queued", "done"];
  rows.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));
  const shown = filter === "all" ? rows : rows.filter((r) => r.state === filter);

  const kpis = {
    running: rows.filter((r) => r.state === "running").length,
    gate: rows.filter((r) => r.state === "gate").length,
    blocked: rows.filter((r) => r.state === "blocked").length,
    done: rows.filter((r) => r.state === "done").length,
    live: liveSessions.length,
  };

  let body: React.ReactNode;
  if (projectLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (!project) {
    body = <StateMessage>Select or create a project to view its fleet.</StateMessage>;
  } else if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>Couldn’t load lifecycle runs: {String(error.message ?? error)}</span>
      </StateMessage>
    );
  } else if (isLoading && !runsData) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (runs.length === 0) {
    body = (
      <StateMessage>
        No lifecycle runs yet. Open a task on the <Link href="/backlog">Backlog</Link> and press{" "}
        <b>Start lifecycle</b> — running agents and their gates appear here.
      </StateMessage>
    );
  } else {
    body = (
      <>
        <div className="fleet-kpis">
          <Kpi label="Running" val={kpis.running} color={kpis.running ? "var(--green)" : undefined} />
          <Kpi label="Waiting on you" val={kpis.gate} color={kpis.gate ? "var(--amber)" : undefined} />
          <Kpi label="Blocked" val={kpis.blocked} color={kpis.blocked ? "var(--red)" : undefined} />
          <Kpi label="Live agents" val={kpis.live} color={kpis.live ? "var(--blue)" : undefined} />
          <Kpi label="Done" val={kpis.done} />
        </div>

        <div className="filter-bar">
          <span>Filter</span>
          <div className="seg">
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
                {f.key === "all" ? `All (${rows.length})` : f.label}
              </button>
            ))}
          </div>
          <span style={{ marginLeft: "auto" }} className="muted">
            click a row to open the task · watch ↗ streams the live terminal
          </span>
        </div>

        <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "0 22px 22px" }}>
          {shown.length === 0 ? (
            <StateMessage>No runs match this filter.</StateMessage>
          ) : (
            <div className="fleet-list">
              {shown.map(({ run, state, fanoutAgents, title }) => {
                const meta = STATE_META[state];
                const kind = run.kind ?? "code";
                const instances = fanoutAgents; // all live sessions for this run
                const isOpen = expanded.has(run.id);
                return (
                  <div className="fleet-item" key={run.id}>
                    <Link href={`/task/${run.task_id}`} className="fleet-row" data-open={isOpen ? "1" : undefined}>
                      <span className="fleet-kindcol">
                        <span className="kind-pill sm" data-kind={kind} title={KIND_LABEL[kind] ?? kind}>
                          <Icon name={KIND_ICON[kind] ?? "spark"} size={11} />
                          {KIND_LABEL[kind] ?? kind}
                        </span>
                      </span>

                      <span className="fleet-task">
                        <span className="fleet-id">{run.task_id}</span>
                        <span className="fleet-title">{title}</span>
                      </span>

                      <span className="fleet-phase" title="current phase">
                        {statusMeta(run.phase).label}
                      </span>

                      <span className="fleet-state" style={{ color: meta.color }}>
                        <span
                          className={state === "running" ? "pulse-dot" : "fleet-dot"}
                          style={{ background: meta.color }}
                        />
                        {run.blocked_reason ? `blocked — ${run.blocked_reason}` : meta.label}
                      </span>

                      <span className="fleet-agent">
                        {instances.length ? (
                          <button
                            type="button"
                            className="fleet-expand"
                            aria-expanded={isOpen}
                            title="Show the running agent instances"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleExpand(run.id); }}
                          >
                            {instances.length} {instances.length === 1 ? "instance" : "instances"}
                            <Icon name="chev" size={12} />
                          </button>
                        ) : state === "gate" ? (
                          <span style={{ color: "var(--amber)", fontWeight: 500, fontSize: 12 }}>Review →</span>
                        ) : (
                          <span className="muted" style={{ fontSize: 11 }}>—</span>
                        )}
                      </span>
                    </Link>

                    {isOpen && instances.length > 0 && (
                      <div className="fleet-instances" data-testid="fleet-instances">
                        {instances.map((s) => (
                          <div className="fleet-inst" key={s.id}>
                            <span className="fleet-inst-role" title="agent role">
                              <Icon name="spinner" size={10} />
                              {s.role ?? "agent"}
                            </span>
                            <span className="fleet-inst-what" title={s.reason || s.harness_state || s.state || ""}>
                              {s.reason || s.harness_state || s.state || "working…"}
                            </span>
                            <span className="fleet-inst-acct">
                              {s.model ?? ""}
                              {s.account_id ? ` · ${accountById[s.account_id] ?? s.account_id}` : ""}
                            </span>
                            <button
                              type="button"
                              className="fleet-watch"
                              onClick={() => { window.location.href = `/cli?session=${encodeURIComponent(s.id)}`; }}
                            >
                              watch <Icon name="arrow" size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title="Orchestrator"
        actions={
          <>
            <Link href="/cli" className="btn ghost">
              Terminal ↗
            </Link>
            <span className="topbar-pill" title="Live agent sessions in this project">
              <span className="pulse-dot" /> {liveSessions.length} live
            </span>
          </>
        }
      />
      {body}
    </div>
  );
}

function Kpi({ label, val, color }: { label: string; val: number; color?: string }) {
  return (
    <div className="fleet-kpi">
      <div className="fleet-kpi-val" style={color ? { color } : undefined}>
        {val}
      </div>
      <div className="fleet-kpi-lbl">{label}</div>
    </div>
  );
}
