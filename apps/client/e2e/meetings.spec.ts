import { test, expect } from "@playwright/test";

/**
 * V2 Phase 2 — Meetings: list ↔ detail (summary + key outcomes + transcript
 * with highlighted evidence lines). Seeded.
 */
test.describe("meetings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/meetings");
    await expect(page.getByTestId("meetings")).toBeVisible();
  });

  test("list selects a meeting and loads its detail", async ({ page }) => {
    await expect(page.getByTestId("mtg-item").first()).toBeVisible();
    await expect(page.locator(".mtg-title")).toContainText("Sprint Planning");
    await page.getByTestId("mtg-item").filter({ hasText: "Architecture review" }).click();
    await expect(page.locator(".mtg-title")).toContainText("Architecture review");
  });

  test("detail has summary, key outcomes, and highlighted transcript", async ({ page }) => {
    const d = page.getByTestId("mtg-detail");
    await expect(d).toContainText("Summary");
    await expect(d.getByTestId("mtg-outcome").first()).toBeVisible();
    await expect(d).toContainText("Transcript");
    await expect(d.getByTestId("mtg-hl").first()).toBeVisible(); // highlighted evidence line
  });
});

test.describe("meetings (real API)", () => {
  test("real meetings win over the seed (Phase 3)", async ({ page }) => {
    await page.route("**/api/projects", (r) =>
      r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
    );
    await page.route("**/api/meetings**", (r) =>
      r.fulfill({ json: { meetings: [
        { id: "mtg-real-1", project_id: "p1", title: "Quarterly roadmap sync", date: "2026-04-01", summary: "Locked the Q2 roadmap and owners.", attendees: ["Sam", "Lee"], created_at: "" },
      ] } }),
    );
    await page.goto("/meetings");
    await expect(page.getByTestId("meetings")).toBeVisible();
    // Real title/summary win; outcomes/transcript fall back to the seed.
    await expect(page.getByTestId("mtg-item")).toHaveCount(1);
    await expect(page.locator(".mtg-title")).toHaveText("Quarterly roadmap sync");
    await expect(page.getByTestId("mtg-detail")).toContainText("Locked the Q2 roadmap");
    await expect(page.getByTestId("mtg-detail").getByTestId("mtg-outcome").first()).toBeVisible(); // seeded
  });
});
