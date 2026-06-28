"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import { projectColor, projectGlyph, projectSlug } from "@/lib/adapters";
import { DEMO_TRIAGE, TRIAGE_KIND_COLOR, DEMO_HOME_KPIS, projectMeta } from "@/lib/demo";
import type { Project } from "@/lib/types";

type SortKey = "name" | "backlog" | "brain" | "workers";

/**
 * Home — full-bleed cross-project triage dashboard (reference mod_04). Sidebar
 * is hidden (home-mode). Real project list wins; triage feed + KPIs + project
 * meta are seeded.
 */
export default function Home() {
  const { data } = useSWR("projects", () => api.projects());
  const projects: Project[] = data?.projects ?? [];
  const [sort, setSort] = React.useState<SortKey>("backlog");

  const rows = projects
    .map((p) => ({ p, m: projectMeta(p.id) }))
    .sort((a, b) => (sort === "name" ? a.p.name.localeCompare(b.p.name) : b.m[sort] - a.m[sort]));

  return (
    <div data-testid="home-root" className="home">
      <div className="home-head">
        <h1>Home</h1>
        <div className="muted" style={{ fontSize: 13 }}>Cross-project triage · {projects.length || 2} projects</div>
      </div>

      {/* KPI band */}
      <div className="home-kpis" data-testid="home-kpis">
        {DEMO_HOME_KPIS.map((k) => (
          <div className="home-kpi" key={k.lbl}>
            <div className="lbl">{k.lbl}</div>
            <div className="val" style={k.color ? { color: k.color } : undefined}>{k.val}</div>
            <div className="sub muted">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="home-grid">
        {/* Triage feed */}
        <section className="home-triage" data-testid="triage-feed">
          <div className="home-sec-h">Triage feed<span className="count mono">{DEMO_TRIAGE.length}</span></div>
          {DEMO_TRIAGE.map((t, i) => (
            <div className="tri-item" data-testid="tri-item" key={i} data-sev={t.sev}>
              <span className="tri-dot" style={{ background: TRIAGE_KIND_COLOR[t.kind] }} />
              <div className="tri-body">
                <div className="tri-title">{t.title}</div>
                <div className="tri-meta muted">{t.project} · {t.meta}</div>
              </div>
              <span className="tri-kind mono">{t.kind}</span>
            </div>
          ))}
        </section>

        {/* Projects health table */}
        <aside className="home-projects">
          <div className="home-sec-h">Projects</div>
          <div className="proj-table" data-testid="projects-table">
            <div className="th">Project</div>
            <button className="th sortable" onClick={() => setSort("backlog")}>Backlog</button>
            <button className="th sortable" onClick={() => setSort("brain")}>Brain</button>
            <button className="th sortable" onClick={() => setSort("workers")}>Agents</button>
            {(rows.length ? rows : SEED_ROWS).map(({ p, m }) => (
              <Link className="proj-row" href="/overview" key={p.id} data-testid="proj-row">
                <div className="td">
                  <span className="proj-glyph" style={{ background: (projectColor(p) ?? "var(--accent)") + "18", color: projectColor(p) ?? "var(--accent)", width: 20, height: 20, fontSize: 10 }}>
                    {projectGlyph(p)}
                  </span>
                  <span>
                    <div className="proj-name">{p.name}</div>
                    <div className="proj-slug mono muted">{projectSlug(p)} · sprint {m.sprint}</div>
                  </span>
                </div>
                <div className="td mono">{m.backlog}</div>
                <div className="td mono">{m.brain}</div>
                <div className="td mono">{m.workers}</div>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// Fallback rows when no real projects are loaded (so the dashboard never looks empty).
const SEED_ROWS = [
  { p: { id: "acme", name: "Acme Storefront", path: "acme/web", account_strategy: "", model_ceiling: null, autopilot: 0, created_at: "" } as Project, m: projectMeta("acme") },
  { p: { id: "beta", name: "Beta App", path: "beta/app", account_strategy: "", model_ceiling: null, autopilot: 0, created_at: "" } as Project, m: projectMeta("beta") },
];
