import * as React from "react";
import type { Account } from "@/lib/types";

/** One provider account from the pool. NO usage meter / % / spend (no data). */
export function AccountCard({ account }: { account: Account }) {
  const swatch = account.color ?? "var(--accent)";
  return (
    <div className="acct-card">
      <span className="acct-swatch" style={{ background: swatch }} />
      <div className="acct-id">
        <div className="acct-label">
          {account.label}
          {account.is_default === 1 && (
            <span className="acct-default-badge">default</span>
          )}
        </div>
        <div
          className="acct-dir mono"
          title={account.config_dir}
        >
          {account.config_dir}
        </div>
      </div>
      <span className="acct-provider mono">{account.provider}</span>
    </div>
  );
}
