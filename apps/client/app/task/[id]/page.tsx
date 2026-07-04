"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR, { mutate } from "swr";
import { PageHead, Priority, Chip } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { MetaRow } from "@/components/task/MetaRow";
import { Markdown } from "@/components/ask/Markdown";
import { api } from "@/lib/api";
import type { BrainNode } from "@/lib/types";

const PRIORITY_LABEL = ["critical", "high", "medium", "low"] as const;

/** Status → dot color, matching the backlog column colors. */
const STATUS_COLOR: Record<string, string> = {
  ready: "var(--text-4)",
  // Task Lifecycle V2 phases (code).
  shaping: "var(--pink)",
  plan_review: "var(--amber)",
  building: "var(--blue)",
  pr_review: "var(--accent)",
  shipped: "var(--green)",
  // Task-Type Router per-kind phases (research + docs).
  scoping: "var(--amber)",
  investigating: "var(--blue)",
  synthesis: "var(--accent)",
  outline: "var(--amber)",
  drafting: "var(--blue)",
  review: "var(--accent)",
  delivered: "var(--green)",
  blocked: "var(--amber)",
};

/** Kind badge glyph + label (✨ code · 🔬 research · 📄 docs). */
const KIND_BADGE: Record<string, { icon: string; label: string }> = {
  code: { icon: "✨", label: "Code" },
  research: { icon: "🔬", label: "Research" },
  docs: { icon: "📄", label: "Docs" },
};

const REL_LABEL: Record<string, string> = {
  blocks: "blocks",
  blocked_by: "blocked by",
  related: "related to",
  subtask: "subtask of",
};

/** Human labels for every lifecycle gate (code + research + docs). */
const GATE_LABEL: Record<string, string> = {
  plan: "Plan review",
  manual_test: "Manual test",
  merge: "Merge approval",
  // Research + docs gates.
  scope: "Scope review",
  outline: "Outline review",
  review: "Review",
};

/** Human labels for every artifact kind (drives the Artifacts panel). */
const ARTIFACT_LABEL: Record<string, string> = {
  spec: "Spec",
  plan: "Plan",
  test_guide: "Test guide",
  review_report: "Review report",
  // Research + docs artifact kinds.
  finding: "Finding",
  report: "Report",
  outline: "Outline",
  doc: "Document",
};

/** Icon + accent for each lifecycle comment kind on the timeline. */
const KIND_META: Record<string, { icon: import("@/components/Icon").IconName; color: string }> = {
  gate: { icon: "gate", color: "var(--amber)" },
  test_report: { icon: "check", color: "var(--green)" },
  review: { icon: "doc", color: "var(--accent)" },
  artifact: { icon: "doc", color: "var(--blue)" },
  progress: { icon: "spark", color: "var(--teal)" },
};

