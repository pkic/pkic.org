import { defineConfig } from "@playwright/test";
import publicationConfig from "./playwright.astro.config";

export default defineConfig({
  ...publicationConfig,
  testMatch: "public-contrast.spec.ts",
  workers: 2,
});
