"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useProject } from "@/lib/useProject";
import { projectColor, projectGlyph } from "@/lib/adapters";

/** Topbar project switcher: glyph + name + chevron, with a dropdown of projects. */
export function ProjectSwitcher() {
  const { projects, project, setProject } = useProject();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const isPlaceholder = !project;
  const color = project ? projectColor(project) : null;

  return (
    <div
      ref={ref}
      className={["proj-switcher", isPlaceholder && "placeholder", open && "open"]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="proj-glyph"
          style={
            color
              ? { background: color + "18", color, borderColor: color + "40" }
              : { color: "var(--accent)", borderColor: "var(--text-4)" }
          }
        >
          {project ? projectGlyph(project) : ""}
        </span>
        <div className="proj-meta">
          <div className="proj-name">{project ? project.name : "Select a project"}</div>
        </div>
        <Icon name="chev" size={10} className="text-text-3" />
      </button>

      {open && (
        <div className="proj-menu" role="menu">
          <div className="proj-menu-h">Switch project</div>
          {projects.map((p) => {
            const c = projectColor(p);
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={p.id === project?.id}
                className={["proj-menu-row", p.id === project?.id && "active"]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setProject(p.id);
                  setOpen(false);
                }}
              >
                <span
                  className="proj-glyph"
                  style={{ background: c + "18", color: c, borderColor: c + "40" }}
                >
                  {projectGlyph(p)}
                </span>
                <span style={{ fontSize: 12, color: "var(--text)" }}>{p.name}</span>
                <span className="check">
                  <Icon name="check" size={11} />
                </span>
              </button>
            );
          })}
          <div className="proj-menu-sep" />
          {/* M1: workspace-level scope not yet wired — non-functional placeholder. */}
          <button type="button" className="proj-menu-action" disabled>
            <Icon name="graph" size={11} /> All projects
          </button>
          <button type="button" className="proj-menu-action" disabled>
            <Icon name="plus" size={11} /> New project
          </button>
        </div>
      )}
    </div>
  );
}
