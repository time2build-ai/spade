"use client";

import { useState } from "react";
import { Btn } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { runStepLabel, stageVisual } from "@/lib/adapters";
import type { PipelineRun, PipelineStage } from "@/lib/types";
import { StagesMini } from "./StagesMini";

/** Per-stage state marker + label (matches the handoff's ✓/●/⏸/· glyphs). */
function stateLabel(stage: PipelineStage): {
  marker: string;
  text: string;
  color: string;
} {
  const v = stageVisual(stage.state);
  switch (v.key) {
    case "done":
      return { marker: "✓", text: "Done", color: "var(--green)" };
    case "run":
      return { marker: "●", text: "Running", color: "var(--blue)" };
    case "gate":
      return { marker: "⏸", text: "Gate", color: "var(--amber)" };
    case "queue":
    default:
      return { marker: "·", text: "Queued", color: "var(--text-4)" };
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface PipelineCardProps {
  run: PipelineRun;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onStart: (id: string) => Promise<void> | void;
  onAdvance: (id: string) => Promise<void> | void;
}

export function PipelineCard({
  run,
  selected,
  onSelect,
  onStart,
  onAdvance,
}: PipelineCardProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account =
    run.stages.find((s) => s.account_id)?.account_id ?? "—";

  async function run_(action: (id: string) => Promise<void> | void) {
    setBusy(true);
    setError(null);
    try {
      await action(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={[
        "orch-card",
        open && "open",
        selected && "selected",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="orch-card-row"
        onClick={() => {
          setOpen((o) => !o);
          onSelect?.(run.id);
        }}
      >
        <span
          className="orch-chev"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0)" }}
        >
          ▸
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="orch-card-task">{run.task_id}</div>
        </div>
        <StagesMini stages={run.stages} />
        <div className="orch-card-meta">
          <span className="orch-card-acct mono">{account}</span>
          <span className="orch-card-step">{runStepLabel(run)}</span>
          <span
            className="orch-card-step mono"
            style={{
              color:
                run.status === "shipped"
                  ? "var(--green)"
                  : run.status === "paused"
                    ? "var(--amber)"
                    : "var(--text-3)",
            }}
          >
            {run.status}
          </span>
        </div>
      </div>

      {open && (
        <div className="orch-detail">
          <div className="orch-detail-inner">
            <div className="orch-d-stages">
              {run.stages.map((s) => {
                const v = stageVisual(s.state);
                const lbl = stateLabel(s);
                return (
                  <div key={s.id} className={"orch-d-stage " + v.key}>
                    <div className="orch-d-stage-h">
                      <span className="role-mini">{cap(s.role)}</span>
                      <span className="state">
                        <span style={{ color: lbl.color }}>{lbl.marker}</span>{" "}
                        {lbl.text}
                      </span>
                    </div>
                    <div className="meta mono">
                      {s.session_id
                        ? `session ${s.session_id}`
                        : "no session"}
                      {s.account_id ? ` · ${s.account_id}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="orch-d-actions">
              {run.status === "queued" && (
                <Btn
                  variant="primary"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void run_(onStart);
                  }}
                >
                  <Icon name="play" /> Start
                </Btn>
              )}
              {run.status === "running" && (
                <Btn
                  variant="primary"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void run_(onAdvance);
                  }}
                >
                  <Icon name="arrow" /> Advance
                </Btn>
              )}
              {error && <span className="orch-d-err">{error}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
