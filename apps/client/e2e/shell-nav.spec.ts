import { test, expect } from "@playwright/test";
import { sidebar } from "./_helpers";

/**
 * PR-01 — sidebar nav parity (project-scoped items).
 * Verifies the label set + group order match the reference and that each nav
 * item renders the reference's icon. Icons carry a `data-icon` attribute so the
 * inline SVGs are assertable. Data-independent (static layout config).
 */

// [label, expected data-icon] — mirrors docs/ui-parity/sections/01-shell.md.
const ICONS: [string, string][] = [
  ["Overview", "graph"],
  ["Ask", "spark"],
  ["Sprints", "board"],
  ["Backlog", "tasks"],
  ["Product brain", "brain"],
  ["Graph & Issues", "graph"],
  ["Orchestrator", "orch"],
  ["Agent pool", "spark"],
  ["Human gates", "gate"],
  ["Meetings", "mic"],
  ["Feedback", "flag"],
  ["Decisions", "doc"],
  ["CLI / logs", "term"],
  ["Settings", "cog"],
];

test.describe("sidebar nav", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/backlog");
    await expect(sidebar(page)).toBeVisible();
  });

  test("group sections appear in reference order", async ({ page }) => {
    const labels = await sidebar(page).locator(".sb-label").allTextContents();
    expect(labels).toEqual(["Project", "Plan", "Execution", "Inputs", "System"]);
  });

  for (const [label, icon] of ICONS) {
    test(`"${label}" uses the ${icon} icon`, async ({ page }) => {
      const item = sidebar(page).locator(".sb-item", { hasText: label });
      await expect(item).toHaveCount(1);
      await expect(item.locator("svg[data-icon]")).toHaveAttribute("data-icon", icon);
    });
  }

  test("unbuilt ('soon') items do not navigate", async ({ page }) => {
    // Overview is not built yet → rendered as a non-link "soon" item.
    const overview = sidebar(page).locator(".sb-item.soon", { hasText: "Overview" });
    await expect(overview).toHaveCount(1);
    await overview.click();
    await expect(page).toHaveURL(/\/backlog/);
  });
});
