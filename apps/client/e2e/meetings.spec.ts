import { test, expect } from "@playwright/test";

/**
 * Meetings is REAL — title/date/summary/attendees come from the API, with an
 * honest empty state when there are none. No seed "Sprint Planning" content.
 */
const PROJECT = { id: "p1", name: "Demo", path: "/d", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" };

test.describe("meetings (real)", () => {
  test("real meetings render list + detail", async ({ page }) => {
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    await page.route("**/api/meetings**", (r) =>
      r.fulfill({ json: { meetings: [
        { id: "mtg-real-1", project_id: "p1", title: "Quarterly roadmap sync", date: "2026-04-01", summary: "Locked the Q2 roadmap and owners.", attendees: ["Sam", "Lee"], created_at: "" },
        { id: "mtg-real-2", project_id: "p1", title: "Architecture review", date: "2026-04-02", summary: "Picked the data layer.", attendees: ["Sam"], created_at: "" },
      ] } }),
    );
    await page.goto("/meetings");
    await expect(page.getByTestId("meetings")).toBeVisible();
    await expect(page.getByTestId("mtg-item")).toHaveCount(2);
    await expect(page.locator(".mtg-title")).toHaveText("Quarterly roadmap sync");
    await expect(page.getByTestId("mtg-detail")).toContainText("Locked the Q2 roadmap");
    await page.getByTestId("mtg-item").filter({ hasText: "Architecture review" }).click();
    await expect(page.locator(".mtg-title")).toHaveText("Architecture review");
    await expect(page.getByTestId("mtg-detail")).toContainText("Picked the data layer");
  });

  test("no meetings → honest empty state", async ({ page }) => {
    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    await page.route("**/api/meetings**", (r) => r.fulfill({ json: { meetings: [] } }));
    await page.goto("/meetings");
    await expect(page.getByText("No meetings captured yet.")).toBeVisible();
    await expect(page.getByTestId("meetings")).toHaveCount(0);
  });

  test("ingest a meeting → it appears with source, transcript + extracted backlog", async ({ page }) => {
    let meetings: object[] = [];
    let tasks: object[] = [];

    await page.route("**/api/projects", (r) => r.fulfill({ json: { projects: [PROJECT] } }));
    // Generic list routes — register the specific ones AFTER so they win.
    await page.route("**/api/meetings?**", (r) => r.fulfill({ json: { meetings } }));
    await page.route("**/api/tasks?**", (r) => r.fulfill({ json: { tasks } }));
    await page.route("**/api/meetings/samples", (r) =>
      r.fulfill({ json: { samples: [
        { id: "todo-kickoff", title: "Todo App — kickoff", source: "Granola", date: "2026-06-26", attendees: ["You", "Maya"] },
      ] } }),
    );
    await page.route("**/api/meetings/ingest", (r) => {
      const meeting = {
        id: "mtg-ing-1", project_id: "p1", title: "Todo App — kickoff", date: "2026-06-26",
        summary: "Scoped the first slice.", attendees: ["You", "Maya"],
        source: "Granola",
        transcript: "Maya: The list view matters most. → Build the todo list view\n",
        created_at: "",
      };
      meetings = [meeting];
      tasks = [{ id: "SPD-001", project_id: "p1", title: "Build the todo list view", feature: null, priority: 2, status: "ready", origin_quote: "The list view matters most.", origin_source: "Todo App — kickoff", description: null, created_at: "", nodes: [], links: [] }];
      r.fulfill({ json: { meeting, tasks } });
    });

    await page.goto("/meetings");
    await expect(page.getByText("No meetings captured yet.")).toBeVisible();

    await page.getByTestId("ingest-meeting").click();
    await page.getByTestId("ingest-sample").filter({ hasText: "Todo App" }).click();

    // Meeting now shows, with its source badge, the extracted backlog, and the
    // highlighted transcript line.
    await expect(page.locator(".mtg-title")).toHaveText("Todo App — kickoff");
    await expect(page.getByTestId("mtg-detail")).toContainText("via Granola");
    await expect(page.getByTestId("mtg-backlog-item")).toHaveCount(1);
    await expect(page.getByTestId("mtg-backlog")).toContainText("Build the todo list view");
    await expect(page.locator(".mtg-line.hl")).toHaveCount(1);
  });
});
