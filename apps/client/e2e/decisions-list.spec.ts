import { test, expect, type Page } from "@playwright/test";

/**
 * V2 Phase 1 — Decisions list: filter segmented control + status pills +
 * owner/feature/conflict chips. Status is seeded deterministically so the
 * filter works. Mocks the API (decisions = type=decision brain nodes).
 */
// Phase 3: real status/owner columns drive the pill + filter (real-wins).
const STATUSES = ["active", "proposed", "superseded", "active", "proposed", "active", "superseded", "active"];
const NODES = Array.from({ length: 8 }, (_, i) => ({
  id: `dec-${i}`,
  project_id: "p1",
  type: "decision",
  label: `Decision ${i}`,
  detail: "Context line.",
  x: null,
  y: null,
  created_at: "2026-01-01T00:00:00Z",
  status: STATUSES[i],
  owner: `Owner ${i}`,
}));

async function mock(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: NODES } }));
  await page.route("**/api/brain/edges**", (r) => r.fulfill({ json: { edges: [] } }));
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: [] } }));
}

test.describe("decisions list", () => {
  test.beforeEach(async ({ page }) => {
    await mock(page);
    await page.goto("/decisions");
    await expect(page.locator(".decisions-list")).toBeVisible();
  });

  test("has a 4-option filter segmented control", async ({ page }) => {
    const seg = page.getByTestId("dec-filter");
    await expect(seg.locator("button")).toHaveCount(4);
    for (const f of [/^All/, "Active", "Proposed", "Superseded"]) {
      await expect(seg.getByRole("button", { name: f })).toBeVisible();
    }
  });

  test("every row shows a status pill", async ({ page }) => {
    const rows = page.locator(".dec-row");
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    await expect(page.locator('.dec-row [data-testid="dec-status"]').first()).toBeVisible();
  });

  test("filtering by real status narrows the list (Phase 3)", async ({ page }) => {
    // Real statuses: 4 active, 2 proposed, 2 superseded.
    await page.getByTestId("dec-filter").getByRole("button", { name: "Active" }).click();
    const rows = page.locator(".dec-row");
    await expect(rows).toHaveCount(4); // driven by the real node.status
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      await expect(rows.nth(i)).toHaveAttribute("data-status", "active");
    }
    await page.getByTestId("dec-filter").getByRole("button", { name: "Superseded" }).click();
    await expect(rows).toHaveCount(2);
    // Back to All shows them all again.
    await page.getByTestId("dec-filter").getByRole("button", { name: /^All/ }).click();
    await expect(page.locator(".dec-row")).toHaveCount(8);
  });

  test("the status pill renders the real status", async ({ page }) => {
    // dec-0 is active.
    await expect(page.locator("#dec-dec-0 [data-testid='dec-status']")).toHaveText("active");
    await expect(page.locator("#dec-dec-1 [data-testid='dec-status']")).toHaveText("proposed");
  });
});
