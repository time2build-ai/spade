"use client";

import * as React from "react";
import { StagesMini } from "./StagesMini";
import { LiveLog } from "./LiveLog";
import { stageVisual } from "@/lib/adapters";
import { orchRunSeed } from "@/lib/demo";
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
      <div className="th">Cost</div>
      <div className="th">ETA</div>

      {runs.map((run) => {
        const isOpen = open.has(run.id);
        const acctId = run.stages.find((s) => s.account_id)?.account_id ?? null;
        const seed = orchRunSeed(run.id);
        // Real-wins: backend-derived progress shows through; seed fills cost/eta/etc.
        const progress = run.progress ?? seed.progress;
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
              <div className="td mono" style={{ fontSize: 11 }}>{seed.cost}</div>
              <div className="td mono" style={{ fontSize: 11, color: run.status === "shipped" ? "var(--green)" : run.status === "paused" ? "var(--amber)" : "var(--text-2)" }}>
                {run.status === "shipped" ? "done" : seed.eta}
              </div>
            </div>
            {isOpen && (
              <div className="orch-detail" data-testid="orch-detail">
                <div className="orch-detail-inner">
                  {/* Progress bar */}
                  <div className="orch-d-progress">
                    <div className="orch-d-progress-bar"><div className="fill" data-testid="orch-progress-fill" style={{ width: progress + "%" }} /></div>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 10 }} data-testid="orch-progress-label">
                      {progress}% · {seed.eta}
                    </span>
                  </div>

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

                  {/* Three columns: context · files · live log */}
                  <div className="orch-d-grid">
                    <div className="orch-d-card">
                      <div className="orch-d-card-h">Context</div>
                      <div className="orch-d-keys">
                        <div><span className="k">Task</span><span className="mono">{run.task_id}</span></div>
                        <div><span className="k">Title</span><span>{titleById[run.task_id] ?? "—"}</span></div>
                        <div><span className="k">Account</span><span className="mono">{acctId ? accountById[acctId] ?? acctId : "—"}</span></div>
                        <div><span className="k">Tokens</span><span className="mono">{seed.tokens}</span></div>
                        <div><span className="k">Cost</span><span className="mono">{seed.cost}</span></div>
                        <div><span className="k">Status</span><span className="mono">{run.status}</span></div>
                      </div>
                      {(onStart || onAdvance) && (
                        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                          {run.status === "queued" && onStart && (
                            <button className="btn ghost" onClick={(e) => { e.stopPropagation(); onStart(run.id); }}>Start</button>
                          )}
                          {run.status === "running" && onAdvance && (
                            <button className="btn ghost" onClick={(e) => { e.stopPropagation(); onAdvance(run.id); }}>Advance</button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="orch-d-card">
                      <div className="orch-d-card-h">Files touched</div>
                      {seed.files.map(([f, d]) => (
                        <div className="orch-d-file" key={f}>
                          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
                          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{d}</span>
                        </div>
                      ))}
                    </div>

                    <div className="orch-d-card term-mini">
                      <div className="orch-d-card-h" style={{ color: "var(--text-3)" }}>Live log</div>
                      <LiveLog logs={seed.logs} />
                    </div>
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
