"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { useShellData } from "@/lib/useShell";
import { projectColor, projectGlyph, projectSlug } from "@/lib/adapters";
import { DEMO_SIDEBAR_COUNTS, DEMO_WS_COUNTS } from "@/lib/demo";

type CountKey = "backlog" | "brain" | "decisions" | "orchestrator" | "agentPool" | "gates";

interface NavItem {
  label: string;
  icon: IconName;
  href: string;
  /** Real count key (from the API) — used when present, else falls to `seed`. */
  countKey?: CountKey;
  /** Seed badge value (reference literal) when the API has no count. */
  seed?: number | string;
  /** Badge style: live = green "N live", amber = gate warning, kbd = ⌘K chip. */
  badge?: "live" | "amber" | "kbd";
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Project-scoped groups (reference order/icons/badges). Brain and Graph & Issues
// are SEPARATE routes — Product brain = the rich Explorer, Graph & Issues = the
// node graph.
const PROJECT_GROUPS: NavGroup[] = [
  {
    label: "Project",
    items: [
      { label: "Overview", icon: "graph", href: "/overview" },
      { label: "Ask", icon: "spark", href: "/ask", badge: "kbd" },
    ],
  },
  {
    label: "Plan",
    items: [
      { label: "Sprints", icon: "board", href: "/sprints", seed: DEMO_SIDEBAR_COUNTS.sprints },
      { label: "Backlog", icon: "tasks", href: "/backlog", countKey: "backlog", seed: DEMO_SIDEBAR_COUNTS.backlog },
      { label: "Product brain", icon: "brain", href: "/brain", countKey: "brain", seed: DEMO_SIDEBAR_COUNTS.brain },
      { label: "Graph & Issues", icon: "graph", href: "/graph-issues", seed: DEMO_SIDEBAR_COUNTS.graphIssues },
    ],
  },
  {
    label: "Execution",
    items: [
      { label: "Orchestrator", icon: "orch", href: "/orchestrator", countKey: "orchestrator", seed: DEMO_SIDEBAR_COUNTS.orchestrator, badge: "live" },
      { label: "Agent pool", icon: "spark", href: "/agent-pool", countKey: "agentPool", seed: DEMO_SIDEBAR_COUNTS.agentPool },
      { label: "Human gates", icon: "gate", href: "/gate", countKey: "gates", seed: DEMO_SIDEBAR_COUNTS.gates, badge: "amber" },
    ],
  },
  {
    label: "Inputs",
    items: [
      { label: "Meetings", icon: "mic", href: "/meetings", seed: DEMO_SIDEBAR_COUNTS.meetings },
      { label: "Feedback", icon: "flag", href: "/feedback", seed: DEMO_SIDEBAR_COUNTS.feedback },
      { label: "Decisions", icon: "doc", href: "/decisions", countKey: "decisions", seed: DEMO_SIDEBAR_COUNTS.decisions },
    ],
  },
  {
    label: "System",
    items: [
      { label: "CLI / logs", icon: "term", href: "/cli" },
      { label: "Settings", icon: "cog", href: "/settings" },
    ],
  },
];

// Workspace-scoped groups (shown at workspace level via CSS .ws-only).
const WORKSPACE_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Settings", icon: "cog", href: "/workspace/settings" },
      { label: "Agents pool", icon: "spark", href: "/workspace/agents", seed: DEMO_WS_COUNTS.agentsPool },
      { label: "Integrations", icon: "link", href: "/workspace/integrations", seed: DEMO_WS_COUNTS.integrations },
      { label: "CLI / logs", icon: "term", href: "/workspace/cli" },
    ],
  },
  {
    label: "Projects",
    items: [{ label: "All projects", icon: "graph", href: "/", seed: DEMO_WS_COUNTS.projects }],
  },
];

function Badge({ item, counts }: { item: NavItem; counts: Record<CountKey, number | undefined> }) {
  if (item.badge === "kbd") return <span className="badge mono">⌘K</span>;
  const real = item.countKey ? counts[item.countKey] : undefined;
  // Real-wins; otherwise the reference seed value.
  let value: number | string | undefined = real ?? item.seed;
  if (value === undefined) return null;
  if (item.badge === "live") {
    // Real count → "N live"; seed is already "7 live".
    const text = typeof value === "number" ? `${value} live` : value;
    return <span className="badge">{text}</span>;
  }
  return (
    <span className={["badge", item.badge === "amber" && "amber"].filter(Boolean).join(" ")}>
      {value}
    </span>
  );
}

function NavItems({ groups, counts, pathname }: {
  groups: NavGroup[];
  counts: Record<CountKey, number | undefined>;
  pathname: string;
  ws?: boolean;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="sb-section">
          <div className="sb-label">{group.label}</div>
          {group.items.map((item) => {
            const active = pathname === item.href;
            const live = item.badge === "live" && (counts[item.countKey as CountKey] ?? 1) > 0;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={["sb-item", live && "live", active && "active"].filter(Boolean).join(" ")}
              >
                <Icon name={item.icon} className="ico" />
                {item.label}
                <Badge item={item} counts={counts} />
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** Left sidebar: project header card + grouped nav + footer. Renders both the
 *  project and workspace nav; CSS (proj-only / ws-only) shows the right set. */
export function Sidebar() {
  const { project } = useProject();
  const pathname = usePathname();
  const { counts } = useShellData(project?.id ?? null);
  const color = project ? projectColor(project) : null;

  return (
    <aside className="sidebar">
      {/* Project header (shown in project mode) */}
      <div className="sb-proj-head proj-only-h">
        {project ? (
          <>
            <span
              className="proj-glyph"
              style={{ background: color! + "18", color: color!, borderColor: color! + "40", width: 24, height: 24, fontSize: 11 }}
            >
              {projectGlyph(project)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sb-proj-name">{project.name}</div>
              <div className="sb-proj-slug mono">{projectSlug(project)}</div>
            </div>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>Select a project</span>
        )}
      </div>

      {/* Workspace header (shown at workspace level) */}
      <div className="sb-proj-head ws-only-h">
        <span
          className="proj-glyph"
          style={{ background: "rgba(201,184,255,.06)", color: "var(--accent)", borderColor: "rgba(201,184,255,.2)", width: 24, height: 24 }}
        >
          <Icon name="graph" size={13} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sb-proj-name">Workspace</div>
          <div className="sb-proj-slug mono">all projects · global</div>
        </div>
      </div>

      <div className="proj-only">
        <NavItems groups={PROJECT_GROUPS} counts={counts} pathname={pathname} />
      </div>
      <div className="ws-only">
        <NavItems groups={WORKSPACE_GROUPS} counts={counts} pathname={pathname} ws />
      </div>

      <div className="sb-foot">
        Local-first · v1.0.0
        <br />
        <span className="mono">~/.spade · 84 MB</span>
      </div>
    </aside>
  );
}
