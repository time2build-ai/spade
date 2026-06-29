import * as React from "react";
import type { Account } from "@/lib/types";

/**
 * Provider glyph + color (reference providerMeta). Keyed by the real
 * `account.provider`; "claude-code" normalises to "claude".
 */
export const PROVIDER_META: Record<string, { glyph: string; color: string }> = {
  claude: { glyph: "✦", color: "#c9b8ff" },
  codex: { glyph: "◇", color: "#7ad19a" },
  cursor: { glyph: "❮❯", color: "#9bd1f0" },
  gemini: { glyph: "✺", color: "#f0c674" },
  aider: { glyph: "⌘", color: "#e6a8b8" },
};

/** Role pill colors, keyed by the real `account.role` (when present). */
const ROLE_COLOR: Record<string, string> = {
  orchestrator: "var(--accent)",
  developer: "var(--blue)",
  reviewer: "var(--pink)",
  integrator: "var(--teal)",
  documentor: "var(--accent)",
  fallback: "var(--text-3)",
};

function providerMeta(provider: string) {
  const key = (provider ?? "").toLowerCase().replace(/-code$/, ""); // claude-code → claude
  return PROVIDER_META[key] ?? { glyph: "•", color: "var(--text-3)" };
}

/**
 * Account-centric pool card: provider glyph avatar, optional role pill, model ·
 * plan when known, default badge, and a real in-use state derived from the live
 * fleet. No-fabrication: usage %, current AI issue, and node chips are dropped —
 * the API doesn't expose them. role/model/plan render only when the real account
 * row carries them.
 */
export function AccountCard({ account, inUse = false }: { account: Account; inUse?: boolean }) {
  const meta = providerMeta(account.provider);
  const color = account.color ?? meta.color;
  const role = account.role ?? null;
  const model = account.model ?? null;
  const plan = account.plan ?? null;
  const sub = [model, plan].filter(Boolean).join(" · ") || account.provider;
  const roleColor = role ? ROLE_COLOR[role.toLowerCase()] ?? "var(--text-3)" : "var(--text-3)";

  return (
    <div className="acct-card rich" data-provider={account.provider?.toLowerCase()}>
      <div className="acct-top">
        <span className="acct-glyph" data-testid="acct-glyph" style={{ background: color + "18", color, borderColor: color + "40" }}>
          {meta.glyph}
        </span>
        <div className="acct-id">
          <div className="acct-label">
            {account.label}
            {account.is_default === 1 && <span className="acct-default-badge">default</span>}
          </div>
          <div className="acct-sub mono">{sub}</div>
        </div>
        {role && (
          <span className="acct-role-pill" data-testid="acct-role" style={{ color: roleColor, borderColor: roleColor + "55", background: roleColor + "14" }}>
            {role}
          </span>
        )}
        <span className="acct-state" data-state={inUse ? "running" : "idle"} title={inUse ? "In use" : "Idle"}>
          <span className="acct-state-dot" style={{ background: inUse ? "var(--blue)" : "var(--green)" }} />
          {inUse ? "in use" : "idle"}
        </span>
      </div>

      <div className="acct-issue muted" style={{ fontSize: 11.5 }}>
        {typeof account.active_sessions === "number" && account.active_sessions > 0
          ? `${account.active_sessions} active session${account.active_sessions === 1 ? "" : "s"}`
          : inUse
            ? "in use by an agent"
            : "idle · no active execution"}
      </div>
    </div>
  );
}
