import * as React from "react";
import Link from "next/link";
import { mutate } from "swr";
import { Priority } from "@/components/ui";
import { groupNodesByType, type TaskExecState } from "@/lib/adapters";
import { api } from "@/lib/api";
import type { BrainNode, Kind, LifecycleRun, Task } from "@/lib/types";

export interface TaskCardProps {
  task: Task;
  /** Project brain nodes keyed by id, for resolving task.nodes ids. */
  nodesById: Record<string, BrainNode>;
  /** Dependency-derived readiness (startable / blocked / epic). */
  exec?: TaskExecState;
  /** The task has a `waiting` lifecycle gate → amber "waiting on you" + Review link. */
  gated?: boolean;
  /** The task's active lifecycle run → phase / fan-out / env badges. */
  run?: LifecycleRun;
}

/** Kind badge glyph + label (✨ code · 🔬 research · 📄 docs). */
const KIND_META: Record<Kind, { icon: string; label: string }> = {
  code: { icon: "✨", label: "Code" },
  research: { icon: "🔬", label: "Research" },
  docs: { icon: "📄", label: "Docs" },
};

const KIND_ORDER: Kind[] = ["code", "research", "docs"];

// Terminal statuses across all kinds (code ships, research/docs deliver).
const TERMINAL = new Set(["shipped", "delivered"]);

/**
 * Backlog card (reference TaskCard). Intel bar + chips summarise the task's
 * linked intelligence; the kind badge + precise phase + `▶ N agents` fan-out
 * count + delivery badges reflect the REAL lifecycle run, and an untyped task
 * shows the router's suggestion chip (confirm → api.setKind, or override).
 */
