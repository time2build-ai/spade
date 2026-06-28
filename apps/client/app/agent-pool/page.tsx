"use client";

import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { AgentCard } from "@/components/agentpool/AgentCard";
import { AccountCard } from "@/components/agentpool/AccountCard";
import { api } from "@/lib/api";
import { DEMO_EXECUTIONS, ROLE_META } from "@/lib/demo";
import type { Account, Session } from "@/lib/types";

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "32px 22px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

export default function AgentPoolPage() {
  // Global fleet — no project param. Poll for liveness.
  const sessions = useSWR("sessions", () => api.sessions(), {
    refreshInterval: 3000,
  });
  const accounts = useSWR("accounts", () => api.accounts());

  const fleet: Session[] = sessions.data?.sessions ?? [];
  const pool: Account[] = accounts.data?.accounts ?? [];

  // Accounts currently in use = those with an alive session (real data).
  const inUseAccounts = new Set(
    fleet.filter((s) => s.alive && s.account_id).map((s) => s.account_id as string),
  );

  const loading =
    (sessions.isLoading && !sessions.data) ||
    (accounts.isLoading && !accounts.data);
  const error = sessions.error ?? accounts.error;

  let body: React.ReactNode;
  if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>
          Couldn’t load the agent pool: {String(error.message ?? error)}
        </span>
      </StateMessage>
    );
  } else if (loading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else {
    body = (
      <div className="ap-wrap">
        <section className="ap-pool">
          <div className="ap-section-h">
            <div className="ap-section-title">Live agent fleet</div>
            <div className="ap-section-sub muted">
              every running session across the workspace
            </div>
          </div>
          {fleet.length === 0 ? (
            <StateMessage>No agents running.</StateMessage>
          ) : (
            <div className="ap-grid">
              {fleet.map((s) => (
                <AgentCard key={s.id} session={s} />
              ))}
            </div>
          )}
        </section>

        <section className="ap-accounts">
          <div className="ap-section-h">
            <div className="ap-section-title">Provider accounts</div>
            <div className="ap-section-sub muted">
              the account pool agents draw from
            </div>
          </div>
          {pool.length === 0 ? (
            <StateMessage>No accounts configured.</StateMessage>
          ) : (
            <div className="acct-list">
              {pool.map((a) => (
                <AccountCard key={a.id} account={a} inUse={inUseAccounts.has(a.id)} />
              ))}
            </div>
          )}
        </section>

        <section className="ap-executions">
          <div className="ap-section-h">
            <div className="ap-section-title">Executions in progress</div>
            <div className="ap-section-sub muted">AI issues currently being worked</div>
          </div>
          <div className="exec-table" data-testid="exec-table">
            <div className="th">Issue</div>
            <div className="th">Role</div>
            <div className="th">Task</div>
            <div className="th">Elapsed</div>
            <div className="th">Context</div>
            {DEMO_EXECUTIONS.map((e) => (
              <div className="exec-row" data-testid="exec-row" key={e.id}>
                <div className="td mono">{e.id}</div>
                <div className="td">
                  <span className="exec-role" style={{ color: ROLE_META[e.role]?.color ?? "var(--text-3)" }}>{e.role}</span>
                </div>
                <div className="td mono">{e.task}</div>
                <div className="td mono" style={{ color: "var(--text-3)" }}>{e.elapsed}</div>
                <div className="td">
                  {e.nodes.map((n) => <span className="node-chip mono" key={n}>{n}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title={
          <span className="breadcrumb">
            <b>Agent pool</b>
            <span className="muted">
              {" · "}
              {fleet.length} agents · {pool.length} accounts
            </span>
          </span>
        }
      />
      {body}
    </div>
  );
}
