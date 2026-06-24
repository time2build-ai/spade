"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { PageHead, Priority, Chip } from "@/components/ui";
import { OriginCard } from "@/components/task/OriginCard";
import { EvidenceSection } from "@/components/task/EvidenceSection";
import { MetaRow } from "@/components/task/MetaRow";
import { TimelineRail } from "@/components/task/TimelineRail";
import { Relations } from "@/components/task/Relations";
import { api } from "@/lib/api";
import { groupNodesByType, indexNodesById, resolveNodes } from "@/lib/adapters";

const PRIORITY_LABEL = ["critical", "high", "medium", "low"] as const;

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

  const { data: brain } = useSWR(
    task ? ["brain", task.project_id] : null,
    () => api.brainNodes(task!.project_id),
  );

  const { data: commentsData } = useSWR(id ? ["comments", id] : null, () =>
    api.comments(id),
  );

  const byId = indexNodesById(brain?.nodes ?? []);
  const grouped = groupNodesByType(resolveNodes(task?.nodes ?? [], byId));

  const header = (
    <PageHead>
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
    body = (
      <div className="task-detail">
        <div className="td-main">
          <div className="td-meta-row">
            <Chip>
              <Priority level={task.priority} style={{ width: 6, height: 6 }} />
              P{p} {PRIORITY_LABEL[p]}
            </Chip>
            {task.feature ? (
              <Chip type="feature">{task.feature}</Chip>
            ) : null}
            <span className="muted mono" style={{ fontSize: 11.5 }}>
              {task.id}
            </span>
          </div>
          <h2 className="td-title">{task.title}</h2>

          <OriginCard task={task} />

          <EvidenceSection
            title="Decisions"
            type="decision"
            nodes={grouped.decision}
          />
          <EvidenceSection title="Bugs" type="bug" nodes={grouped.bug} />
          <EvidenceSection
            title="Feedback"
            type="feedback"
            nodes={grouped.feedback}
          />
          <EvidenceSection
            title="Metrics"
            type="metric"
            nodes={grouped.metric}
          />
          <EvidenceSection
            title="Conventions"
            type="convention"
            nodes={grouped.convention}
          />
          <EvidenceSection
            title="Features"
            type="feature"
            nodes={grouped.feature}
          />

          <Relations taskId={task.id} links={task.links ?? []} />
        </div>

        <aside className="td-side">
          <h6>Properties</h6>
          <MetaRow label="ID">
            <span className="mono">{task.id}</span>
          </MetaRow>
          <MetaRow label="Feature">
            {task.feature ? (
              <span style={{ color: "var(--accent)" }}>{task.feature}</span>
            ) : (
              <span className="muted">—</span>
            )}
          </MetaRow>
          <MetaRow label="Priority">
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Priority level={task.priority} />P{p} {PRIORITY_LABEL[p]}
            </span>
          </MetaRow>
          <MetaRow label="Status">{task.status}</MetaRow>
          <MetaRow label="Created">
            <span className="mono">{formatDate(task.created_at)}</span>
          </MetaRow>

          <h6 style={{ marginTop: 22 }}>Activity</h6>
          <TimelineRail comments={commentsData?.comments ?? []} />
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
