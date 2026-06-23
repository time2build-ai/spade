"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { projectColor, projectGlyph, projectSlug } from "@/lib/adapters";

interface NavItem {
  label: string;
  icon: IconName;
  href: string;
  badge?: string;
  badgeKind?: "live" | "amber";
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Only "Backlog" routes to a real page; everything else is a styled placeholder
// (href "#") so the shell looks complete without 404s. Badge counts are static
// design values. /* static M1 */
const GROUPS: NavGroup[] = [
  {
    label: "Project",
    items: [
      { label: "Overview", icon: "board", href: "#" },
      { label: "Ask", icon: "brain", href: "#", badge: "⌘K" },
    ],
  },
  {
    label: "Plan",
    items: [
      { label: "Sprints", icon: "cal", href: "#", badge: "26" },
      { label: "Backlog", icon: "tasks", href: "/backlog", badge: "23" },
      { label: "Product brain", icon: "brain", href: "/brain", badge: "847" },
      { label: "Graph & Issues", icon: "graph", href: "#", badge: "7" },
    ],
  },
  {
    label: "Execution",
    items: [
      { label: "Orchestrator", icon: "orch", href: "/orchestrator", badge: "7", badgeKind: "live" },
      { label: "Agent pool", icon: "board", href: "/agent-pool", badge: "10" },
      { label: "Human gates", icon: "gate", href: "/gate", badge: "2", badgeKind: "amber" },
    ],
  },
  {
    label: "Inputs",
    items: [
      { label: "Meetings", icon: "mic", href: "#", badge: "42" },
      { label: "Feedback", icon: "link", href: "#", badge: "312" },
      { label: "Decisions", icon: "doc", href: "/decisions", badge: "94" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "CLI / logs", icon: "term", href: "#" },
      { label: "Settings", icon: "cog", href: "#" },
    ],
  },
];

/** Left sidebar: project header card + grouped nav + footer. */
export function Sidebar() {
  const { project } = useProject();
  const pathname = usePathname();
  const color = project ? projectColor(project) : null;

  return (
    <aside className="sidebar">
      {project ? (
        <div className="sb-proj-head">
          <span
            className="proj-glyph"
            style={{
              background: color! + "18",
              color: color!,
              borderColor: color! + "40",
              width: 24,
              height: 24,
              fontSize: 11,
            }}
          >
            {projectGlyph(project)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sb-proj-name">{project.name}</div>
            <div className="sb-proj-slug mono">{projectSlug(project)}</div>
          </div>
        </div>
      ) : (
        <div className="sb-proj-head ws">
          <span
            className="proj-glyph"
            style={{
              background: "rgba(201,184,255,.06)",
              color: "var(--accent)",
              borderColor: "rgba(201,184,255,.2)",
              width: 24,
              height: 24,
            }}
          >
            <Icon name="graph" size={13} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sb-proj-name">Workspace</div>
            <div className="sb-proj-slug mono">all projects · global</div>
          </div>
        </div>
      )}

      {GROUPS.map((group) => (
        <div key={group.label} className="sb-section">
          <div className="sb-label">{group.label}</div>
          {group.items.map((item) => {
            const active = item.href !== "#" && pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={["sb-item", item.badgeKind === "live" && "live", active && "active"]
                  .filter(Boolean)
                  .join(" ")}
              >
                <Icon name={item.icon} className="ico" />
                {item.label}
                {item.badge && (
                  <span
                    className={["badge", item.badgeKind === "amber" && "amber"]
                      .filter(Boolean)
                      .join(" ")}
                    style={item.badge === "⌘K" ? { fontSize: "9.5px" } : undefined}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}

      {/* static design label */}
      <div className="sb-foot">
        Local-first · v1.0.0
        <br />
        <span className="mono">~/.spade · 84 MB</span>
      </div>
    </aside>
  );
}
