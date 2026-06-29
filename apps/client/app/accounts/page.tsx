"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { AccountCard } from "@/components/agentpool/AccountCard";
import { api } from "@/lib/api";
import { useProject } from "@/lib/useProject";
import type { Account, Session } from "@/lib/types";

function StateMessage({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "32px 24px", color: "var(--text-3)", fontSize: 13 }}>{children}</div>;
}

/**
 * Dispatch strategies the orchestrator supports. These are fixed product labels
 * (not fabricated data); the active one is the project's real `account_strategy`.
 */
const STRATEGIES = [
  { id: "round_robin", label: "Round-robin", desc: "Even spread across the pool" },
  { id: "cost_aware", label: "Cost-aware", desc: "Cheapest capable account first" },
  { id: "capability", label: "Capability-match", desc: "Route by role strengths" },
  { id: "manual", label: "Manual", desc: "Pin tasks to accounts" },
] as const;

/** Simple PM → worker fan (curved SVG connectors). */
function OrchGraph({ workers }: { workers: { label: string; color: string }[] }) {
  const W = 720;
  const H = 150;
  const pmX = W / 2;
  const pmY = 26;
  const n = Math.max(workers.length, 1);
  const wy = H - 30;
  const xs = workers.map((_, i) => (W / (n + 1)) * (i + 1));
  return (
    <svg className="acc-graph" viewBox={`0 0 ${W} ${H}`} data-testid="orch-graph" preserveAspectRatio="xMidYMid meet">
      {xs.map((x, i) => (
        <path key={i} d={`M ${pmX} ${pmY + 14} C ${pmX} ${(pmY + wy) / 2}, ${x} ${(pmY + wy) / 2}, ${x} ${wy - 14}`} fill="none" stroke="var(--line-strong)" strokeWidth="1.2" />
      ))}
      <g>
        <circle cx={pmX} cy={pmY} r="13" fill="rgba(201,184,255,.16)" stroke="var(--accent)" />
        <text x={pmX} y={pmY + 4} textAnchor="middle" fontSize="12" fill="var(--accent)">★</text>
        <text x={pmX} y={pmY + 28} textAnchor="middle" fontSize="9" fill="var(--text-4)" fontFamily="var(--mono)">PM</text>
      </g>
      {workers.map((w, i) => (
        <g key={i}>
          <circle cx={xs[i]} cy={wy} r="11" fill={w.color + "22"} stroke={w.color} />
          <text x={xs[i]} y={wy + 26} textAnchor="middle" fontSize="9" fill="var(--text-3)" fontFamily="var(--mono)">
            {w.label.length > 10 ? w.label.slice(0, 9) + "…" : w.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function AccountsPage() {
  const { project } = useProject();
  const accounts = useSWR("accounts", () => api.accounts());
  const sessions = useSWR("sessions", () => api.sessions(), { refreshInterval: 5000 });
  const pool: Account[] = accounts.data?.accounts ?? [];
  const fleet: Session[] = sessions.data?.sessions ?? [];
  const inUse = new Set(fleet.filter((s) => s.alive && s.account_id).map((s) => s.account_id as string));

  // Active dispatch strategy is the real project setting (read-only here).
  const activeStrategy = project?.account_strategy ?? null;
  const [provider, setProvider] = React.useState("all");
  const providers = ["all", ...Array.from(new Set(pool.map((a) => a.provider?.toLowerCase()).filter(Boolean)))];
  const shown = pool.filter((a) => provider === "all" || a.provider?.toLowerCase() === provider);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Accounts" />
      {accounts.error ? (
        <StateMessage><span style={{ color: "var(--red)" }}>Couldn’t load accounts.</span></StateMessage>
      ) : (
        <div className="acc-wrap">
          <section>
            <p className="acc-intro serif">
              The provider account pool your agents draw from. The orchestrator dispatches each task to a capable account and hands off when one is rate-limited or exhausted.
            </p>
            <div className="acc-stats">
              <div className="acc-stat"><div className="val">{pool.length}</div><div className="lbl">accounts</div></div>
              <div className="acc-stat"><div className="val">{providers.length - 1}</div><div className="lbl">providers</div></div>
              <div className="acc-stat"><div className="val" style={{ color: "var(--blue)" }}>{inUse.size}</div><div className="lbl">in use</div></div>
            </div>

            <div className="acc-section-h">Orchestrator</div>
            <div className="acc-graph-wrap">
              <OrchGraph workers={shown.map((a) => ({ label: a.label, color: a.color ?? "var(--accent)" }))} />
            </div>

            <div className="acc-section-h">Dispatch strategy</div>
            {project ? (
              <div className="acc-strategies">
                {STRATEGIES.map((s) => (
                  <div
                    key={s.id}
                    className={"acc-strat" + (activeStrategy === s.id ? " on" : "")}
                    data-testid="acc-strat"
                    data-active={activeStrategy === s.id ? "true" : undefined}
                  >
                    <div className="acc-strat-label">{s.label}</div>
                    <div className="acc-strat-desc muted">{s.desc}</div>
                  </div>
                ))}
              </div>
            ) : (
              <StateMessage>Select a project to see its dispatch strategy.</StateMessage>
            )}

            <div className="acc-section-h" style={{ display: "flex", alignItems: "center" }}>
              Accounts
              <div className="acc-provider-tabs" data-testid="provider-tabs">
                {providers.map((p) => (
                  <button key={p} className={"acc-ptab" + (provider === p ? " on" : "")} onClick={() => setProvider(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="acct-list">
              {shown.map((a) => <AccountCard key={a.id} account={a} inUse={inUse.has(a.id)} />)}
              {pool.length === 0 && <StateMessage>No accounts connected yet.</StateMessage>}
              {pool.length > 0 && shown.length === 0 && <StateMessage>No accounts for this provider.</StateMessage>}
            </div>
          </section>

          <aside className="acc-handoffs" data-testid="handoff-log">
            <div className="acc-section-h">Handoff log</div>
            <StateMessage>No handoffs recorded yet.</StateMessage>
          </aside>
        </div>
      )}
    </div>
  );
}
