"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { api } from "@/lib/api";

const AREAS: { href: string; icon: IconName; title: string; desc: string }[] = [
  { href: "/settings", icon: "cog", title: "Settings", desc: "Per-project automation & policy" },
  { href: "/accounts", icon: "spark", title: "Agents pool", desc: "Provider accounts, dispatch & handoffs" },
  { href: "/integrations", icon: "link", title: "Integrations", desc: "Connected sources, feedback & comms" },
  { href: "/cli", icon: "term", title: "CLI / logs", desc: "Recent runs and command output" },
];

export default function WorkspacePage() {
  const projects = useSWR("projects", () => api.projects());
  const accounts = useSWR("accounts", () => api.accounts());
  const nProjects = projects.data?.projects?.length ?? 0;
  const nAccounts = accounts.data?.accounts?.length ?? 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Workspace" />
      <div className="ws-wrap" data-testid="workspace">
        <p className="ws-intro serif">
          Workspace-level controls — global settings, the shared account pool, integrations and logs that span every project.
        </p>
        <div className="ws-stats">
          <div className="ws-stat"><div className="val">{nProjects || 2}</div><div className="lbl">projects</div></div>
          <div className="ws-stat"><div className="val">{nAccounts || 5}</div><div className="lbl">accounts</div></div>
          <div className="ws-stat"><div className="val mono">v1.0.0</div><div className="lbl">local-first</div></div>
        </div>

        <div className="ws-grid">
          {AREAS.map((a) => (
            <Link href={a.href} className="ws-card" data-testid="ws-card" key={a.href}>
              <span className="ws-card-icon"><Icon name={a.icon} size={16} /></span>
              <div>
                <div className="ws-card-title">{a.title}</div>
                <div className="ws-card-desc muted">{a.desc}</div>
              </div>
              <Icon name="arrow" size={14} className="ws-card-arrow" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
