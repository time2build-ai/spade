"use client";

import * as React from "react";
import { StagesMini } from "./StagesMini";
import { Terminal } from "./Terminal";
import { stageVisual, runActiveSession } from "@/lib/adapters";
import type { PipelineRun, RunStatus } from "@/lib/types";

const STATUS_DOT: Record<RunStatus, string> = {
  queued: "var(--text-4)",
  running: "var(--blue)",
  paused: "var(--amber)",
  shipped: "var(--green)",
};

const STAGE_STATE_LABEL: Record<string, { glyph: string; label: string; color: string }> = {
  done: { glyph: "✓", label: "Done", color: "var(--green)" },
  run: { glyph: "●", label: "Running", color: "var(--blue)" },
  gate: { glyph: "⏸", label: "Gate", color: "var(--amber)" },
  queue: { glyph: "·", label: "Queued", color: "var(--text-4)" },
};

function stepLabel(run: PipelineRun): string {
  if (run.status === "shipped") return "shipped";
  if (run.status === "paused") return "paused";
  const total = run.stages.length || 4;
  const running = run.stages.findIndex((s) => stageVisual(s.state).key === "run");
  const done = run.stages.filter((s) => stageVisual(s.state).key === "done").length;
  const step = running >= 0 ? running + 1 : done;
  return `step ${step}/${total}`;
}

export interface PipelineTableProps {
  runs: PipelineRun[];
  /** task_id → title (real, joined from the tasks list). */
  titleById: Record<string, string>;
  /** account_id → label (real, joined from the accounts list). */
  accountById: Record<string, string>;
  /** Real pipeline actions, preserved in the expanded detail. */
  onStart?: (id: string) => void;
  onAdvance?: (id: string) => void;
}

/**
 * Reference orchestrator layout: a table of pipeline runs with inline-expanding
 * detail. No-fabrication: columns + detail show only real fields (task, title,
 * stages, account, status). The reference's Cost / ETA columns and the
 * files-touched / tokens / fake live-log cards are omitted — instead the
 * expanded row embeds our REAL session Terminal for that run.
 */
export function PipelineTable({ runs, titleById, accountById, onStart, onAdvance }: PipelineTableProps) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="orch-table" data-testid="orch-table">
      <div className="th" />
      <div className="th">Task</div>
      <div className="th">Title</div>
      <div className="th">Pipeline</div>
      <div className="th">Account</div>
      <div className="th">Status</div>

      {runs.map((run) => {
        const isOpen = open.has(run.id);
        const acctId = run.stages.find((s) => s.account_id)?.account_id ?? null;
        return (
          <React.Fragment key={run.id}>
            <div
              className={"row" + (isOpen ? " open" : "")}
              data-testid="orch-row"
              data-run-id={run.id}
              onClick={() => toggle(run.id)}
            >
              <div className="td" style={{ paddingRight: 0 }}>
                <span
                  className="orch-chev"
                  style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0)" }}
                >
                  ▸
                </span>
              </div>
              <div className="td">
                <span className="mono" style={{ fontSize: 11.5 }}>{run.task_id}</span>
              </div>
              <div className="td">
                <div className="truncate">{titleById[run.task_id] ?? <span className="muted">—</span>}</div>
              </div>
              <div className="td">
                <StagesMini stages={run.stages} />
                <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{stepLabel(run)}</span>
              </div>
              <div className="td">
                <span className="mono" style={{ fontSize: 11 }}>
                  {acctId ? (accountById[acctId] ?? acctId) : <span className="muted">—</span>}
                </span>
              </div>
              <div className="td">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_DOT[run.status] }} />
                  <span className="mono" style={{ fontSize: 11 }}>{run.status}</span>
                </span>
              </div>

              {/* Expanded detail spans the full row width. */}
            </div>
            {isOpen && (
              <div className="orch-detail" data-testid="orch-detail">
                <div className="orch-detail-inner">
                  <div className="orch-d-stages">
                    {run.stages.map((s) => {
                      const key = stageVisual(s.state).key;
                      const meta = STAGE_STATE_LABEL[key] ?? STAGE_STATE_LABEL.queue;
                      return (
                        <div key={s.id} className={"orch-d-stage " + key}>
                          <div className="orch-d-stage-h">
                            <span className="role-mini">{s.role}</span>
                            <span className="state">
                              <span style={{ color: meta.color }}>{meta.glyph}</span> {meta.label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {(onStart || onAdvance) && (
                    <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                      {run.status === "queued" && onStart && (
                        <button className="btn ghost" onClick={(e) => { e.stopPropagation(); onStart(run.id); }}>
                          Start pipeline
                        </button>
                      )}
                      {run.status === "running" && onAdvance && (
                        <button className="btn ghost" onClick={(e) => { e.stopPropagation(); onAdvance(run.id); }}>
                          Advance stage
                        </button>
                      )}
                    </div>
                  )}
                  {/* Real session output for this run (replaces the reference's
                      fabricated "live log"). */}
                  <div style={{ height: 220, display: "flex", flexDirection: "column" }}>
                    <Terminal sessionId={runActiveSession(run)} />
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
