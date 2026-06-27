import { test, expect, type Page } from "@playwright/test";

/**
 * PR-07 — Task detail head actions (honest subset).
 * The reference TaskView is mostly fabricated demo data (feedback stats, quote
 * cards, sparkline metric, sprint/estimate/branch, "will write back"); under the
 * no-fabrication policy those are omitted. The legitimate delta is the page-head:
 * a real status chip + "View in graph" / "Resume pipeline" navigation.
 */

const TASK = {
  id: "T-1",
  project_id: "p1",
  title: "Optimize mobile checkout speed",
  feature: "Checkout",
  priority: 0,
  status: "in_progress",
  origin_quote: "Checkout is painfully slow on my phone.",
  origin_source: "Intercom",
  description: "Speed up the mobile checkout flow.",
  created_at: "2026-01-01T00:00:00Z",
  nodes: [],
  links: [],
};

async function mockTask(page: Page) {
  await page.route("**/api/tasks/*/comments", (r) => r.fulfill({ json: { comments: [] } }));
  await page.route("**/api/tasks/*", (r) => r.fulfill({ json: TASK }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: [] } }));
}

test.describe("task detail", () => {
  test.beforeEach(async ({ page }) => {
    await mockTask(page);
    await page.goto("/task/T-1");
    await expect(page.locator(".td-title")).toHaveText("Optimize mobile checkout speed");
  });

  test("page head shows the real status chip", async ({ page }) => {
    const chip = page.getByTestId("task-status-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("in_progress");
  });

  test('"View in graph" links to the brain', async ({ page }) => {
    await expect(page.getByRole("link", { name: /View in graph/ })).toHaveAttribute("href", "/brain");
  });

  test('"Resume pipeline" links to the orchestrator', async ({ page }) => {
    await expect(page.getByRole("link", { name: /Resume pipeline/ })).toHaveAttribute("href", "/orchestrator");
  });

  test("breadcrumb links back to the backlog", async ({ page }) => {
    await expect(page.locator(".breadcrumb").getByRole("link", { name: "Backlog" })).toHaveAttribute("href", "/backlog");
  });
});
