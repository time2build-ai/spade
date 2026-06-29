"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";

export default function GatePage() {
  const { project } = useProject();
  const { data, mutate } = useSWR("brakes", () => api.brakes(), { refreshInterval: 4000 });
  const brake = data?.brakes?.[0] ?? null;

  // Real conflict (proposed vs active decision) from the brain drives the two
  // conflict panels when present.
  const { data: conflictData } = useSWR(
    project ? ["gate-conflict", project.id] : null,
    () => api.gateConflict(project!.id),
  );
  const rc = conflictData?.conflict ?? null;

  const approve = async () => { if (brake) { await api.allowBrake(brake.id); await mutate(); } };
  const reject = async () => { if (brake) { await api.skipBrake(brake.id); await mutate(); } };

  // Honest empty state — nothing is waiting on a human.
  if (!brake) {
    return (
      <div className="fade-in" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <PageHead title="Human gate" />
        <div
          className="muted"
          style={{ margin: "auto", textAlign: "center", fontSize: 13, color: "var(--text-3)", padding: "40px 22px" }}
        >
          No human gates right now.
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead actions={
        <button type="button" className="btn" onClick={reject}>Skip & continue sprint</button>
      }>
        <div className="breadcrumb">Orchestrator / <b>Human gate</b></div>
      </PageHead>

      <div className="gate-wrap" data-testid="gate-conflict">
        <div className="gate-banner">
          <div className="gicon"><Icon name="gate" size={20} /></div>
          <div>
            <h2>The orchestrator paused this pipeline</h2>
            <p>A worker is waiting on a human call before continuing.</p>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={reject}>Reject change</button>
            <button type="button" className="btn primary" onClick={approve}>
              <Icon name="check" size={13} /> Approve &amp; resume
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
          <div className="card" style={{ padding: "14px 16px" }}>
            <div className="muted" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 6 }}>Task</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>{brake.mission}</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              {brake.worker && <>Developer session <span className="mono" style={{ color: "var(--text-2)" }}>{brake.worker}</span> </>}
              {brake.detail}
            </div>
          </div>
          <div className="card" style={{ padding: "14px 16px" }}>
            <div className="muted" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 6 }}>Why we paused</div>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>{brake.brake}</div>
          </div>
        </div>

        {rc ? (
          <div className="conflict card" data-testid="gate-conflict-panels">
            <div className="panel left">
              <h6>Existing decision</h6>
              <h3 data-testid="conflict-existing">{rc.existing.label}</h3>
              {rc.existing.detail && <div className="quote">“{rc.existing.detail}”</div>}
              {rc.existing.owner && <div className="muted" style={{ fontSize: 12 }}>— {rc.existing.owner}</div>}
            </div>
            <div className="arrow">⇄</div>
            <div className="panel right">
              <h6>Proposed change</h6>
              <h3 data-testid="conflict-proposed">{rc.proposed.label}</h3>
              {rc.proposed.detail && <div className="quote">“{rc.proposed.detail}”</div>}
              {rc.proposed.owner && <div className="muted" style={{ fontSize: 12 }}>— {rc.proposed.owner}</div>}
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: "14px 16px" }} data-testid="gate-no-conflict">
            <div className="muted" style={{ fontSize: 13 }}>No recorded decision conflict for this gate.</div>
          </div>
        )}
      </div>
    </div>
  );
}
