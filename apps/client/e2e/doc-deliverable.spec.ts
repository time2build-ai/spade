import { test, expect, type Page } from "@playwright/test";

/**
 * Task view — a docs deliverable. A delivered docs task pins a `doc` artifact
 * whose styled body is served by the shareable /api/doc/{id} route; the task view
 * renders it in a LOCKED sandbox iframe (no allow-scripts) with an Open + Share
 * link affordance, and shows the docs kind badge. Mocks the API.
 */

const TASK = {
  id: "D-1", project_id: "p1", title: "Write the client SOW", feature: null,
  priority: 1, status: "delivered", kind: "docs", kind_suggested: null,
  kind_reason: null, doc_template: "sow", origin_quote: null, origin_source: null,
  description: null, created_at: "2026-01-01T00:00:00Z", nodes: [], links: [],
};

const DOC_ART = {
  id: "art-doc", task_id: "D-1", run_id: "rd", kind: "doc", title: "Write the client SOW",
  repo_path: null, branch: null, content: null, created_by: null, created_at: "2026-01-02",
};

const RUN = {
  id: "rd", project_id: "p1", task_id: "D-1", kind: "docs", phase: "delivered",
  active: 0, fanout_count: 0, branch_name: null, worktree_path: null, pr_number: null,
  pr_url: null, merge_commit: null, env_dev_at: null, env_staging_at: null,
  env_prod_at: null, agent_session_id: null, account_id: null, blocked_reason: null,
  blocked_from_phase: null, self_heal_attempts: 0, last_finished_session: null,
  created_at: "2026-01-02", updated_at: "2026-01-02",
};

const DOC_HTML =
  "<!doctype html><html><head><title>Client SOW</title></head>" +
  "<body><section><h2>Scope</h2><p>The work.</p></section></body></html>";

async function mockTaskView(page: Page) {
  await page.route("**/api/projects", (r) =>
    r.fulfill({ json: { projects: [{ id: "p1", name: "Demo", path: "/demo", account_strategy: "round_robin", model_ceiling: null, autopilot: 0, created_at: "" }] } }),
  );
  await page.route("**/api/tasks**", (r) => r.fulfill({ json: { tasks: [TASK] } }));
  await page.route("**/api/brain/nodes**", (r) => r.fulfill({ json: { nodes: [] } }));
  await page.route("**/api/pipelines**", (r) => r.fulfill({ json: { pipelines: [] } }));
  await page.route("**/api/lifecycle**", (r) => r.fulfill({ json: { runs: [RUN] } }));
  await page.route("**/api/projects/*/gates", (r) => r.fulfill({ json: { gates: [] } }));
  await page.route("**/api/lifecycle/templates", (r) => r.fulfill({ json: { templates: {}, gate_labels: {}, artifact_labels: {} } }));
  // Doc body served by the shareable styled route (locked iframe target).
  await page.route("**/api/doc/**", (r) =>
    r.fulfill({ contentType: "text/html", body: DOC_HTML }),
  );
  // Single-task + its sub-resources — registered AFTER the generic /api/tasks**
  // so these more-specific handlers win (Playwright tries most-recent first).
  await page.route("**/api/tasks/D-1", (r) => r.fulfill({ json: TASK }));
  await page.route("**/api/tasks/D-1/artifacts", (r) => r.fulfill({ json: { artifacts: [DOC_ART] } }));
  await page.route("**/api/tasks/D-1/comments", (r) => r.fulfill({ json: { comments: [] } }));
}

test.describe("doc-deliverable", () => {
  test.beforeEach(async ({ page }) => {
    await mockTaskView(page);
    await page.goto("/task/D-1");
    await expect(page.getByRole("heading", { name: "Write the client SOW" })).toBeVisible();
  });

  test("shows the docs kind badge", async ({ page }) => {
    await expect(page.getByTestId("task-kind-chip")).toContainText("Docs");
  });

  test("renders the doc in a locked sandbox iframe pointed at /api/doc/{id}", async ({ page }) => {
    const deliverable = page.getByTestId("doc-deliverable");
    await expect(deliverable).toBeVisible();
    const iframe = page.getByTestId("doc-iframe");
    await expect(iframe).toHaveAttribute("src", "/api/doc/art-doc");
    // locked sandbox: empty sandbox attribute (no allow-scripts)
    await expect(iframe).toHaveAttribute("sandbox", "");
    // the doc body actually renders inside the frame
    await expect(page.frameLocator('[data-testid="doc-iframe"]').locator("h2")).toHaveText("Scope");
  });

  test("exposes a shareable link to the styled doc", async ({ page }) => {
    const share = page.getByTestId("doc-share-link");
    await expect(share).toBeVisible();
    await expect(share).toHaveAttribute("href", "/api/doc/art-doc");
  });
});
