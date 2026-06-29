import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the Spade client.
 *
 * The UI-parity work (docs/ui-parity/PR-PLAN.md) ships one spec per screen.
 * Specs target the running Next.js dev server; Playwright boots it for us via
 * `webServer` and reuses an already-running instance locally. Set E2E_BASE_URL
 * to target a server on another port (e.g. when :3000 is already taken by a
 * separate checkout's dev server).
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The shell fetches several /api endpoints on every page; specs that don't mock
  // them hit the (down) dev proxy, so cap workers + allow a retry to absorb that
  // proxy-contention flakiness. A genuine failure still fails both attempts.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
