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
 *  promote its tasks forward to the next env. */
const LANES: { key: keyof ReleaseLanes; label: string; env: string; color: string; to?: { env: string; label: string } }[] = [
  { key: "dev", label: "Development", env: "dev", color: "var(--blue)", to: { env: "staging", label: "Staging" } },
  { key: "staging", label: "Staging", env: "staging", color: "var(--amber)", to: { env: "prod", label: "Production" } },
  { key: "prod", label: "Production", env: "prod", color: "var(--green)" },
];

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
  const [lastPr, setLastPr] = React.useState<{ pr_number?: number; pr_url?: string; from: string; to: string } | null>(null);

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
      <div className="rel-grid" data-testid="releases-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, padding: "0 22px 22px" }}>
        {LANES.map((lane) => {
          const items = lanes[lane.key] ?? [];
          const toPromote = lane.to ? pending(items, lane.to.env) : [];
          return (
            <div className="col" key={lane.key} data-testid={`lane-${lane.env}`} data-lane={lane.env} style={{ display: "flex", flexDirection: "column", minHeight: 320 }}>
              <div className="col-head">
                <span className="col-dot" style={{ background: lane.color }} />
                <span>{lane.label}</span>
                <span className="count">{items.length}</span>
              </div>
              <div className="col-body" style={{ flex: 1 }}>
                {items.length === 0 && (
                  <div className="muted" style={{ fontSize: 12, padding: 8, color: "var(--text-4)" }}>—</div>
                )}
                {items.map((it) => (
                  <Link
                    key={it.run_id}
                    href={`/task/${it.task_id}`}
                    className="task-card"
                    data-testid="release-card"
                    style={{ display: "block", textDecoration: "none", color: "inherit" }}
                  >
                    <div className="tc-head">
                      <span className="mono">{it.task_id}</span>
                      {it.merge_commit ? <span className="mono" style={{ marginLeft: "auto", color: "var(--text-4)" }}>{it.merge_commit.slice(0, 7)}</span> : null}
                    </div>
                    <h4>{it.title ?? it.task_id}</h4>
                  </Link>
                ))}
              </div>

              {lane.to && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <button
                    type="button"
                    className="btn primary"
                    data-testid="promote-btn"
                    data-from={lane.env}
                    data-to={lane.to.env}
                    disabled={!!promoting || toPromote.length === 0}
                    onClick={() => promote(lane.env, lane.to!.env)}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    <Icon name="bolt" size={13} />
                    {promoting === `${lane.env}->${lane.to.env}` ? "Opening PR…" : `Promote to ${lane.to.label} →`}
                  </button>
                  {/* Auto-generated release note preview — the tasks this promotion carries. */}
                  {toPromote.length > 0 ? (
                    <div className="muted" data-testid="release-note" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
                      <div style={{ fontWeight: 500, color: "var(--text-3)" }}>Release note · {toPromote.length} task(s)</div>
                      {toPromote.map((it) => (
                        <div key={it.run_id} className="mono">- {it.task_id}: {it.title ?? ""}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Nothing awaiting promotion.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Releases" />
      {/* Header note for the last-opened promotion PR + any promote error. */}
      {lastPr && (
        <div data-testid="promotion-pr" style={{ margin: "10px 22px 0", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(122,209,154,.3)", background: "rgba(122,209,154,.06)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="bolt" size={13} />
          <span>Opened promotion PR {lastPr.from} → {lastPr.to}</span>
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
