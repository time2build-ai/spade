"use client";

import * as React from "react";
import Link from "next/link";
import { Priority, Chip } from "@/components/ui";
import { StagesMini } from "./StagesMini";
import { stageVisual } from "@/lib/adapters";
import type { PipelineRun, RunStatus } from "@/lib/types";

const STATUS_META: Record<RunStatus, { label: string; color: string }> = {
  queued: { label: "queued", color: "var(--text-4)" },
  running: { label: "running", color: "var(--blue)" },
  paused: { label: "paused", color: "var(--amber)" },
  shipped: { label: "shipped", color: "var(--green)" },
};

const STAGE_LABEL: Record<string, string> = {
  done: "✓ Completed",
  run: "● Running",
  gate: "⏸ Awaiting human",
  queue: "· Queued",
};

export interface ActiveCardProps {
  run: PipelineRun;
  title?: string;
  feature?: string | null;
  account?: string | null;
  priority?: number;
  open: boolean;
  onToggle: () => void;
}

/**
 * Active-task card (reference ActiveTasksView). No-fabrication: progress is
 * derived from completed/total stages (not a fake %); status label is the real
 * run status; eta/spent/tokens are omitted. Title/feature/account are joined
 * from real data.
 */
export function ActiveCard({ run, title, feature, account, priority = 2, open, onToggle }: ActiveCardProps) {
  const total = run.stages.length || 1;
  const done = run.stages.filter((s) => stageVisual(s.state).key === "done").length;
  const progress = Math.round((done / total) * 100);
  const status = STATUS_META[run.status];

  return (
    <div className={"active-card" + (open ? " open" : "")} data-testid="active-card" data-run-id={run.id}>
      <div className="ac-head" onClick={onToggle}>
        <Priority level={priority} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 500 }}>
            <span className="mono muted" style={{ fontSize: 11.5 }}>{run.task_id}</span>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {title ?? <span className="muted">—</span>}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3, display: "flex", gap: 10, alignItems: "center" }}>
            {feature ? (
              <Chip type="feature" style={{ padding: "1px 6px" }}>{feature}</Chip>
            ) : null}
            {account ? <span className="mono">{account}</span> : null}
            <span style={{ color: status.color }}>● {status.label}</span>
          </div>
        </div>
        <StagesMini stages={run.stages} />
        <span className="muted mono" style={{ fontSize: 11, width: 60, textAlign: "right" }}>
          {done}/{total}
        </span>
        <Link href={`/task/${run.task_id}`} className="btn ghost" onClick={(e) => e.stopPropagation()}>
          Open
        </Link>
      </div>
      <div className="progress-rail">
        <div className="fill" style={{ width: progress + "%" }} />
        {run.status === "running" && <div className="pulse" />}
      </div>
      <div className="ac-body">
        <div className="ac-stages">
          {run.stages.map((s) => {
            const key = stageVisual(s.state).key;
            return (
              <div key={s.id} className={"ac-stage-mini " + key}>
                <span className="role-mini">{s.role}</span>
                <span style={{ fontWeight: 500, fontSize: 12.5 }}>{STAGE_LABEL[key]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
