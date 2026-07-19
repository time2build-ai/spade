"use client";

import * as React from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { Board } from "@/components/backlog/Board";
import { BlockedBanner } from "@/components/backlog/BlockedBanner";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { indexNodesById, recommendedFirstTask } from "@/lib/adapters";

/** "Start here" hint — the first executable task given the dependency graph. */
function NextUpBanner({ tasks }: { tasks: import("@/lib/types").Task[] }) {
  const first = recommendedFirstTask(tasks);
  if (!first) return null;
  return (
    <div style={{ padding: "10px 22px 0" }}>
      <Link
        href={`/task/${first.id}`}
        className="card"
        data-testid="next-up-banner"
        style={{
          padding: "10px 14px", display: "flex", gap: 12, alignItems: "center",
          textDecoration: "none", color: "inherit",
          borderColor: "rgba(122,209,154,.3)",
          background: "linear-gradient(180deg, rgba(122,209,154,.08), var(--bg-1))",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--green)" }}>▶</span>
        <div style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span className="muted">Start here —</span>
          <b>{first.id}</b>
          <span className="muted">· {first.title}</span>
          <span className="muted">· no open blockers, highest priority</span>
        </div>
        <span className="btn" style={{ marginLeft: "auto" }}>Open task →</span>
      </Link>
    </div>
  );
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 22px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

export default function BacklogPage() {
  const { project, loading: projectLoading } = useProject();

  const {
    data: tasksData,
    error: tasksError,
    isLoading: tasksLoading,
  } = useSWR(project ? ["tasks", project.id] : null, () =>
    api.tasks(project!.id),
  );

  const {
    data: brainData,
    error: brainError,
    isLoading: brainLoading,
  } = useSWR(project ? ["brain", project.id] : null, () =>
    api.brainNodes(project!.id),
  );

  // Task Lifecycle V2 — waiting gates + active runs drive the amber "waiting on
  // you" cards and the env badges. Poll so gate/env changes surface live.
  const { data: gatesData } = useSWR(
    project ? ["lifecycle-gates", project.id] : null,
    () => api.lifecycleGates(project!.id),
    { refreshInterval: 4000 },
  );
  const { data: runsData } = useSWR(
    project ? ["lifecycle-runs", project.id] : null,
    () => api.lifecycleList(project!.id),
    { refreshInterval: 4000 },
  );
  // Per-kind board mapping (kind → phase → column) — threaded into <Board> so it
  // buckets research/docs/code phases into the 5 universal columns. Static, so
  // no refresh interval.
  const { data: templatesData } = useSWR(["lifecycle-templates"], () =>
    api.templates(),
  );

  const gatedTaskIds = React.useMemo(
    () => new Set((gatesData?.gates ?? []).map((g) => g.task_id)),
    [gatesData],
  );
  const runsByTask = React.useMemo(() => {
    const byTask: Record<string, import("@/lib/types").LifecycleRun> = {};
    // list_for_project is newest-first; keep the first (most recent) per task.
    for (const run of runsData?.runs ?? []) {
      if (!byTask[run.task_id]) byTask[run.task_id] = run;
    }
    return byTask;
  }, [runsData]);

  // Board filters: by kind, and a "Waiting on you" view (gated cards only).
  const [kindFilter, setKindFilter] = React.useState<"all" | "code" | "research" | "docs">("all");
  const [waitingOnly, setWaitingOnly] = React.useState(false);
  const [autoTagBusy, setAutoTagBusy] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [filterOpen, setFilterOpen] = React.useState(false);
  const filterRef = React.useRef<HTMLDivElement>(null);
  // Close the filter menu on an outside click.
  React.useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [filterOpen]);

  const allTasks = tasksData?.tasks ?? [];
  const untypedCount = allTasks.filter((t) => t.kind == null).length;
  const q = search.trim().toLowerCase();
  const filteredTasks = allTasks.filter((t) => {
    if (kindFilter !== "all" && (t.kind ?? null) !== kindFilter) return false;
    if (waitingOnly && !gatedTaskIds.has(t.id)) return false;
    if (q && !`${t.id} ${t.title} ${t.feature ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const activeFilters = (kindFilter !== "all" ? 1 : 0) + (waitingOnly ? 1 : 0);

  const autoTag = React.useCallback(async () => {
    if (!project || autoTagBusy) return;
    setAutoTagBusy(true);
    try {
      await api.routeUntyped(project.id);
      mutate(["tasks", project.id]);
    } catch {
      // best-effort backfill; the next tasks poll reconciles.
    } finally {
      setAutoTagBusy(false);
    }
  }, [project, autoTagBusy]);

  const byId = indexNodesById(brainData?.nodes ?? []);
  const error = tasksError || brainError;
  const dataLoading = tasksLoading || brainLoading;

  let body: React.ReactNode;
  if (projectLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (!project) {
    body = (
      <StateMessage>
        Select or create a project to view its backlog.
      </StateMessage>
    );
  } else if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>
          Couldn’t load the backlog: {String(error.message ?? error)}
        </span>
      </StateMessage>
    );
  } else if (dataLoading || !tasksData) {
    body = <StateMessage>Loading…</StateMessage>;
  } else {
    body = (
      <Board
        tasks={filteredTasks}
        nodesById={byId}
        templates={templatesData}
        gatedTaskIds={gatedTaskIds}
        runsByTask={runsByTask}
      />
    );
  }

  // Filter toolbar — kind chips + a "Waiting on you" toggle + "Auto-tag untyped".
  // Icons (spark/search/doc) match the card kind pills; "All" has no icon.
  const KIND_CHIPS: { key: "all" | "code" | "research" | "docs"; label: string; icon?: IconName }[] = [
    { key: "all", label: "All" },
    { key: "code", label: "Code", icon: "spark" },
    { key: "research", label: "Research", icon: "search" },
    { key: "docs", label: "Docs", icon: "doc" },
  ];
  const toolbar =
    project && tasksData ? (
      <div data-testid="board-toolbar" className="board-toolbar">
        {/* Live search — matches title / id / feature. */}
        <div className="board-search">
          <Icon name="search" size={14} />
          <input
            data-testid="board-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks by title, id, or feature…"
          />
          {search && (
            <button type="button" className="board-search-clear" aria-label="Clear search" onClick={() => setSearch("")}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>

        {/* Filter menu — kind (single) + waiting-on-you. */}
        <div className="board-filter-wrap" ref={filterRef}>
          <button
            type="button" data-testid="filter-menu-btn"
            className={"btn board-filter-btn" + (activeFilters ? " on" : "")}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <Icon name="tasks" size={13} /> Filter{activeFilters ? ` · ${activeFilters}` : ""}
            <Icon name="chev" size={12} />
          </button>
          {filterOpen && (
            <div className="board-filter-menu" data-testid="filter-menu">
              <div className="bfm-h">Kind</div>
              {KIND_CHIPS.map((c) => (
                <button
                  key={c.key} type="button"
                  data-testid={`kind-filter-${c.key}`}
                  className={"bfm-row" + (kindFilter === c.key ? " on" : "")}
                  onClick={() => setKindFilter(c.key)}
                >
                  <span className="bfm-radio" />
                  {c.icon && <Icon name={c.icon} size={13} />}
                  {c.label}
                </button>
              ))}
              <div className="bfm-div" />
              <button
                type="button" data-testid="waiting-toggle"
                className={"bfm-row" + (waitingOnly ? " on" : "")}
                onClick={() => setWaitingOnly((v) => !v)}
              >
                <span className="bfm-check" />
                <Icon name="gate" size={13} /> Waiting on you{gatedTaskIds.size ? ` (${gatedTaskIds.size})` : ""}
              </button>
            </div>
          )}
        </div>

        {untypedCount > 0 && (
          <button
            type="button"
            data-testid="auto-tag-untyped"
            onClick={autoTag}
            disabled={autoTagBusy}
            className="btn"
            style={{ marginLeft: "auto" }}
            title="Apply the router’s suggested kind to every untyped task at once, instead of confirming each card."
          >
            {autoTagBusy ? "Classifying…" : `Classify ${untypedCount} untyped`}
          </button>
        )}
      </div>
    ) : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title="Backlog"
        actions={
          // No-fabrication: only "Run sprint" is wired (navigates to the
          // orchestrator). Reference's Filter / Suggest-priority need real
          // filtering / an AI action we don't have yet — deferred.
          <Link href="/orchestrator" className="btn primary">
            <Icon name="play" size={13} /> Run sprint
          </Link>
        }
      />
      {tasksData && <NextUpBanner tasks={tasksData.tasks} />}
      {tasksData && <BlockedBanner tasks={tasksData.tasks} />}
      {toolbar}
      {body}
    </div>
  );
}
