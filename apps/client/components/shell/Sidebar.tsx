"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { useShellData } from "@/lib/useShell";
import { projectColor, projectGlyph, projectSlug } from "@/lib/adapters";

type CountKey = "backlog" | "brain" | "decisions" | "orchestrator" | "agentPool" | "gates";

interface NavItem {
  label: string;
  icon: IconName;
  href: string;
  // Built views show a LIVE count from the API (countKey); "#" items are unbuilt
  // and render a "Próximamente" badge instead. No static/fake counts.
  countKey?: CountKey;
  badgeKind?: "live" | "amber";
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Project",
    items: [
      { label: "Overview", icon: "board", href: "#" },
      { label: "Ask", icon: "brain", href: "#" },
    ],
  },
  {
    label: "Plan",
    items: [
      { label: "Sprints", icon: "cal", href: "#" },
      { label: "Backlog", icon: "tasks", href: "/backlog", countKey: "backlog" },
      { label: "Product brain", icon: "brain", href: "/brain", countKey: "brain" },
      { label: "Graph & Issues", icon: "graph", href: "#" },
    ],
  },
  {
    label: "Execution",
    items: [
      { label: "Orchestrator", icon: "orch", href: "/orchestrator", countKey: "orchestrator", badgeKind: "live" },
      { label: "Agent pool", icon: "board", href: "/agent-pool", countKey: "agentPool" },
      { label: "Human gates", icon: "gate", href: "/gate", countKey: "gates", badgeKind: "amber" },
    ],
  },
  {
    label: "Inputs",
    items: [
      { label: "Meetings", icon: "mic", href: "#" },
      { label: "Feedback", icon: "link", href: "#" },
      { label: "Decisions", icon: "doc", href: "/decisions", countKey: "decisions" },
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
  const { counts } = useShellData(project?.id ?? null);
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
            // A "#" href means the view isn't built yet → mark it "Próximamente",
            // dim it, and render it as a non-navigating element (no URL jump).
            const soon = item.href === "#";
            if (soon) {
              return (
                <div
                  key={item.label}
                  className="sb-item soon"
                  aria-disabled="true"
                  title="Próximamente"
                >
                  <Icon name={item.icon} className="ico" />
                  {item.label}
                  <span className="badge soon">Próximamente</span>
                </div>
              );
            }
            const active = pathname === item.href;
            const count = item.countKey ? counts[item.countKey] : undefined;
            // Only "live" green styling when there's actually something running.
            const live = item.badgeKind === "live" && (count ?? 0) > 0;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={["sb-item", live && "live", active && "active"].filter(Boolean).join(" ")}
              >
                <Icon name={item.icon} className="ico" />
                {item.label}
                {count !== undefined && (
                  <span
                    className={["badge", item.badgeKind === "amber" && count > 0 && "amber"]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {count}
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
