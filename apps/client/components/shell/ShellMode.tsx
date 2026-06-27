"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Toggles the reference shell modes on <body> by route (mirrors the reference
 * App effect): `home-mode` = full-bleed home (sidebar hidden); `workspace-level`
 * = home or /workspace/* (lavender wash + ws-only sidebar groups). Rendered in
 * the layout; the layout itself stays a server component.
 */
export function ShellMode() {
  const pathname = usePathname();
  useEffect(() => {
    const isHome = pathname === "/" || pathname === "/home";
    const isWorkspace = pathname.startsWith("/workspace");
    document.body.classList.toggle("home-mode", isHome);
    document.body.classList.toggle("workspace-level", isHome || isWorkspace);
    return () => {
      document.body.classList.remove("home-mode", "workspace-level");
    };
  }, [pathname]);
  return null;
}
