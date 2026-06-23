"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useProject } from "@/lib/useProject";
import { projectColor, projectGlyph } from "@/lib/adapters";

/** Derive a project id (slug) from a display name. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Topbar project switcher: glyph + name + chevron, with a dropdown of projects. */
export function ProjectSwitcher() {
  const { projects, project, setProject } = useProject();
  const { mutate } = useSWRConfig();
  const { data: env } = useSWR("env", () => api.env());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // New-project inline form state.
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Track whether the user has hand-edited the path (stop auto-syncing if so).
  const [pathDirty, setPathDirty] = useState(false);

  // Default project workspace path: {home}/.spade/projects/{slug} (id from name).
  // Falls back to a literal "~" path if the host home isn't known yet (the API
  // expands ~ on create either way).
  const pathTemplate = (slug: string) => {
    const base = env?.home ? env.home.replace(/\/+$/, "") + "/.spade" : "~/.spade";
    return `${base}/projects/${slug}`;
  };
  const previewId = slugify(name);

  // Keep the path in sync with the name until the user edits it by hand.
  useEffect(() => {
    if (creating && !pathDirty) setPath(pathTemplate(previewId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, pathDirty, previewId, env?.home]);

  const resetCreate = () => {
    setCreating(false);
    setName("");
    setPath("");
    setErr(null);
    setBusy(false);
    setPathDirty(false);
  };

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const id = slugify(name);
    if (!id) return setErr("Enter a project name.");
    if (!path.trim()) return setErr("Enter a project path.");
    if (projects.some((p) => p.id === id)) return setErr(`A project "${id}" already exists.`);
    setBusy(true);
    setErr(null);
    try {
      await api.createProject({ id, name: name.trim(), path: path.trim() });
      await mutate("projects"); // refresh the list everywhere
      setProject(id); // switch to the new project
      resetCreate();
      setOpen(false);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to create project.");
      setBusy(false);
    }
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        resetCreate();
      }
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
        style={{ all: "unset", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
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
          {creating ? (
            <form className="proj-create" onSubmit={onCreate}>
              <div className="proj-menu-h">New project</div>
              <label className="proj-field">
                <span>Name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Project"
                />
              </label>
              <label className="proj-field">
                <span>Path</span>
                <input
                  value={path}
                  onChange={(e) => {
                    setPath(e.target.value);
                    setPathDirty(true);
                  }}
                  placeholder={pathTemplate("my-project")}
                />
                <span className="proj-field-hint">~ expands to your home directory</span>
              </label>
              {previewId && (
                <div className="proj-create-id mono">
                  id: {previewId}
                </div>
              )}
              {err && <div className="proj-create-err">{err}</div>}
              <div className="proj-create-actions">
                <button type="button" className="btn ghost xs" onClick={resetCreate} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn primary xs" disabled={busy}>
                  {busy ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          ) : (
            <>
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
              {/* All projects (workspace scope) not yet built — see docs/backlog. */}
              <button type="button" className="proj-menu-action" disabled title="Próximamente">
                <Icon name="graph" size={11} /> All projects
              </button>
              <button
                type="button"
                className="proj-menu-action"
                onClick={() => setCreating(true)}
              >
                <Icon name="plus" size={11} /> New project
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