/** A linked brain node → its record page. */
function nodeHref(n: BrainNode): string {
  return n.type === "decision" ? `/decisions#dec-${n.id}` : `/brain?node=${n.id}`;
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 28px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

/** A grouped section of linked records ("Architectural context", "Connected bugs"…). */
function LinkSection({
  title, count, items, tint, icon,
}: {
  title: string;
  count: string;
  items: { id: string; title: string; sub?: string | null; href: string }[];
  tint: { bg: string; fg: string };
  icon: string;
}) {
  if (!items.length) return null;
  return (
    <>
      <div className="section-h">{title}<span className="count">{count}</span></div>
      {items.map((it) => (
        <Link className="link-row" key={it.id} href={it.href} style={{ textDecoration: "none", color: "inherit" }} data-testid="td-link-row">
          <span className="lr-icon" style={{ background: tint.bg, color: tint.fg }}>
            <Icon name={icon as never} size={14} />
          </span>
          <div>
            <div className="lr-title">{it.title}</div>
            {it.sub ? <div className="lr-sub">{it.sub}</div> : null}
          </div>
        </Link>
      ))}
    </>
  );
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();

  const { data: task, error: taskError, isLoading: taskLoading } =
    useSWR(id ? ["task", id] : null, () => api.task(id));

  // Real linked records: resolve the task's brain-node ids against the project's
  // node list, pull the project's pipelines (filtered to this task), and the task
  // list (to label task→task links).
  const { data: nodesData } = useSWR(task ? ["brain", task.project_id] : null, () => api.brainNodes(task!.project_id));
  const { data: pipeData } = useSWR(task ? ["pipelines", task.project_id] : null, () => api.pipelines(task!.project_id));
  const { data: tasksData } = useSWR(task ? ["tasks", task.project_id] : null, () => api.tasks(task!.project_id));
  const { data: commentsData } = useSWR(task ? ["comments", task.id] : null, () => api.comments(task!.id));

  // Task Lifecycle V2 — artifacts pinned to the task, plus the task's active run
  // and any waiting gate. Poll so gate/phase transitions surface live.
  const { data: artifactsData } = useSWR(
    task ? ["artifacts", task.id] : null,
    () => api.artifacts(task!.id),
    { refreshInterval: 5000 },
  );
  const { data: lifeRunsData } = useSWR(
    task ? ["lifecycle-runs", task.project_id] : null,
    () => api.lifecycleList(task!.project_id),
    { refreshInterval: 4000 },
  );
  const { data: lifeGatesData } = useSWR(
    task ? ["lifecycle-gates", task.project_id] : null,
    () => api.lifecycleGates(task!.project_id),
    { refreshInterval: 4000 },
  );

  const lifecycleRun = React.useMemo(
    () => (lifeRunsData?.runs ?? []).find((r) => r.task_id === (task?.id ?? "")) ?? null,
    [lifeRunsData, task],
  );
  const waitingGate = React.useMemo(
    () => (lifeGatesData?.gates ?? []).find((g) => g.task_id === (task?.id ?? "")) ?? null,
    [lifeGatesData, task],
  );

  const [starting, setStarting] = React.useState(false);
  const [startErr, setStartErr] = React.useState<string | null>(null);
  const [openArtifact, setOpenArtifact] = React.useState<import("@/lib/types").Artifact | null>(null);
  // Gate action bar state (comment box + in-flight decision).
  const [gateComment, setGateComment] = React.useState("");
  const [gateBusy, setGateBusy] = React.useState(false);
  const [gateErr, setGateErr] = React.useState<string | null>(null);

  // Is a lifecycle already running on this task? Drives the Start button state.
  const hasLifecycle = !!lifecycleRun && lifecycleRun.active === 1;

  // Kick off the brainstorm→ship lifecycle (shaping agent, worktree, gates), then
  // stay on the task — the polling SWRs surface the run/gate as it advances.
  const startLifecycle = React.useCallback(async () => {
    if (!task || starting) return;
    setStartErr(null);
    setStarting(true);
    try {
      await api.startLifecycle(task.project_id, task.id);
      mutate(["lifecycle-runs", task.project_id]);
      mutate(["lifecycle-gates", task.project_id]);
      mutate(["task", task.id]);
      mutate(["comments", task.id]);
    } catch (e) {
      setStartErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [task, starting]);

  // Approve / request-changes the waiting gate, then revalidate the run + gate +
  // timeline so the phase transition shows immediately.
  const decideGate = React.useCallback(
    async (decision: "approve" | "request-changes") => {
      if (!task || !waitingGate || gateBusy) return;
      if (decision === "request-changes" && !gateComment.trim()) {
        setGateErr("Add a comment so the agent knows what to change.");
        return;
      }
      setGateBusy(true);
      setGateErr(null);
      try {
        if (decision === "approve") {
          await api.approveGate(task.id, waitingGate.gate, gateComment.trim() || undefined);
        } else {
          await api.requestGateChanges(task.id, waitingGate.gate, gateComment.trim());
        }
        setGateComment("");
        mutate(["lifecycle-gates", task.project_id]);
        mutate(["lifecycle-runs", task.project_id]);
        mutate(["comments", task.id]);
        mutate(["task", task.id]);
      } catch (e) {
        setGateErr(e instanceof Error ? e.message : String(e));
      } finally {
        setGateBusy(false);
      }
    },
    [task, waitingGate, gateComment, gateBusy],
  );

  const headerActions = task ? (
    <>
      <span className="chip" data-testid="task-status-chip">
        <span className="d" style={{ background: STATUS_COLOR[task.status] ?? "var(--text-4)" }} />
        {task.status}
      </span>
      {task.kind && KIND_BADGE[task.kind] && (
        <span className="chip" data-testid="task-kind-chip" title={KIND_BADGE[task.kind].label}>
          <span aria-hidden style={{ marginRight: 3 }}>{KIND_BADGE[task.kind].icon}</span>
          {KIND_BADGE[task.kind].label}
        </span>
      )}
      <Link href="/brain" className="btn">
        <Icon name="graph" size={13} /> View in graph
      </Link>
      <button type="button" className="btn primary" data-testid="start-lifecycle" onClick={startLifecycle} disabled={starting || hasLifecycle}>
        <Icon name="play" size={13} /> {starting ? "Starting…" : hasLifecycle ? `Lifecycle · ${lifecycleRun!.phase}` : "Start lifecycle"}
      </button>
    </>
  ) : undefined;

  const header = (
    <PageHead actions={headerActions}>
      <div className="breadcrumb">
        <Link href="/backlog">Backlog</Link> / <b>{id ?? "…"}</b>
      </div>
    </PageHead>
  );

  let body: React.ReactNode;
  if (taskLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (taskError || !task) {
    body = (
      <StateMessage>
        <strong style={{ color: "var(--text-2)" }}>Task not found</strong>
        <div style={{ marginTop: 6 }}>
          We couldn’t load <span className="mono">{id}</span>. It may have been removed or the id is wrong.
        </div>
      </StateMessage>
    );
  } else {
    const p = Math.min(3, Math.max(0, Math.round(task.priority)));

    const byId = new Map((nodesData?.nodes ?? []).map((n) => [n.id, n] as const));
    const linked = task.nodes.map((nid) => byId.get(nid)).filter((n): n is BrainNode => !!n);
    const decisions = linked.filter((n) => n.type === "decision" || n.type === "convention");
    const bugs = linked.filter((n) => n.type === "bug");
    const features = linked.filter((n) => n.type === "feature");
    const metrics = linked.filter((n) => n.type === "metric");

    const taskTitle = new Map((tasksData?.tasks ?? []).map((t) => [t.id, t.title] as const));
    const links = task.links.map((l) => {
      const otherId = l.from_task === task.id ? l.to_task : l.from_task;
      const rel = l.from_task === task.id ? l.rel : (l.rel === "blocks" ? "blocked_by" : l.rel);
      return { id: l.id, otherId, rel, title: taskTitle.get(otherId) ?? otherId };
    });

    const pipelines = (pipeData?.pipelines ?? []).filter((pl) => pl.task_id === task.id);
    const hasLinks = decisions.length || bugs.length || features.length || metrics.length || links.length;

    body = (
      <div className="task-detail">
        <div className="td-main">
          {startErr && (
            <div data-testid="run-error" style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(238,136,136,.4)", background: "rgba(238,136,136,.06)", color: "var(--red)", fontSize: 12.5 }}>
              Couldn’t start the lifecycle: {startErr}. Make sure this project has a configured repo (Settings → Repository) and a connected account.
            </div>
          )}

          {/* Gate action bar — a waiting human gate on this task's lifecycle run. */}
          {waitingGate && (
            <div
              data-testid="gate-bar"
              style={{
                marginBottom: 14, padding: "12px 14px", borderRadius: 10,
                border: "1px solid rgba(230,184,106,.4)",
                background: "linear-gradient(180deg, rgba(230,184,106,.10), var(--bg-1))",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ display: "inline-flex", color: "var(--amber)" }}><Icon name="gate" size={16} /></span>
                <b style={{ fontSize: 13 }}>{GATE_LABEL[waitingGate.gate] ?? waitingGate.gate} gate</b>
                <span className="muted" style={{ fontSize: 12 }}>· waiting on your call</span>
              </div>
              <textarea
                data-testid="gate-comment"
                aria-label="Gate decision comment"
                value={gateComment}
                onChange={(e) => setGateComment(e.target.value)}
                placeholder="Add a comment (required to request changes)…"
                rows={2}
                style={{ width: "100%", resize: "vertical", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-2)", color: "inherit", marginBottom: 8 }}
              />
              {gateErr && <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 8 }}>{gateErr}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn primary" data-testid="gate-approve" disabled={gateBusy} onClick={() => decideGate("approve")}>
                  <Icon name="check" size={13} /> Approve
                </button>
                <button type="button" className="btn" data-testid="gate-request-changes" disabled={gateBusy} onClick={() => decideGate("request-changes")}>
                  Request changes
                </button>
              </div>
            </div>
          )}
          <div className="td-meta-row">
            <Chip>
              <Priority level={task.priority} style={{ width: 6, height: 6 }} />
              P{p} {PRIORITY_LABEL[p]}
            </Chip>
            {task.feature ? <Chip type="feature">{task.feature}</Chip> : null}
            <span className="muted mono" style={{ fontSize: 11.5 }}>created {formatDate(task.created_at)}</span>
          </div>
          <h2 className="td-title">{task.title}</h2>

          {/* Description (real) */}
          {task.description ? (
            <div className="origin" style={{ marginTop: 14 }}>
              <h5>Description</h5>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-2)" }}>{task.description}</div>
            </div>
          ) : null}

          {/* Origin (real quote/source) */}
          {task.origin_quote ? (
            <div className="origin">
              <h5>Origin</h5>
              <blockquote>“{task.origin_quote}”</blockquote>
              {task.origin_source ? (
                <div className="src">
                  <Icon name="mic" size={13} />
                  <span>{task.origin_source}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Linked records (real brain nodes + task links) */}
          <LinkSection
            title="Architectural context" count={`${decisions.length} linked`}
            items={decisions.map((n) => ({ id: n.id, title: `${n.type === "convention" ? "Convention" : "Decision"} · ${n.label}`, sub: n.detail?.split("\n")[0] ?? null, href: nodeHref(n) }))}
            tint={{ bg: "rgba(230,184,106,.12)", fg: "var(--amber)" }} icon="doc"
          />
          <LinkSection
            title="Connected bugs" count={`${bugs.length} linked`}
            items={bugs.map((n) => ({ id: n.id, title: n.label, sub: n.detail?.split("\n")[0] ?? null, href: nodeHref(n) }))}
            tint={{ bg: "rgba(232,125,125,.12)", fg: "var(--red)" }} icon="flag"
          />
          <LinkSection
            title="Tracked metrics" count={`${metrics.length} linked`}
            items={metrics.map((n) => ({ id: n.id, title: n.label, sub: n.detail?.split("\n")[0] ?? null, href: nodeHref(n) }))}
            tint={{ bg: "rgba(122,162,247,.12)", fg: "var(--blue)" }} icon="graph"
          />
          <LinkSection
            title="Features" count={`${features.length} linked`}
            items={features.map((n) => ({ id: n.id, title: n.label, sub: n.detail?.split("\n")[0] ?? null, href: nodeHref(n) }))}
            tint={{ bg: "rgba(201,184,255,.12)", fg: "var(--accent)" }} icon="spark"
          />

          {/* Dependencies (real task→task links) */}
          {links.length ? (
            <>
              <div className="section-h">Dependencies<span className="count">{links.length} linked</span></div>
              {links.map((l) => (
                <Link className="link-row" key={l.id} href={`/task/${l.otherId}`} style={{ textDecoration: "none", color: "inherit" }} data-testid="td-link-row">
                  <span className="lr-icon" style={{ background: "rgba(230,155,182,.12)", color: "var(--pink)" }}>
                    <Icon name="link" size={14} />
                  </span>
                  <div>
                    <div className="lr-title">{l.otherId} · {l.title}</div>
                    <div className="lr-sub">{REL_LABEL[l.rel] ?? l.rel}</div>
                  </div>
                </Link>
              ))}
            </>
          ) : null}

          {!hasLinks ? (
            <>
              <div className="section-h">Linked records<span className="count">none yet</span></div>
              <div className="muted" style={{ fontSize: 12.5, padding: "2px 2px 8px" }}>
                No decisions, bugs, metrics or dependencies are grounded to this task yet. As you and the orchestrator work it, links show up here.
              </div>
            </>
          ) : null}

          {/* Deliverables & artifacts. Docs render as a styled, sandboxed doc
              (shareable /api/doc/{id}); research findings group under the report;
              everything else opens a markdown drawer. */}
          {(() => {
            const arts = artifactsData?.artifacts ?? [];
            const docs = arts.filter((a) => a.kind === "doc");
            const reports = arts.filter((a) => a.kind === "report");
            const findings = arts.filter((a) => a.kind === "finding");
            const order = ["spec", "plan", "test_guide", "review_report", "outline"];
            const others = arts
              .filter((a) => !["doc", "report", "finding"].includes(a.kind))
              .sort((a, b) => (order.indexOf(a.kind) + 1 || 99) - (order.indexOf(b.kind) + 1 || 99));

            const ArtifactRow = ({ a, nested }: { a: import("@/lib/types").Artifact; nested?: boolean }) => (
              <button
                type="button"
                className="link-row"
                key={a.id}
                data-testid="artifact-row"
                data-kind={a.kind}
                onClick={() => setOpenArtifact(a)}
                style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", font: "inherit", color: "inherit", paddingLeft: nested ? 22 : undefined }}
              >
                <span className="lr-icon" style={{ background: "rgba(122,162,247,.12)", color: "var(--blue)" }}>
                  <Icon name="doc" size={14} />
                </span>
                <div>
                  <div className="lr-title">{ARTIFACT_LABEL[a.kind] ?? a.kind}{a.title ? ` · ${a.title}` : ""}</div>
                  <div className="lr-sub mono">{a.repo_path ?? "inline"}</div>
                </div>
              </button>
            );

            return (
              <>
                <div className="section-h">Artifacts{arts.length ? <span className="count">{arts.length} pinned</span> : null}</div>

                {/* Doc deliverables — styled, sandboxed, shareable. */}
                {docs.map((a) => (
                  <DocDeliverable key={a.id} artifact={a} />
                ))}

                {/* Research report with its per-angle findings grouped beneath. */}
                {reports.map((r) => (
                  <div key={r.id} data-testid="report-group">
                    <ArtifactRow a={r} />
                    {findings.length > 0 && (
                      <div data-testid="findings-group">
                        {findings.map((f) => (
                          <ArtifactRow key={f.id} a={f} nested />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {/* Findings with no report yet (mid fan-out) still render. */}
                {reports.length === 0 && findings.length > 0 && (
                  <div data-testid="findings-group">
                    {findings.map((f) => (
                      <ArtifactRow key={f.id} a={f} />
                    ))}
                  </div>
                )}

                {others.length > 0 && (
                  <div data-testid="artifacts-panel">
                    {others.map((a) => (
                      <ArtifactRow key={a.id} a={a} />
                    ))}
                  </div>
                )}

                {arts.length === 0 && (
                  <div className="muted" style={{ fontSize: 12.5, padding: "2px 2px 8px" }}>
                    No artifacts yet. As the lifecycle shapes, plans, and reviews this task, its documents show up here.
                  </div>
                )}
              </>
            );
          })()}

          {/* Pipeline history (real runs + each stage's finished report) */}
          {(() => {
            const activity = commentsData?.comments ?? [];
            if (!pipelines.length && !activity.length) {
              return (
                <>
                  <div className="section-h">Pipeline history</div>
                  <div className="muted" style={{ fontSize: 12.5, padding: "2px 2px" }}>
                    Not run yet. Use “Start pipeline” to put the developer → reviewer → integrator flow on it.
                  </div>
                </>
              );
            }
            return (
              <>
                <div className="section-h">Pipeline history{activity.length ? <span className="count">{activity.length} notes</span> : null}</div>
                {pipelines.length ? (
                  <div className="card" style={{ padding: "14px 16px", marginBottom: 10 }}>
                    <div className="timeline">
                      {pipelines.map((pl) => (
                        <div className={"tl-item" + (pl.status === "running" ? " now" : "")} key={pl.id}>
                          <div>{pl.status === "running" ? "Running" : pl.status} · {(pl.stages ?? []).map((st) => st.role).join(" → ") || "pipeline"}</div>
                          <div className="when mono">{typeof pl.progress === "number" ? `${pl.progress}%` : ""}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {activity.map((c) => {
                  const meta = KIND_META[c.kind];
                  return (
                    <div className="td-act" key={c.id} data-testid="pipeline-note" data-kind={c.kind}>
                      <div className="td-act-h">
                        {meta && (
                          <span data-testid="note-kind-icon" style={{ display: "inline-flex", alignItems: "center", color: meta.color, marginRight: 2 }}>
                            <Icon name={meta.icon} size={13} />
                          </span>
                        )}
                        <span className={"td-act-who" + (c.author === "system" ? " sys" : "")}>{c.author ?? "system"}</span>
                        {meta && <span className="chip" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>{c.kind.replace(/_/g, " ")}</span>}
                        <span className="td-act-when mono">{formatDate(c.created_at)}</span>
                      </div>
                      <div className="td-act-body"><Markdown>{c.body}</Markdown></div>
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>

        <aside className="td-side">
          <h6>Properties</h6>
          <MetaRow label="Status">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[task.status] ?? "var(--text-4)" }} />
              {task.status}
            </span>
          </MetaRow>
          <MetaRow label="Priority">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Priority level={task.priority} />P{p} · {PRIORITY_LABEL[p]}
            </span>
          </MetaRow>
          <MetaRow label="Feature">
            {task.feature ? <span style={{ color: "var(--accent)" }}>{task.feature}</span> : <span className="muted">—</span>}
          </MetaRow>
          <MetaRow label="Created"><span className="mono">{formatDate(task.created_at)}</span></MetaRow>
          <MetaRow label="Task id"><span className="mono">{task.id}</span></MetaRow>

          <h6 style={{ marginTop: 22 }}>Linked records</h6>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            {linked.length} brain node{linked.length === 1 ? "" : "s"} · {links.length} task link{links.length === 1 ? "" : "s"}
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {header}
      {body}
      {task && openArtifact && (
        <ArtifactDrawer taskId={task.id} artifact={openArtifact} onClose={() => setOpenArtifact(null)} />
      )}
    </div>
  );
}

/** Split a test-guide markdown body into numbered steps (list items). Falls back
 *  to an empty list when the body isn't obviously a checklist. */
const STEP_MARKER = /^\s*(\d+[.)]|[-*+]|\[[ xX]\])\s+/;

function parseSteps(content: string): string[] {
  // Only real list/numbered lines become checklist steps — prose paragraphs in
  // the guide stay out of the step list (they render via the markdown fallback).
  return content
    .split("\n")
    .filter((l) => STEP_MARKER.test(l))
    .map((l) => l.replace(STEP_MARKER, "").trim())
    .filter((l) => l.length > 0);
}

/** Right-side drawer rendering an artifact's markdown. The test guide gets the
 *  kid-simple treatment: big numbered steps, tickable checkboxes, print button. */
function ArtifactDrawer({
  taskId, artifact, onClose,
}: {
  taskId: string;
  artifact: import("@/lib/types").Artifact;
  onClose: () => void;
}) {
  const { data, error, isLoading } = useSWR(
    ["artifact-content", taskId, artifact.id],
    () => api.artifactContent(taskId, artifact.id),
  );
  const [checked, setChecked] = React.useState<Record<number, boolean>>({});
  const isTestGuide = artifact.kind === "test_guide";
  const content = data?.content ?? "";
  const steps = isTestGuide ? parseSteps(content) : [];

  // Escape closes the drawer (basic modal a11y).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = `${ARTIFACT_LABEL[artifact.kind] ?? artifact.kind}${artifact.title ? ` · ${artifact.title}` : ""}`;

  return (
    <div
      data-testid="artifact-drawer"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.4)", display: "flex", justifyContent: "flex-end" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 92vw)", height: "100%", background: "var(--bg-1)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ display: "inline-flex", color: "var(--blue)" }}><Icon name="doc" size={16} /></span>
          <b style={{ fontSize: 14, flex: 1 }}>{ARTIFACT_LABEL[artifact.kind] ?? artifact.kind}{artifact.title ? ` · ${artifact.title}` : ""}</b>
          {isTestGuide && (
            <button type="button" className="btn" data-testid="artifact-print" onClick={() => window.print()}>
              Print
            </button>
          )}
          <button type="button" className="btn" data-testid="artifact-close" onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: "18px 22px", overflow: "auto", flex: 1 }}>
          {isLoading && <div className="muted" style={{ fontSize: 13 }}>Loading…</div>}
          {error && <div style={{ color: "var(--red)", fontSize: 13 }}>Couldn’t load this artifact: {String((error as Error).message ?? error)}</div>}
          {!isLoading && !error && (
            isTestGuide && steps.length ? (
              <ol data-testid="test-guide-steps" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {steps.map((step, i) => (
                  <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 15, lineHeight: 1.5 }}>
                    <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        data-testid="test-guide-checkbox"
                        checked={!!checked[i]}
                        onChange={() => setChecked((p) => ({ ...p, [i]: !p[i] }))}
                        style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0 }}
                      />
                      <span>
                        <b style={{ color: "var(--accent)", marginRight: 8 }}>Step {i + 1}</b>
                        <span style={{ textDecoration: checked[i] ? "line-through" : "none", opacity: checked[i] ? 0.6 : 1 }}>{step}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ol>
            ) : (
              <div style={{ fontSize: 13, lineHeight: 1.6 }}><Markdown>{content}</Markdown></div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** A `doc` deliverable — the styled document rendered in a LOCKED sandbox iframe
 *  (no allow-scripts; the doc is static HTML + inline SVG, and the server sends a
 *  restrictive CSP). Points at the shareable `/api/doc/{id}` route with an
 *  Open-in-new-tab + Share-link affordance. */
function DocDeliverable({ artifact }: { artifact: import("@/lib/types").Artifact }) {
  const url = api.docUrl(artifact.id);
  const label = `${ARTIFACT_LABEL[artifact.kind] ?? artifact.kind}${artifact.title ? ` · ${artifact.title}` : ""}`;
  return (
    <div data-testid="doc-deliverable" data-kind="doc" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ display: "inline-flex", color: "var(--blue)" }}><Icon name="doc" size={16} /></span>
        <b style={{ fontSize: 13, flex: 1 }}>{label}</b>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn"
          data-testid="doc-open"
          style={{ padding: "3px 10px", fontSize: 12, textDecoration: "none" }}
        >
          Open / Print ↗
        </a>
        <a
          href={url}
          data-testid="doc-share-link"
          className="btn"
          style={{ padding: "3px 10px", fontSize: 12, textDecoration: "none" }}
        >
          Share link
        </a>
      </div>
      <iframe
        data-testid="doc-iframe"
        title={label}
        src={url}
        sandbox=""
        style={{ width: "100%", height: 520, border: "1px solid var(--border)", borderRadius: 10, background: "#fff" }}
      />
    </div>
  );
}

/** Short date, falling back to the raw string if unparseable. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
