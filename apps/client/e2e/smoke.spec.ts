import { test, expect } from "@playwright/test";
import { sidebar, navItem } from "./_helpers";

/**
 * PR-00 smoke: proves the harness + dev server work and the shell renders.
 * Intentionally data-independent — the sidebar comes from static layout config,
 * so this passes even if the API at :8765 is not running.
 */
test.describe("smoke", () => {
  test("app boots and renders the shell", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // "/" redirects to /backlog; either way the shell must mount.
    await page.goto("/");

    await expect(sidebar(page)).toBeVisible();
    // A couple of known built nav items prove the sidebar config rendered.
    await expect(navItem(page, "Backlog")).toBeVisible();
    await expect(navItem(page, "Orchestrator")).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
