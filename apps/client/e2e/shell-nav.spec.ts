import { test, expect } from "@playwright/test";
import { sidebar } from "./_helpers";

/**
 * V2 PR-2 — full-parity sidebar (project + workspace groups, seeded badges,
 * Brain↔Graph split into separate routes, Ask ⌘K badge, no "Próximamente").
 */

// [label, expected data-icon] for the project-scoped nav.
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

test.describe("sidebar nav (full parity)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/backlog");
    await expect(sidebar(page)).toBeVisible();
  });

  test("project group sections appear in reference order", async ({ page }) => {
    const labels = await sidebar(page).locator(".proj-only .sb-label").allTextContents();
    expect(labels).toEqual(["Project", "Plan", "Execution", "Inputs", "System"]);
  });

  for (const [label, icon] of ICONS) {
    test(`"${label}" uses the ${icon} icon`, async ({ page }) => {
      const item = sidebar(page).locator(".proj-only .sb-item", { hasText: label });
      await expect(item.first().locator("svg[data-icon]")).toHaveAttribute("data-icon", icon);
    });
  }

  test("Product brain and Graph & Issues are separate routes", async ({ page }) => {
    await expect(
      sidebar(page).locator('.proj-only .sb-item[href="/brain"]', { hasText: "Product brain" }),
    ).toHaveCount(1);
    await expect(
      sidebar(page).locator('.proj-only .sb-item[href="/graph-issues"]', { hasText: "Graph & Issues" }),
    ).toHaveCount(1);
  });

  test("Ask has a ⌘K badge", async ({ page }) => {
    const ask = sidebar(page).locator(".proj-only .sb-item", { hasText: "Ask" });
    await expect(ask.locator(".badge")).toHaveText("⌘K");
  });

  test("no 'Próximamente' / soon items remain", async ({ page }) => {
    await expect(page.locator(".sb-item.soon")).toHaveCount(0);
    await expect(page.getByText("Próximamente")).toHaveCount(0);
  });

  test("seeded badges render the reference values", async ({ page }) => {
    const item = (label: string) => sidebar(page).locator(".proj-only .sb-item", { hasText: label });
    await expect(item("Sprints").locator(".badge")).toHaveText("26");
    await expect(item("Graph & Issues").locator(".badge")).toHaveText("7");
    await expect(item("Meetings").locator(".badge")).toHaveText("42");
    await expect(item("Feedback").locator(".badge")).toHaveText("312");
  });

  test("workspace level swaps to the ws-only groups", async ({ page }) => {
    await page.goto("/workspace/settings");
    await expect(page.locator("body")).toHaveClass(/workspace-level/);
    const wsLabels = await sidebar(page).locator(".ws-only .sb-label").allTextContents();
    expect(wsLabels).toEqual(["Workspace", "Projects"]);
    // Project groups are hidden at workspace level.
    await expect(sidebar(page).locator(".proj-only")).toBeHidden();
  });
});
