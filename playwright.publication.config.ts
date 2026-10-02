import { defineConfig } from "@playwright/test";
import applicationConfig from "./playwright.config";

/** Opt-in native D1 edit → complete build → activation variants. */
export default defineConfig({
  ...applicationConfig,
  grep: /@publication/,
  grepInvert: undefined,
});
