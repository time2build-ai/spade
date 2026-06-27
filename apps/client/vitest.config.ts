import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // react() is typed against the root `vite` install, but vitest resolves its
  // own nested `vite` copy; the plugin is runtime-compatible, so cast across the
  // duplicate type identities.
  plugins: [react() as unknown as never],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Playwright e2e specs live in e2e/ and use @playwright/test, not vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
