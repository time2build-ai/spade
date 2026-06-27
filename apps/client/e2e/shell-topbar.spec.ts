import { test, expect } from "@playwright/test";

/**
 * PR-02 — topbar parity (honest subset).
 * No-fabrication policy: the reference's `· NN%` account usage and the
 * `sprint NN · day N/M` pill are omitted because the API exposes neither, so we
 * assert they are ABSENT. The `acct:` label prefix and the borderless ghost
 * tweaks button are real parity fixes and are asserted present.
 */

const topbar = (page: import("@playwright/test").Page) => page.locator("header.topbar");

test.describe("topbar", () => {
  test("tweaks button is a borderless ghost button (not a bordered icon-btn)", async ({ page }) => {
    await page.goto("/backlog");
    const tweaks = topbar(page).getByRole("button", { name: "Toggle tweaks panel" });
    await expect(tweaks).toBeVisible();
    const cls = (await tweaks.getAttribute("class")) ?? "";
    expect(cls.split(/\s+/)).toEqual(expect.arrayContaining(["btn", "ghost"]));
    expect(cls).not.toContain("icon-btn");
  });

  test("no fabricated sprint pill is rendered", async ({ page }) => {
    await page.goto("/backlog");
    await expect(page.getByText(/sprint\s+\d+\s+·\s+day\s+\d+\/\d+/i)).toHaveCount(0);
  });

  test("account pill shows the acct: prefix when an account exists", async ({ page }) => {
    await page.route("**/api/accounts", (route) =>
      route.fulfill({
        json: {
          accounts: [
            {
              id: "a1",
              label: "rmurphy@acme",
              color: null,
              provider: "anthropic",
              config_dir: "",
              is_default: 1,
              created_at: "",
            },
          ],
        },
      }),
    );
    await page.goto("/backlog");
    await expect(topbar(page).getByText("acct: rmurphy@acme")).toBeVisible();
  });
});
