"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { useShellData } from "@/lib/useShell";
import { projectColor, projectGlyph, projectSlug } from "@/lib/adapters";
type CountKey =
  | "backlog" | "brain" | "graphIssues" | "decisions" | "sprints"
  | "orchestrator" | "agentPool" | "gates" | "meetings" | "feedback";

interface NavItem {
  label: string;
  icon: IconName;
  href: string;
  /** Real count key (from the API). The badge shows the live number, or nothing
   *  when it's 0 / still loading — never a fabricated value. */
  countKey?: CountKey;
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
      { label: "Sprints", icon: "board", href: "/sprints", countKey: "sprints" },
      { label: "Backlog", icon: "tasks", href: "/backlog", countKey: "backlog" },
      { label: "Product brain", icon: "brain", href: "/brain", countKey: "brain" },
      { label: "Graph & Issues", icon: "graph", href: "/graph-issues", countKey: "graphIssues" },
      { label: "Releases", icon: "bolt", href: "/releases" },
    ],
  },
  {
    label: "Execution",
    items: [
      { label: "Orchestrator", icon: "orch", href: "/orchestrator", countKey: "orchestrator", badge: "live" },
      { label: "Agent pool", icon: "spark", href: "/agent-pool", countKey: "agentPool" },
      { label: "Human gates", icon: "gate", href: "/gate", countKey: "gates", badge: "amber" },
    ],
  },
  {
    label: "Inputs",
    items: [
      { label: "Meetings", icon: "mic", href: "/meetings", countKey: "meetings" },
      { label: "Feedback", icon: "flag", href: "/feedback", countKey: "feedback" },
      { label: "Decisions", icon: "doc", href: "/decisions", countKey: "decisions" },
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
      { label: "Settings", icon: "cog", href: "/settings" },
      { label: "Agents pool", icon: "spark", href: "/accounts", countKey: "agentPool" },
      { label: "Integrations", icon: "link", href: "/integrations" },
      { label: "CLI / logs", icon: "term", href: "/cli" },
    ],
  },
  {
    label: "Projects",
    items: [{ label: "All projects", icon: "graph", href: "/" }],
  },
];

function Badge({ item, counts }: { item: NavItem; counts: Record<CountKey, number | undefined> }) {
  if (item.badge === "kbd") return <span className="badge mono">⌘K</span>;
  const value = item.countKey ? counts[item.countKey] : undefined;
  // Real count only — hide the badge while loading (undefined) or when it's 0,
  // so an empty project shows a clean nav (no fabricated demo numbers).
  if (!value) return null;
  if (item.badge === "live") return <span className="badge">{value} live</span>;
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
