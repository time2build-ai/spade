"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { DEMO_GATE } from "@/lib/demo";

function SignalCard({ label, big, sub, color }: { label: string; big: string; sub: string; color: string }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }} data-testid="signal-card">
      <div className="muted" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4, color }}>{big}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export default function GatePage() {
  const { project } = useProject();
  const { data, mutate } = useSWR("brakes", () => api.brakes(), { refreshInterval: 4000 });
  const brake = data?.brakes?.[0] ?? null;
  const g = DEMO_GATE;

  // Real-wins: a real conflict (proposed vs active decision) from the brain drives
  // the two conflict panels; the seed fills the diff/signals (no real source yet).
  const { data: conflictData } = useSWR(
    project ? ["gate-conflict", project.id] : null,
    () => api.gateConflict(project!.id),
  );
  const rc = conflictData?.conflict ?? null;
  const existing = {
    title: rc ? rc.existing.label : g.existing.title,
    meta: g.existing.meta,
    quote: rc?.existing.detail ?? g.existing.quote,
    owner: rc?.existing.owner ?? g.existing.owner,
  };
  const proposed = {
    title: rc ? rc.proposed.label : g.proposed.title,
    meta: g.proposed.meta,
    quote: rc?.proposed.detail ?? g.proposed.quote,
    owner: rc?.proposed.owner ?? g.proposed.owner,
  };

  // Hydrate the task card from a real brake when present.
  const taskTitle = brake?.mission ?? `${g.taskId} · ${g.taskTitle}`;
  const worker = brake?.worker ?? g.worker;

  const approve = async () => { if (brake) { await api.allowBrake(brake.id); await mutate(); } };
  const reject = async () => { if (brake) { await api.skipBrake(brake.id); await mutate(); } };

  return (
    <div className="fade-in" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead actions={
        <>
          <button type="button" className="btn">Open PR #2121 ↗</button>
          <button type="button" className="btn" onClick={reject}>Skip & continue sprint</button>
        </>
      }>
        <div className="breadcrumb">Orchestrator / <b>Human gate</b> · {g.taskId}</div>
      </PageHead>

      <div className="gate-wrap" data-testid="gate-conflict">
        <div className="gate-banner">
          <div className="gicon"><Icon name="gate" size={20} /></div>
          <div>
            <h2>Reviewer paused this pipeline</h2>
            <p>The proposed change conflicts with an existing architectural decision. The orchestrator is waiting on a human call before continuing.</p>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={reject}>Reject change</button>
            <button type="button" className="btn">Override decision</button>
            <button type="button" className="btn primary" onClick={approve}>
              <Icon name="check" size={13} /> Approve &amp; resume
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
          <div className="card" style={{ padding: "14px 16px" }}>
            <div className="muted" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 6 }}>Task</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>{taskTitle}</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Developer session <span className="mono" style={{ color: "var(--text-2)" }}>{worker}</span> {brake?.detail ?? g.taskDetail}
            </div>
          </div>
          <div className="card" style={{ padding: "14px 16px" }}>
            <div className="muted" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 6 }}>Why we paused</div>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              Reviewer matched the change against the brain. It contradicts{" "}
              <span className="chip decision"><span className="d" />ADR-014</span> — a recorded decision from Jan 14 still marked <b>active</b>.
            </div>
          </div>
        </div>

        <div className="conflict card" data-testid="gate-conflict-panels">
          <div className="panel left">
            <h6>Existing decision</h6>
            <h3 data-testid="conflict-existing">{existing.title}</h3>
            <div className="muted" style={{ fontSize: 12.5 }}>{existing.meta}</div>
            <div className="quote">“{existing.quote}”</div>
            <div className="muted" style={{ fontSize: 12 }}>— {existing.owner}</div>
          </div>
          <div className="arrow">⇄</div>
          <div className="panel right">
            <h6>Proposed change</h6>
            <h3 data-testid="conflict-proposed">{proposed.title}</h3>
            <div className="muted" style={{ fontSize: 12.5 }}>{proposed.meta}</div>
            <div className="quote">“{proposed.quote}”</div>
            <div className="muted" style={{ fontSize: 12 }}>— {proposed.owner}</div>
          </div>
        </div>

        <div className="section-h" style={{ margin: "18px 0 10px" }}>
          Diff snippet <span className="count">3 of 11 files</span>
        </div>
        <div className="diff" data-testid="gate-diff">
          {g.diff.map((d, i) => (
            <span className={d.t} key={i}><span className="ln">{d.ln}</span> {d.text}</span>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 18 }}>
          {g.signals.map((s) => <SignalCard key={s.label} {...s} />)}
        </div>

        <div className="card" style={{ marginTop: 18, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
          <span className="avatar ai">◆</span>
          <div style={{ flex: 1, fontSize: 13, color: "var(--text-2)" }}>
            <b>Reviewer suggests:</b> {g.suggestion}
          </div>
          <button type="button" className="btn primary">Accept suggestion</button>
        </div>
      </div>
    </div>
  );
}
