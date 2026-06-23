"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { IconBtn, Kbd, Avatar } from "@/components/ui";
import { ProjectSwitcher } from "./ProjectSwitcher";

/** App topbar: brand, project switcher, command pill, and live status pills. */
export function Topbar() {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark" />
        Spade
      </Link>

      <ProjectSwitcher />

      {/* Command pill — non-functional for M1, styled only. */}
      <div className="topbar-pill" style={{ marginLeft: 4 }}>
        <Icon name="search" size={12} />
        <span className="muted">Ask the brain…</span>
        <Kbd>⌘K</Kbd>
      </div>

      <div className="topbar-right">
        {/* static M1 */}
        <span className="topbar-pill">
          <span className="pulse-dot" /> daemon · 7 sessions
        </span>
        {/* static M1 */}
        <span className="topbar-pill mono">sprint 26 · day 2/10</span>
        {/* static M1 */}
        <span className="topbar-pill" title="Active Claude account">
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--green)",
            }}
          />
          acct: rmurphy@acme · 62%
        </span>
        <IconBtn icon="spark" title="Toggle tweaks panel" />
        {/* static M1 */}
        <Avatar>RM</Avatar>
      </div>
    </header>
  );
}