export function TaskCard({ task, nodesById, exec, gated, run }: TaskCardProps) {
  const [kindBusy, setKindBusy] = React.useState(false);

  const resolved: BrainNode[] = [];
  for (const id of task.nodes) {
    const node = nodesById[id];
    if (node) resolved.push(node);
  }
  const g = groupNodesByType(resolved);

  const links = {
    feedback: g.feedback.length,
    bugs: g.bug.length,
    decisions: g.decision.length,
    metrics: g.metric.length,
  };
  const segs: { k: string; color: string; n: number }[] = [
    { k: "feedback", color: "var(--blue)", n: links.feedback },
    { k: "bug", color: "var(--red)", n: links.bugs },
    { k: "decision", color: "var(--amber)", n: links.decisions },
    { k: "metric", color: "var(--teal)", n: links.metrics },
  ];
  const total = segs.reduce((acc, s) => acc + s.n, 0);

  const kind = (task.kind ?? null) as Kind | null;
  const kindMeta = kind ? KIND_META[kind] : null;

  // A lifecycle run mid-flight (not ready/blocked/terminal) → show the precise
  // phase, and — when the run is fanning out — the `▶ N agents` count.
  const inFlight =
    !!run && run.active === 1 && !TERMINAL.has(task.status) &&
    task.status !== "ready" && task.status !== "blocked";
  const fanoutCount = run?.fanout_count ?? 0;

  // Env badges on Done (code shipped → furthest env); research/docs deliver.
  const envs: { key: "dev" | "staging" | "prod"; label: string; at: string | null | undefined }[] = [
    { key: "dev", label: "dev", at: run?.env_dev_at },
    { key: "staging", label: "staging", at: run?.env_staging_at },
    { key: "prod", label: "prod", at: run?.env_prod_at },
  ];
  const reachedEnvs = task.status === "shipped" ? envs.filter((e) => e.at) : [];
  const delivered = task.status === "delivered";

  // Router suggestion: shown only for an UNTYPED task that has a suggestion.
  const suggestion =
    kind == null && task.kind_suggested
      ? (task.kind_suggested as Kind)
      : null;

  const setKind = React.useCallback(
    async (next: Kind) => {
      if (kindBusy) return;
      setKindBusy(true);
      try {
        await api.setKind(task.id, next);
        mutate(["tasks", task.project_id]);
      } catch {
        // A 409 (kind locked) or network error — leave the suggestion in place;
        // the SWR revalidate on the next poll reconciles state.
      } finally {
        setKindBusy(false);
      }
    },
    [task.id, task.project_id, kindBusy],
  );

  // Buttons live inside the card's <Link>; stop the anchor navigation on click.
  const swallow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <Link
      href={`/task/${task.id}`}
      className="task-card"
      data-testid="task-card"
      data-kind={kind ?? "untyped"}
      style={{ display: "block", textDecoration: "none", color: "inherit" }}
    >
      <div className="tc-head">
        <Priority level={task.priority} />
        <span>{task.id}</span>
        {kindMeta && (
          <span
            data-testid="kind-badge"
            data-kind={kind}
            title={kindMeta.label}
            className="chip"
            style={{ fontSize: 10, padding: "1px 6px" }}
          >
            <span aria-hidden style={{ marginRight: 3 }}>{kindMeta.icon}</span>
            {kindMeta.label}
          </span>
        )}
        {task.feature ? <span style={{ marginLeft: "auto" }}>{task.feature}</span> : null}
      </div>

      <h4>{task.title}</h4>

      {total > 0 && (
        <div className="intel-bar" title={`${total} linked intelligence items`}>
          {segs.filter((s) => s.n > 0).map((s) => (
            <span key={s.k} data-intel-type={s.k} style={{ background: s.color, flex: s.n }} title={`${s.n} ${s.k}`} />
          ))}
        </div>
      )}

      <div className="tc-meta">
        {links.feedback > 0 && <span className="chip feedback"><span className="d" />{links.feedback} feedback</span>}
        {links.bugs > 0 && <span className="chip bug"><span className="d" />{links.bugs} bug</span>}
        {links.decisions > 0 && <span className="chip decision"><span className="d" />{links.decisions} ADR</span>}
        {links.metrics > 0 && <span className="chip metric"><span className="d" />metric</span>}
      </div>

      {/* Router suggestion — untyped task with an advisory kind. Confirm applies
          it (api.setKind); the three glyphs override to another kind. */}
      {suggestion && (
        <div
          data-testid="router-suggestion"
          style={{
            marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            padding: "6px 8px", borderRadius: 8,
            border: "1px solid rgba(201,184,255,.3)",
            background: "rgba(201,184,255,.06)", fontSize: 11.5,
          }}
        >
          <span style={{ color: "var(--accent)" }}>
            suggests {KIND_META[suggestion].icon} {KIND_META[suggestion].label}
          </span>
          <button
            type="button"
            data-testid="kind-confirm"
            disabled={kindBusy}
            onClick={(e) => { swallow(e); void setKind(suggestion); }}
            className="btn"
            style={{ marginLeft: "auto", padding: "2px 8px", fontSize: 11 }}
          >
            ✓ Confirm
          </button>
          <span style={{ display: "flex", gap: 4 }} title="Override the suggested kind">
            {KIND_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                data-testid={`kind-set-${k}`}
                title={`Set kind: ${KIND_META[k].label}`}
                disabled={kindBusy}
                onClick={(e) => { swallow(e); void setKind(k); }}
                style={{
                  padding: "1px 5px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                  border: "1px solid var(--border)", background: "var(--bg-2)", color: "inherit",
                }}
              >
                {KIND_META[k].icon}
              </button>
            ))}
          </span>
        </div>
      )}

      {/* Waiting on a human gate — amber banner + inline Review link. */}
      {gated && (
        <div
          className="tc-gate"
          style={{
            marginTop: 8, display: "flex", alignItems: "center", gap: 8,
            padding: "6px 8px", borderRadius: 8,
            border: "1px solid rgba(230,184,106,.35)",
            background: "rgba(230,184,106,.08)", color: "var(--amber)", fontSize: 11.5,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)" }} />
          <span style={{ fontWeight: 500 }}>waiting on you</span>
          <span data-testid="card-gate-review" style={{ marginLeft: "auto", fontWeight: 500 }}>
            Review →
          </span>
        </div>
      )}

      {/* Env badges — the furthest deployment env a shipped (code) run reached. */}
      {reachedEnvs.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {reachedEnvs.map((e) => (
            <span
              key={e.key}
              data-testid={`env-badge-${e.key}`}
              className="chip"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}
            >
              <span className="d" style={{ background: "var(--green)" }} />
              {e.label}
            </span>
          ))}
        </div>
      )}

      {/* Delivered badge — research/docs terminal (no env lanes, no PR). */}
      {delivered && (
        <div style={{ marginTop: 8 }}>
          <span
            data-testid="delivered-badge"
            className="chip"
            style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--green)" }}
          >
            <span className="d" style={{ background: "var(--green)" }} />
            delivered ✓
          </span>
        </div>
      )}

      <div className="tc-foot">
        <div className="left">
          {inFlight ? (
            <span className="agent-running" data-testid="tc-phase">
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
              {task.status}
              {fanoutCount > 0 && (
                <span data-testid="fanout-count" style={{ marginLeft: 8, color: "var(--blue)" }}>
                  ▶ {fanoutCount} agents
                </span>
              )}
            </span>
          ) : exec?.startable ? (
            <span className="tc-ready" data-testid="tc-startable" title="No open blockers — ready to start now">
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
              ready to start
            </span>
          ) : task.status === "ready" && exec?.blockedByOpen ? (
            <span className="tc-blocked" data-testid="tc-blocked" title="Waiting on upstream tasks">
              blocked by {exec.blockedByOpen}
            </span>
          ) : exec?.isEpic ? (
            <span className="muted mono" style={{ fontSize: 10.5 }} data-testid="tc-epic">epic</span>
          ) : (
            <span className="muted mono" style={{ fontSize: 10.5 }}>{task.status}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
