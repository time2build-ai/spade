import * as React from "react";
import { accountSeed, ROLE_META } from "@/lib/demo";
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

function providerMeta(provider: string) {
  const key = (provider ?? "").toLowerCase().replace(/-code$/, ""); // claude-code → claude
  return PROVIDER_META[key] ?? { glyph: "•", color: "var(--text-3)" };
}

/**
 * Account-centric pool card (reference mod_25): provider glyph avatar, role pill,
 * usage meter, model · plan, in-use state, and the current AI issue (with brain
 * node chips). Real label/provider/in-use win; the rest is seeded.
 */
export function AccountCard({ account, inUse = false }: { account: Account; inUse?: boolean }) {
  const meta = providerMeta(account.provider);
  const color = account.color ?? meta.color;
  const s = accountSeed(account.id);
  // Real-wins: real account columns show through; the seed only fills gaps.
  const role = account.role ?? s.role;
  const model = account.model ?? s.model;
  const plan = account.plan ?? s.plan;
  const roleColor = ROLE_META[role]?.color ?? "var(--text-3)";

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
          <div className="acct-sub mono">{model} · {plan}</div>
        </div>
        <span className="acct-role-pill" data-testid="acct-role" style={{ color: roleColor, borderColor: roleColor + "55", background: roleColor + "14" }}>
          {role}
        </span>
        <span className="acct-state" data-state={inUse ? "running" : "idle"} title={inUse ? "In use" : "Idle"}>
          <span className="acct-state-dot" style={{ background: inUse ? "var(--blue)" : "var(--green)" }} />
          {inUse ? "in use" : "idle"}
        </span>
      </div>

      <div className="acct-meter" data-testid="acct-meter">
        <div className="acct-meter-bar"><div className="fill" style={{ width: s.usage + "%" }} /></div>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{s.usage}%</span>
      </div>

      {s.currentIssue ? (
        <div className="acct-issue" data-testid="acct-issue">
          <span className="acct-issue-id mono">{s.currentIssue.id}</span>
          <span className="acct-issue-title">{s.currentIssue.title}</span>
          <div className="acct-issue-chips">
            {s.currentIssue.nodes.map((n) => (
              <span className="node-chip mono" key={n}>{n}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="acct-issue muted" style={{ fontSize: 11.5 }}>idle · no active execution</div>
      )}
    </div>
  );
}
