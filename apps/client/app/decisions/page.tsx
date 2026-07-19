"use client";

import * as React from "react";
import useSWR, { mutate } from "swr";
import { PageHead } from "@/components/ui";
import { PageEmpty } from "@/components/PageEmpty";
import { DecisionCard } from "@/components/decisions/DecisionCard";
import { DecisionDetail } from "@/components/decisions/DecisionDetail";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import type { BrainNode } from "@/lib/types";

const FILTERS = ["all", "active", "proposed", "superseded"] as const;
type DecFilter = (typeof FILTERS)[number];

function StateMessage({ children }: { children: React.ReactNode }) {
  return <div className="decisions-empty">{children}</div>;
}

export default function DecisionsPage() {
  const { project, loading: projectLoading } = useProject();

  const { data, error, isLoading } = useSWR(
    project ? ["brain-nodes", project.id] : null,
    () => api.brainNodes(project!.id),
  );

  // Edges + tasks power the detail modal's Connections / Linked work. Failures
  // here shouldn't block the list, so we read them loosely (default to []).
  const { data: edgesData } = useSWR(
    project ? ["brain-edges", project.id] : null,
    () => api.brainEdges(project!.id),
  );
  const { data: tasksData } = useSWR(
    project ? ["tasks", project.id] : null,
    () => api.tasks(project!.id),
  );

  // ADRs are not a separate table — they're brain nodes typed "decision".
  const decisions = React.useMemo(
    () => (data?.nodes ?? []).filter((n) => n.type === "decision"),
    [data],
  );

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<DecFilter>("all");

  // Record-decision (real): POST a new type=decision brain node, then revalidate
  // the list so the new ADR appears. Status starts "proposed".
  const [recording, setRecording] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const recordDecision = async () => {
    const label = newLabel.trim();
    if (!label || !project || saving) return;
    setSaving(true);
    try {
      await api.createBrainNode({ project_id: project.id, type: "decision", label, status: "proposed", owner: "You" });
      await mutate(["brain-nodes", project.id]);
      setNewLabel("");
      setRecording(false);
    } finally {
      setSaving(false);
    }
  };

  // Honor a deep link from the brain panel (/decisions#dec-<id>): open that
  // decision's modal once the list has loaded.
  React.useEffect(() => {
    if (!decisions.length) return;
    const hash = window.location.hash;
    const m = hash.match(/^#dec-(.+)$/);
    if (m && decisions.some((d) => d.id === m[1])) setOpenId(m[1]);
  }, [decisions]);

  const openIndex = openId ? decisions.findIndex((d) => d.id === openId) : -1;
  const openNode = openIndex >= 0 ? decisions[openIndex] : null;

  let body: React.ReactNode;
  if (projectLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (!project) {
    body = (
      <StateMessage>
        Select or create a project to see its recorded decisions.
      </StateMessage>
    );
  } else if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>
          Couldn’t load decisions: {String(error.message ?? error)}
        </span>
      </StateMessage>
    );
  } else if (isLoading || !data) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (decisions.length === 0) {
    body = (
      <PageEmpty
        icon="doc" tone="var(--accent)" testid="decisions-empty"
        title="No decisions yet"
        sub="Architecture decisions (ADRs) recorded here keep tasks aligned — and Spade flags changes that conflict with an active decision."
      />
    );
  } else {
    body = (
      <>
        <div className="filter-bar">
          <span>Filter</span>
          <div className="seg" data-testid="dec-filter">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={filter === f ? "on" : ""}
                onClick={() => setFilter(f)}
              >
                {f === "all"
                  ? `All (${decisions.length})`
                  : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="decisions-list">
          {decisions.map((node, i) =>
            filter === "all" || (node.status ?? "proposed") === filter ? (
              <DecisionCard key={node.id} node={node} index={i} onOpen={(n: BrainNode) => setOpenId(n.id)} />
            ) : null,
          )}
        </div>
      </>
    );
  }

  const subtitle = project && data ? `${decisions.length} ADRs` : undefined;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title={
          <>
            Decisions
            {subtitle && (
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                · {subtitle}
              </span>
            )}
          </>
        }
        actions={project ? (
          <button type="button" className="btn" data-testid="record-decision" onClick={() => setRecording((v) => !v)}>
            + New decision
          </button>
        ) : undefined}
      />
      {recording && project && (
        <div className="dec-record" data-testid="dec-record">
          <input
            autoFocus
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && recordDecision()}
            placeholder="Decision title — e.g. Use lazy loading for product carousels"
            aria-label="Decision title"
          />
          <button type="button" className="btn primary" data-testid="record-save" disabled={saving || !newLabel.trim()} onClick={recordDecision}>
            {saving ? "Recording…" : "Record"}
          </button>
          <button type="button" className="btn" onClick={() => { setRecording(false); setNewLabel(""); }}>Cancel</button>
        </div>
      )}
      {body}
      {openNode && (
        <DecisionDetail
          node={openNode}
          index={openIndex}
          nodes={data?.nodes ?? []}
          edges={edgesData?.edges ?? []}
          tasks={tasksData?.tasks ?? []}
          onClose={() => setOpenId(null)}
          onOpenNode={(n) => setOpenId(n.id)}
        />
      )}
    </div>
  );
}
