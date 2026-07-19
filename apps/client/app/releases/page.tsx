"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import type { ReleaseItem, ReleaseLanes } from "@/lib/types";

/** The three deployment lanes, in promotion order. Each non-final lane can
 *  promote its tasks forward to the next env. `verb` distinguishes the routine
 *  dev→staging "Promote" from the higher-stakes staging→prod "Ship". */
const LANES: {
  key: keyof ReleaseLanes; label: string; env: string;
  to?: { env: string; label: string; verb: "Promote" | "Ship" };
}[] = [
  { key: "dev", label: "Development", env: "dev", to: { env: "staging", label: "Staging", verb: "Promote" } },
  { key: "staging", label: "Staging", env: "staging", to: { env: "prod", label: "Production", verb: "Ship" } },
  { key: "prod", label: "Production", env: "prod" },
];

const ENV_CLASS: Record<string, string> = { dev: "rel-env-dev", staging: "rel-env-staging", prod: "rel-env-prod" };
const ENV_LABEL: Record<string, string> = { dev: "Development", staging: "Staging", prod: "Production" };

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 22px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

/** Tasks in a lane awaiting promotion to `toEnv` (in this env, not the next). */
function pending(items: ReleaseItem[], toEnv: string): ReleaseItem[] {
  const stamp = toEnv === "staging" ? "env_staging_at" : toEnv === "prod" ? "env_prod_at" : "env_dev_at";
  return items.filter((it) => !it[stamp as keyof ReleaseItem]);
}

