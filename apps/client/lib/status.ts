import type { IconName } from "@/components/Icon";

/**
 * Single source of truth for how a task status / lifecycle phase is shown —
 * one friendly label + colour + icon used on the board cards, the task header,
 * the properties rail, and the Orchestrator fleet. Keeps the vocabulary
 * consistent instead of leaking raw lowercase phase names ("scoping").
 *
 * Icon vocabulary: play = ready · spinner = an agent is working · gate =
 * waiting on you · alert = blocked · check = done.
 */
export interface StatusMeta {
  label: string;
  color: string;
  icon: IconName;
}

export const STATUS_META: Record<string, StatusMeta> = {
  ready: { label: "Ready", color: "var(--green)", icon: "play" },
  blocked: { label: "Blocked", color: "var(--red)", icon: "alert" },
  // Code lifecycle (V2).
  shaping: { label: "Shaping", color: "var(--pink)", icon: "spinner" },
  plan_review: { label: "Plan review", color: "var(--amber)", icon: "gate" },
  building: { label: "Building", color: "var(--blue)", icon: "spinner" },
  pr_review: { label: "In review", color: "var(--accent)", icon: "spinner" },
  shipped: { label: "Shipped", color: "var(--green)", icon: "check" },
  // Research lifecycle.
  scoping: { label: "Scoping", color: "var(--amber)", icon: "spinner" },
  investigating: { label: "Investigating", color: "var(--blue)", icon: "spinner" },
  synthesis: { label: "Synthesis", color: "var(--accent)", icon: "spinner" },
  // Docs lifecycle.
  outline: { label: "Outline", color: "var(--amber)", icon: "spinner" },
  drafting: { label: "Drafting", color: "var(--blue)", icon: "spinner" },
  review: { label: "In review", color: "var(--accent)", icon: "spinner" },
  delivered: { label: "Delivered", color: "var(--green)", icon: "check" },
};

/** Friendly label + colour + icon for any status/phase; unknowns get Title-cased. */
export function statusMeta(status: string): StatusMeta {
  return (
    STATUS_META[status] ?? {
      label: status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      color: "var(--text-4)",
      icon: "spinner",
    }
  );
}
