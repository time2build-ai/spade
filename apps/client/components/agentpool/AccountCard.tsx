import * as React from "react";
import type { Account } from "@/lib/types";

/**
 * Provider glyph + color (reference providerMeta). Keyed by the real
 * `account.provider`; unknown providers fall back to a neutral dot.
 */
export const PROVIDER_META: Record<string, { glyph: string; color: string }> = {
  claude: { glyph: "✦", color: "#c9b8ff" },
  codex: { glyph: "◇", color: "#7ad19a" },
  cursor: { glyph: "❮❯", color: "#9bd1f0" },
  gemini: { glyph: "✺", color: "#f0c674" },
  aider: { glyph: "⌘", color: "#e6a8b8" },
};

function providerMeta(provider: string) {
  return PROVIDER_META[provider?.toLowerCase()] ?? { glyph: "•", color: "var(--text-3)" };
}

/**
 * One provider account from the pool. Provider glyph avatar + an in-use state
 * derived from real sessions. No usage meter / % / spend / role (no API data).
 */
export function AccountCard({ account, inUse = false }: { account: Account; inUse?: boolean }) {
  const meta = providerMeta(account.provider);
  const color = account.color ?? meta.color;
  return (
    <div className="acct-card" data-provider={account.provider?.toLowerCase()}>
      <span
        className="acct-glyph"
        data-testid="acct-glyph"
        style={{ background: color + "18", color, borderColor: color + "40" }}
      >
        {meta.glyph}
      </span>
      <div className="acct-id">
        <div className="acct-label">
          {account.label}
          {account.is_default === 1 && <span className="acct-default-badge">default</span>}
        </div>
        <div className="acct-dir mono" title={account.config_dir}>
          {account.config_dir}
        </div>
      </div>
      <span className="acct-state" data-state={inUse ? "running" : "idle"} title={inUse ? "In use" : "Idle"}>
        <span
          className="acct-state-dot"
          style={{ background: inUse ? "var(--blue)" : "var(--green)" }}
        />
        {inUse ? "in use" : "idle"}
      </span>
    </div>
  );
}
