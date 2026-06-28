"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Btn, Kbd, Avatar } from "@/components/ui";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useProject } from "@/lib/useProject";
import { useShellData } from "@/lib/useShell";
import { useAskDock } from "@/lib/useAskDock";

/** App topbar: brand, project switcher, command pill, and LIVE status pills. */
export function Topbar() {
  const { project } = useProject();
  const { setOpen } = useAskDock();
  const { aliveSessions, defaultAccount, currentSprint } = useShellData(project?.id ?? null);
  const sessionsLabel = aliveSessions === undefined ? "daemon" : `daemon · ${aliveSessions} sessions`;
  const sprintLabel = currentSprint
    ? `sprint ${currentSprint.number}${currentSprint.day_label ? ` · ${currentSprint.day_label}` : ""}`
    : null;

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark" />
        Spade
      </Link>

      <ProjectSwitcher />

      {/* Command pill — opens the "Ask the brain" chat dock. */}
      <button
        type="button"
        className="topbar-pill"
        style={{ marginLeft: 4 }}
        onClick={() => setOpen(true)}
      >
        <Icon name="search" size={12} />
        <span className="muted">Ask the brain…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="topbar-right">
        {/* live: count of alive agent sessions (GET /sessions) — real */}
        <span className="topbar-pill" title="Live agent sessions">
          <span className="pulse-dot" /> {sessionsLabel}
        </span>
        {/* real current sprint (GET /sprints) — hidden when the project has none.
            Hidden at workspace level via CSS (.workspace-level .topbar-sprint). */}
        {sprintLabel && (
          <span className="topbar-pill mono topbar-sprint" title="Current sprint">
            {sprintLabel}
          </span>
        )}
        {/* active default account (GET /accounts) — real label, no fabricated usage % */}
        {defaultAccount && (
          <span className="topbar-pill mono" title="Active Claude account">
            <span
              style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }}
            />
            acct: {defaultAccount.label}
          </span>
        )}
        <Btn variant="ghost" title="Toggle tweaks panel" aria-label="Toggle tweaks panel">
          <Icon name="spark" size={14} />
        </Btn>
        <Avatar>RM</Avatar>
      </div>
    </header>
  );
}
