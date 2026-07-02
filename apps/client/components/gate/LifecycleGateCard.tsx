"use client";

import * as React from "react";
import { Btn, Card } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { Gate } from "@/lib/types";

export interface LifecycleGateCardProps {
  gate: Gate;
  onApprove: (taskId: string, gate: string, comment?: string) => void | Promise<void>;
  onRequestChanges: (taskId: string, gate: string, comment: string) => void | Promise<void>;
}

/** Human labels for the three lifecycle gates. */
const GATE_LABEL: Record<string, string> = {
  plan: "Plan review",
  manual_test: "Manual test",
  merge: "Merge approval",
};

/**
 * One waiting lifecycle gate rendered as an amber approval card (mirrors
 * GateCard). Unlike a brake, a gate carries `task_id` + `gate` + the run phase,
 * so the actions call back with `(taskId, gate[, comment])`. Request-changes
 * requires a comment so the resuming agent knows what to fix.
 */
export function LifecycleGateCard({ gate, onApprove, onRequestChanges }: LifecycleGateCardProps) {
  const [comment, setComment] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApprove(gate.task_id, gate.gate, comment.trim() || undefined);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  };

  const requestChanges = async () => {
    if (!comment.trim()) {
      setError("Add a comment so the agent knows what to change.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRequestChanges(gate.task_id, gate.gate, comment.trim());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  };

  return (
    <Card className="gate-card" data-testid="lifecycle-gate-card">
      <div className="gate-card-main">
        <div className="gate-card-eyebrow">{GATE_LABEL[gate.gate] ?? gate.gate} gate</div>
        <p className="gate-card-detail">
          {gate.task_title ?? gate.task_id}
          {gate.phase ? ` — waiting in ${gate.phase}` : " — waiting on your call"}
        </p>
        <div className="gate-card-meta">
          <span className="mono">{gate.task_id}</span>
        </div>
        <textarea
          data-testid="lifecycle-gate-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment (required to request changes)…"
          rows={2}
          style={{ width: "100%", resize: "vertical", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-2)", color: "inherit", marginTop: 8 }}
        />
        {error && <p className="gate-card-error">{error}</p>}
      </div>
      <div className="gate-card-actions">
        <Btn variant="primary" disabled={busy} onClick={approve} data-testid="lifecycle-gate-approve">
          <Icon name="check" className="ico" /> Approve
        </Btn>
        <Btn variant="ghost" disabled={busy} onClick={requestChanges} data-testid="lifecycle-gate-reject">
          Request changes
        </Btn>
      </div>
    </Card>
  );
}
