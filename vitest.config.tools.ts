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
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
