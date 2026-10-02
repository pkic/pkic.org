import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "astro-publication.spec.ts",
    "public-publication-layout.spec.ts",
    "public-responsive.spec.ts",
    "public-form-and-theme-layout.spec.ts",
  ],
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8791", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node scripts/publication/preview-astro.mjs",
    url: "http://127.0.0.1:8791/members/",
    reuseExistingServer: false,
  },
});