export default function ReleasesPage() {
  const { project, loading: projectLoading } = useProject();

  const key = project ? (["releases", project.id] as const) : null;
  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => api.releases(project!.id),
    { refreshInterval: 5000 },
  );

  const [promoting, setPromoting] = React.useState<string | null>(null);
  const [promoteErr, setPromoteErr] = React.useState<string | null>(null);
  const [lastPr, setLastPr] = React.useState<{ pr_number?: number; pr_url?: string; merged?: boolean; from: string; to: string } | null>(null);

  const promote = React.useCallback(
    async (from: string, to: string) => {
      if (!project || promoting) return;
      setPromoting(`${from}->${to}`);
      setPromoteErr(null);
      try {
        const pr = await api.promote(project.id, from, to);
        setLastPr({ ...pr, from, to });
        mutate();
      } catch (e) {
        setPromoteErr(e instanceof Error ? e.message : String(e));
      } finally {
        setPromoting(null);
      }
    },
    [project, promoting, mutate],
  );

  const lanes = data?.releases;

  // The promotions currently ready — one row per non-final lane that has tasks
  // awaiting the next env. Ordered production-first (highest stakes on top).
  const shipRows = React.useMemo(() => {
    if (!lanes) return [];
    return LANES.filter((l) => l.to)
      .map((l) => ({ lane: l, to: l.to!, items: pending(lanes[l.key] ?? [], l.to!.env) }))
      .filter((r) => r.items.length > 0)
      .reverse(); // LANES is dev→staging→prod; reverse → staging→prod first.
  }, [lanes]);

  let body: React.ReactNode;
  if (projectLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (!project) {
    body = <StateMessage>Select or create a project to view its releases.</StateMessage>;
  } else if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>Couldn’t load releases: {String(error.message ?? error)}</span>
      </StateMessage>
    );
  } else if (isLoading || !lanes) {
    body = <StateMessage>Loading…</StateMessage>;
  } else {
    body = (
      <>
        {/* ── Ready to ship: every available promotion, production-first ── */}
        <div className="ship-panel" data-testid="ship-panel">
          <div className="sp-head">
            <Icon name="bolt" size={14} />
            <span className="k">Ready to ship</span>
            <span className="n">{shipRows.length === 1 ? "1 promotion" : `${shipRows.length} promotions`}</span>
          </div>
          {shipRows.length === 0 ? (
            <div className="sp-empty">
              <Icon name="check" size={26} />
              <div className="t">Everything’s promoted — nothing waiting to move forward.</div>
            </div>
          ) : (
            shipRows.map(({ lane, to, items }) => {
              const busy = promoting === `${lane.env}->${to.env}`;
              const ship = to.verb === "Ship";
              return (
                <div
                  key={lane.env}
                  className={`ship-row ${ship ? "to-prod" : "to-staging"}`}
                  data-testid="ship-row"
                  data-to={to.env}
                >
                  <div className="ship-path">
                    <span className={`env-pill ${ENV_CLASS[lane.env]}`}><span className="dot" />{lane.label}</span>
                    <Icon name="arrow" size={16} className="arr" />
                    <span className={`env-pill ${ENV_CLASS[to.env]}`}><span className="dot" />{to.label}</span>
                  </div>
                  <div className="ship-tasks">
                    {items.map((it) => (
                      <Link key={it.run_id} href={`/task/${it.task_id}`} className="tl" style={{ textDecoration: "none" }}>
                        <span className="cid">{it.task_id}</span>
                        <span>{it.title ?? it.task_id}</span>
                      </Link>
                    ))}
                  </div>
                  <div className="ship-cta">
                    <button
                      type="button"
                      className={`btn ${ship ? "ship" : "primary"}`}
                      data-testid="promote-btn"
                      data-from={lane.env}
                      data-to={to.env}
                      disabled={!!promoting}
                      onClick={() => promote(lane.env, to.env)}
                    >
                      {busy ? "Promoting…" : `${to.verb} to ${to.label} →`}
                    </button>
                    <span className="hint">opens &amp; merges PR · {lane.env} → {to.env}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Lane summary strip — what's currently in each env, with a shortcut button ── */}
        <div className="rel-summary" data-testid="releases-grid">
          {LANES.map((lane) => {
            const items = lanes[lane.key] ?? [];
            const toPromote = lane.to ? pending(items, lane.to.env) : [];
            return (
              <div className={`scard ${ENV_CLASS[lane.env]}`} key={lane.key} data-testid={`lane-${lane.env}`} data-lane={lane.env}>
                <div className="stop">
                  <span className="dot" />
                  <span className="sname">{lane.label}</span>
                  {lane.env === "prod" && <span className="slive">● LIVE</span>}
                  <span className="snum">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="sempty">Empty.</div>
                ) : (
                  <div className="slist">
                    {items.map((it) => (
                      <Link key={it.run_id} href={`/task/${it.task_id}`} className="sitem" data-testid="release-card">
                        <span className="cid">{it.task_id}</span>
                        <span className="stitle">{it.title ?? it.task_id}</span>
                        {it.merge_commit ? <span className="sha">{it.merge_commit.slice(0, 7)}</span> : null}
                      </Link>
                    ))}
                  </div>
                )}
                {/* Read-only status — the single promote action lives in the ship
                    panel above; lane cards just show what's here + what's queued. */}
                <div className="sfoot">
                  {!lane.to ? (
                    <span className="final">— final stage —</span>
                  ) : toPromote.length > 0 ? (
                    <span className="final" data-testid="lane-awaiting">↑ {toPromote.length} awaiting promotion to {lane.to.label}</span>
                  ) : (
                    <span className="final">— up to date —</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Releases" />
      {/* Header note for the last-opened promotion PR + any promote error. */}
      {lastPr && (
        <div data-testid="promotion-pr" style={{ margin: "10px 22px 0", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(122,209,154,.3)", background: "rgba(122,209,154,.06)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name={lastPr.merged ? "check" : "bolt"} size={13} />
          <span>
            {lastPr.merged
              ? `Promoted ${ENV_LABEL[lastPr.from] ?? lastPr.from} → ${ENV_LABEL[lastPr.to] ?? lastPr.to} — merged`
              : `Opened promotion PR ${ENV_LABEL[lastPr.from] ?? lastPr.from} → ${ENV_LABEL[lastPr.to] ?? lastPr.to} — merge it to finish`}
          </span>
          {lastPr.pr_url ? (
            <a href={lastPr.pr_url} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--green)" }}>#{lastPr.pr_number}</a>
          ) : lastPr.pr_number != null ? (
            <span className="mono">#{lastPr.pr_number}</span>
          ) : null}
        </div>
      )}
      {promoteErr && (
        <div data-testid="promote-error" style={{ margin: "10px 22px 0", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(238,136,136,.4)", background: "rgba(238,136,136,.06)", color: "var(--red)", fontSize: 12.5 }}>
          Couldn’t promote: {promoteErr}
        </div>
      )}
      {body}
    </div>
  );
}
