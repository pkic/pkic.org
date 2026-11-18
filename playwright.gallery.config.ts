import { defineConfig } from "@playwright/test";

// The tests own an ephemeral Vite server; no site build, Worker, or D1 setup.
export default defineConfig({
  testDir: "./tests/frontend/browser",
  testMatch: "**/*.spec.ts",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  reporter: "line",
});
