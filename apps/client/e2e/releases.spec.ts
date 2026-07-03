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
    await expect(page.getByTestId("lane-dev")).toBeVisible();
    await expect(page.getByTestId("lane-staging")).toBeVisible();
    await expect(page.getByTestId("lane-prod")).toBeVisible();
    for (const label of ["Development", "Staging", "Production"]) {
      await expect(page.locator(".col-head", { hasText: label })).toHaveCount(1);
    }
  });

  test("lanes list their tasks", async ({ page }) => {
    await mock(page);
    await page.goto("/releases");
    await expect(page.getByTestId("lane-dev")).toContainText("Ship pricing page");
    await expect(page.getByTestId("lane-staging")).toContainText("Refactor auth");
  });

  test("dev + staging have promote buttons; production does not", async ({ page }) => {
    await mock(page);
    await page.goto("/releases");
    await expect(page.getByTestId("promote-btn")).toHaveCount(2);
    await expect(page.getByTestId("lane-prod").getByTestId("promote-btn")).toHaveCount(0);
    await expect(page.getByTestId("lane-dev").getByTestId("promote-btn")).toContainText("Promote to Staging");
  });

  test("Promote opens the env PR and shows the promotion PR note", async ({ page }) => {
    let promoted: { from_env?: string; to_env?: string } | null = null;
    await mock(page);
    await page.route("**/api/projects/*/promote", (r) => {
      promoted = r.request().postDataJSON();
      return r.fulfill({ json: { pr_number: 42, pr_url: "https://gh/pr/42" } });
    });
    await page.goto("/releases");
    await page.getByTestId("lane-dev").getByTestId("promote-btn").click();
    await expect.poll(() => promoted?.from_env).toBe("dev");
    await expect.poll(() => promoted?.to_env).toBe("staging");
    await expect(page.getByTestId("promotion-pr")).toContainText("#42");
  });

  test("a lane with nothing awaiting promotion disables its button", async ({ page }) => {
    // dev task already in staging → nothing to promote from dev.
    await mock(page, {
      dev: [{ run_id: "r1", task_id: "T-1", title: "Done", merge_commit: "x", env_dev_at: "2026-01-03", env_staging_at: "2026-01-04", env_prod_at: null }],
      staging: [],
      prod: [],
    });
    await page.goto("/releases");
    await expect(page.getByTestId("lane-dev").getByTestId("promote-btn")).toBeDisabled();
  });
});
