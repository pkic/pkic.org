import { defineConfig } from "vitest/config";

// Repository scripts (scripts/*.mjs) run under plain Node, not the
// Workers sandbox vitest.config.ts's cloudflareTest pool provides — they
// shell out to the real `wrangler` CLI (child_process), which cannot run
// inside workerd. Separate config/glob, same pattern vitest.config.frontend.ts
// already established for the jsdom project.
export default defineConfig({
  test: {
    include: ["tests/tools/**/*.test.ts"],
    environment: "node",
    // The fresh-D1 smoke test shells out to real wrangler/workerd processes
    // (migrations apply + d1 execute) — observed 42-55s even on an
    // otherwise-idle machine, so 60s cuts it close under any real load.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
