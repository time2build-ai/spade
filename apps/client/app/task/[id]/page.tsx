"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { PageHead, Priority, Chip, Avatar } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { MetaRow } from "@/components/task/MetaRow";
import { Sparkline } from "@/components/task/Sparkline";
import { api } from "@/lib/api";
import { taskDetailSeed } from "@/lib/demo";

const PRIORITY_LABEL = ["critical", "high", "medium", "low"] as const;

/** Status → dot color, matching the backlog column colors. */
const STATUS_COLOR: Record<string, string> = {
  ready: "var(--text-4)",
  in_progress: "var(--blue)",
  review: "var(--accent)",
  shipped: "var(--green)",
  blocked: "var(--amber)",
};

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 28px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

export default function TaskPage() {
  // Client component dynamic route: read the route id via useParams (simplest
  // per the Next docs for "use client" pages that also need SWR).
  const { id } = useParams<{ id: string }>();

  const {
    data: task,
    error: taskError,
    isLoading: taskLoading,
  } = useSWR(id ? ["task", id] : null, () => api.task(id));

  // Head actions: real status chip + nav to the brain / orchestrator.
  const headerActions = task ? (
    <>
      <span className="chip" data-testid="task-status-chip">
        <span className="d" style={{ background: STATUS_COLOR[task.status] ?? "var(--text-4)" }} />
        {task.status}
      </span>
      <Link href="/brain" className="btn">
        <Icon name="graph" size={13} /> View in graph
      </Link>
      <Link href="/orchestrator" className="btn primary">
        <Icon name="play" size={13} /> Resume pipeline
      </Link>
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
          We couldn’t load <span className="mono">{id}</span>. It may have been
          removed or the id is wrong.
        </div>
      </StateMessage>
    );
  } else {
    const p = Math.min(3, Math.max(0, Math.round(task.priority)));
    const s = taskDetailSeed(task.id);
    const originQuote = task.origin_quote ?? s.quotes[0].q;
    const originSource = task.origin_source ?? "Priya Shah · PM · Sprint Planning · Mar 25";
    body = (
      <div className="task-detail">
        <div className="td-main">
          <div className="td-meta-row">
            <Chip>
              <Priority level={task.priority} style={{ width: 6, height: 6 }} />
              P{p} {PRIORITY_LABEL[p]}
            </Chip>
            {task.feature ? <Chip type="feature">{task.feature}</Chip> : null}
            <span className="muted mono" style={{ fontSize: 11.5 }}>{s.createdFrom}</span>
          </div>
          <h2 className="td-title">{task.title}</h2>

          {/* Origin (real quote/source win) */}
          <div className="origin">
            <h5>Origin</h5>
            <blockquote>“{originQuote}”</blockquote>
            <div className="src">
              <Avatar style={{ width: 18, height: 18, fontSize: 10 }}>PS</Avatar>
              <span>{originSource}</span>
              <span className="chip" style={{ marginLeft: "auto", cursor: "pointer" }} title="Open transcript">↗ transcript</span>
            </div>
          </div>

          {/* User justification — feedback strip + quote cards */}
          <div className="section-h">User justification<span className="count">{s.feedbackCount}</span></div>
          <div className="feedback-strip" data-testid="feedback-strip">
            {s.feedbackStats.map((f, i) => (
              <div className="fb-stat" key={i}>
                <div className="num bad">{f.num}</div>
                <div className="lbl">{f.lbl}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            {s.quotes.map((q, i) => (
              <div className="quote-card" key={i} data-testid="quote-card">
                <div className="q">“{q.q}”</div>
                <div className="src">— {q.src}</div>
              </div>
            ))}
          </div>

          {/* Architectural context */}
          <div className="section-h">Architectural context<span className="count">{s.decisions.length} ADR · 1 convention</span></div>
          {s.decisions.map((d) => (
            <div className="link-row" key={d.id}>
              <span className="lr-icon" style={{ background: "rgba(230,184,106,.12)", color: "var(--amber)" }}>
                <Icon name="doc" size={14} />
              </span>
              <div>
                <div className="lr-title">{d.id} · {d.title}</div>
                <div className="lr-sub">{d.note}</div>
              </div>
              <div className="lr-meta">{d.date}</div>
            </div>
          ))}
          <div className="link-row">
            <span className="lr-icon" style={{ background: "rgba(230,155,182,.12)", color: "var(--pink)" }}>
              <Icon name="link" size={14} />
            </span>
            <div>
              <div className="lr-title">Convention · {s.convention.title}</div>
              <div className="lr-sub">{s.convention.note}</div>
            </div>
            <div className="lr-meta">{s.convention.meta}</div>
          </div>

          {/* Connected bugs */}
          <div className="section-h">Connected bugs<span className="count">{s.bugs.length} likely root-caused by this task</span></div>
          {s.bugs.map((b) => (
            <div className="link-row" key={b.id}>
              <span className="lr-icon" style={{ background: "rgba(232,125,125,.12)", color: "var(--red)" }}>
                <Icon name="flag" size={14} />
              </span>
              <div>
                <div className="lr-title">{b.id} · {b.title}</div>
                <div className="lr-sub">root-causes overlap — would resolve on merge</div>
              </div>
              <div className="lr-meta">auto-linked</div>
            </div>
          ))}

          {/* Pipeline history */}
          <div className="section-h">Pipeline history</div>
          <div className="card" style={{ padding: "14px 16px" }}>
            <div className="timeline">
              {s.pipeline.map((e, i) => (
                <div className={"tl-item" + (e.now ? " now" : "")} key={i}>
                  <div>{e.text}</div>
                  <div className="when">{e.when}</div>
                </div>
              ))}
            </div>
          </div>
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
          <MetaRow label="Assignee">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="avatar ai" style={{ width: 16, height: 16, fontSize: 9 }}>◆</span>
              {s.assignee.name}
            </span>
          </MetaRow>
          <MetaRow label="Sprint"><span className="mono">{s.sprint}</span></MetaRow>
          <MetaRow label="Estimate"><span className="mono">{s.estimate}</span></MetaRow>
          <MetaRow label="Branch"><span className="mono">{s.branch}</span></MetaRow>

          <h6 style={{ marginTop: 22 }}>Tracked metric</h6>
          <div className="card" style={{ padding: "12px 14px" }} data-testid="tracked-metric">
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>{s.metric.value}</div>
              <div className="muted" style={{ fontSize: 11 }}>{s.metric.target}</div>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>{s.metric.label}</div>
            <Sparkline pts={s.metric.series} />
            <div className="mono" style={{ fontSize: 10.5, color: "var(--red)", marginTop: 4 }}>{s.metric.delta}</div>
          </div>

          <h6 style={{ marginTop: 22 }}>Will write back</h6>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>{s.writeBack}</div>
        </aside>
      </div>
    );
  }

  return (
    <div
      className="fade-in"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      {header}
      {body}
    </div>
  );
}

/** Short date, falling back to the raw string if unparseable. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
