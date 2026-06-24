"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { IconBtn, Kbd, Avatar } from "@/components/ui";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useProject } from "@/lib/useProject";
import { useShellData } from "@/lib/useShell";
import { useAskDock } from "@/lib/useAskDock";

/** App topbar: brand, project switcher, command pill, and LIVE status pills. */
export function Topbar() {
  const { project } = useProject();
  const { setOpen } = useAskDock();
  const { aliveSessions, defaultAccount } = useShellData(project?.id ?? null);
  const sessionsLabel = aliveSessions === undefined ? "daemon" : `daemon · ${aliveSessions} sessions`;

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
        {/* live: count of alive agent sessions (GET /sessions) */}
        <span className="topbar-pill" title="Live agent sessions">
          <span className="pulse-dot" /> {sessionsLabel}
        </span>
        {/* live: active default account (GET /accounts) — only when one exists */}
        {defaultAccount && (
          <span className="topbar-pill mono" title="Active account">
            <span
              style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }}
            />
            {defaultAccount.label}
          </span>
        )}
        <IconBtn icon="spark" title="Toggle tweaks panel" />
        <Avatar>RM</Avatar>
      </div>
    </header>
  );
}
