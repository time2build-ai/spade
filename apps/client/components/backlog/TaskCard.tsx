import * as React from "react";
import Link from "next/link";
import { mutate } from "swr";
import { Priority } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { groupNodesByType, type TaskExecState } from "@/lib/adapters";
import { api } from "@/lib/api";
import { statusMeta } from "@/lib/status";
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

/** Kind badge icon + label (spark = code · search = research · doc = docs).
 *  Colour is driven by CSS via `.kind-pill[data-kind=…]` (code blue · research
 *  lavender · docs green) — see globals.css. */
const KIND_META: Record<Kind, { icon: IconName; label: string }> = {
  code: { icon: "spark", label: "Code" },
  research: { icon: "search", label: "Research" },
  docs: { icon: "doc", label: "Docs" },
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
  // "change" reveals the override pills so the default suggestion row stays calm.
  const [changing, setChanging] = React.useState(false);

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

  // The single status shown beside the title (icon + label). Precedence:
  // waiting gate → blocked → an agent working (phase, spins) → terminal →
  // ready → dependency-blocked → epic → raw status.
  const status: {
    icon: IconName | null;
    label: string;
    color: string;
    extra?: React.ReactNode;
    testid?: string;
    title?: string;
  } = gated
    ? { icon: "gate", label: "Waiting on you", color: "var(--amber)", testid: "card-gate-review", title: "A gate is waiting on your review" }
    : task.status === "blocked"
      ? { icon: "alert", label: "Blocked", color: "var(--red)", title: "The lifecycle is blocked" }
      : inFlight
        ? {
            ...statusMeta(task.status),
            testid: "tc-phase",
            title: "An agent is working on this",
            extra:
              fanoutCount > 0 ? (
                <span data-testid="fanout-count" className="tc-status-extra" style={{ color: "var(--blue)" }}>
                  ▶ {fanoutCount} agents
                </span>
              ) : undefined,
          }
        : delivered
          ? statusMeta("delivered")
          : task.status === "shipped"
            ? statusMeta("shipped")
            : exec?.startable
              ? { ...statusMeta("ready"), testid: "tc-startable", title: "No open blockers — ready to start now" }
              : task.status === "ready" && exec?.blockedByOpen
                ? {
                    icon: "alert", label: "Blocked", color: "var(--red)", testid: "tc-blocked", title: "Waiting on upstream tasks",
                    extra: <span className="tc-status-extra">· {exec.blockedByOpen}</span>,
                  }
                : exec?.isEpic
                  ? { icon: null, label: "Epic", color: "var(--text-3)", testid: "tc-epic" }
                  : statusMeta(task.status);

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
        <span className="tc-id">{task.id}</span>
        {kindMeta && (
          <span
            data-testid="kind-badge"
            data-kind={kind}
            title={kindMeta.label}
            className="kind-pill sm"
          >
            <Icon name={kindMeta.icon} size={11} />
            {kindMeta.label}
          </span>
        )}
        {task.feature ? <span className="tc-feat" title={task.feature}>{task.feature}</span> : null}
      </div>

      <div className="titlerow">
        <h4>{task.title}</h4>
        <span className="tc-status" data-testid={status.testid} title={status.title} style={{ color: status.color }}>
          {status.icon && <Icon name={status.icon} size={12} />}
          {status.label}
          {status.extra}
        </span>
      </div>

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
          it (api.setKind); "change" reveals the override pills for another kind. */}
      {suggestion && (
        <div data-testid="router-suggestion">
          <div className="router-sugg">
            <span className="lead">router</span>
            <span className="kind-pill" data-kind={suggestion}>
              <Icon name={KIND_META[suggestion].icon} size={12} />
              {KIND_META[suggestion].label}
            </span>
            <button
              type="button"
              data-testid="kind-confirm"
              disabled={kindBusy}
              onClick={(e) => { swallow(e); void setKind(suggestion); }}
              className="confirm"
            >
              <Icon name="check" size={12} />
              Confirm
            </button>
            <button
              type="button"
              className="change"
              aria-expanded={changing}
              onClick={(e) => { swallow(e); setChanging((v) => !v); }}
            >
              change
              <Icon name="chev" size={11} />
            </button>
          </div>
          {changing && (
            <div className="router-override" title="Override the suggested kind">
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  data-testid={`kind-set-${k}`}
                  title={`Set kind: ${KIND_META[k].label}`}
                  disabled={kindBusy}
                  onClick={(e) => { swallow(e); void setKind(k); }}
                  className="kind-pill"
                  data-kind={k}
                >
                  <Icon name={KIND_META[k].icon} size={12} />
                  {KIND_META[k].label}
                </button>
              ))}
            </div>
          )}
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

    </Link>
  );
}
