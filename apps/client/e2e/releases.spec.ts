import { test, expect, type Page } from "@playwright/test";

/**
 * Releases — Task Lifecycle V2. Three deployment lanes (Development / Staging /
 * Production) from the real release list, with Promote buttons that open the
 * env-promotion PR. Mocks /api/projects (so useProject resolves) + the release
 * list + the promote endpoint.
 */

const RELEASES = {
  dev: [
    { run_id: "r1", task_id: "T-1", title: "Ship pricing page", merge_commit: "abc1234def", env_dev_at: "2026-01-03", env_staging_at: null, env_prod_at: null },
  ],
  staging: [
    { run_id: "r2", task_id: "T-2", title: "Refactor auth", merge_commit: "beef5678aaa", env_dev_at: "2026-01-01", env_staging_at: "2026-01-02", env_prod_at: null },
  ],
  prod: [] as unknown[],
};

async function mock(page: Page, releases: unknown = RELEASES) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/projects/*/releases", (r) => r.fulfill({ json: { releases } }));
}

test.describe("releases", () => {
  test("renders three deployment lanes", async ({ page }) => {
    await mock(page);
    await page.goto("/releases");
    await expect(page.getByTestId("releases-grid")).toBeVisible();
    await expect(page.getByTestId("lane-dev")).toContainText("Development");
    await expect(page.getByTestId("lane-staging")).toContainText("Staging");
    await expect(page.getByTestId("lane-prod")).toContainText("Production");
  });

  test("the ready-to-ship panel lists every available promotion, prod-first", async ({ page }) => {
    await mock(page);
    await page.goto("/releases");
    const rows = page.getByTestId("ship-row");
    await expect(rows).toHaveCount(2);
    // staging→prod ("Ship") sits on top; dev→staging ("Promote") below.
    await expect(rows.nth(0)).toHaveAttribute("data-to", "prod");
    await expect(rows.nth(0)).toContainText("Ship to Production");
    await expect(rows.nth(1)).toHaveAttribute("data-to", "staging");
    await expect(rows.nth(1)).toContainText("Promote to Staging");
  });

  test("lanes list their tasks", async ({ page }) => {
    await mock(page);
    await page.goto("/releases");
    await expect(page.getByTestId("lane-dev")).toContainText("Ship pricing page");
    await expect(page.getByTestId("lane-staging")).toContainText("Refactor auth");
  });

  test("the single promote action lives in the ship rows, not the lane cards", async ({ page }) => {
    await mock(page);
    await page.goto("/releases");
    // Two ready promotions → two buttons, both in the ship panel. Lane cards are
    // read-only status (no duplicate buttons).
    await expect(page.getByTestId("promote-btn")).toHaveCount(2);
    await expect(page.getByTestId("lane-dev").getByTestId("promote-btn")).toHaveCount(0);
    await expect(page.getByTestId("lane-prod").getByTestId("promote-btn")).toHaveCount(0);
    // The dev card notes what's queued upward instead.
    await expect(page.getByTestId("lane-dev").getByTestId("lane-awaiting")).toContainText("awaiting promotion");
  });

  test("Promote auto-merges the env PR and shows the promoted note", async ({ page }) => {
    let promoted: { from_env?: string; to_env?: string } | null = null;
    await mock(page);
    await page.route("**/api/projects/*/promote", (r) => {
      promoted = r.request().postDataJSON();
      return r.fulfill({ json: { pr_number: 42, pr_url: "https://gh/pr/42", merged: true, merge_commit: "abc123" } });
    });
    await page.goto("/releases");
    await page.getByTestId("promote-btn").filter({ hasText: "Promote to Staging" }).click();
    await expect.poll(() => promoted?.from_env).toBe("dev");
    await expect.poll(() => promoted?.to_env).toBe("staging");
    await expect(page.getByTestId("promotion-pr")).toContainText("Promoted");
    await expect(page.getByTestId("promotion-pr")).toContainText("merged");
    await expect(page.getByTestId("promotion-pr")).toContainText("#42");
  });

  test("when auto-merge fails, the note says the PR is open and must be merged", async ({ page }) => {
    await mock(page);
    await page.route("**/api/projects/*/promote", (r) =>
      r.fulfill({ json: { pr_number: 42, pr_url: "https://gh/pr/42", merged: false, merge_error: "checks pending" } }),
    );
    await page.goto("/releases");
    await page.getByTestId("promote-btn").filter({ hasText: "Promote to Staging" }).click();
    await expect(page.getByTestId("promotion-pr")).toContainText("merge it to finish");
  });

  test("a lane with nothing awaiting promotion shows no ship row for it", async ({ page }) => {
    // dev task already in staging → nothing to promote from dev.
    await mock(page, {
      dev: [{ run_id: "r1", task_id: "T-1", title: "Done", merge_commit: "x", env_dev_at: "2026-01-03", env_staging_at: "2026-01-04", env_prod_at: null }],
      staging: [],
      prod: [],
    });
    await page.goto("/releases");
    await expect(page.getByTestId("ship-row")).toHaveCount(0);
    await expect(page.getByTestId("ship-panel")).toContainText("Everything’s promoted");
    await expect(page.getByTestId("lane-dev").getByTestId("lane-awaiting")).toHaveCount(0);
  });
});
