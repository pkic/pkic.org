import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "react/jsx-dev-runtime": "preact/jsx-runtime",
      "react/jsx-runtime": "preact/jsx-runtime",
      react: "preact/compat",
      // The CommonJS shim requires React outside Vite's renderer alias.
      "use-sync-external-store/shim/index.js": "preact/compat",
      "react-dom": "preact/compat",
    },
  },
  test: {
    // Transform the real router so its external-store import uses the Preact renderer.
    server: { deps: { inline: [/\/wouter\//] } },
    include: ["tests/frontend/**/*.test.{ts,tsx}"],
    exclude: ["**/._*"],
    environment: "jsdom",
    setupFiles: ["./tests/frontend/jsdom-layout.ts"],
    // Threads share one process, so each jsdom worker costs about 0.3 GB
    // instead of a whole Node process; half the cores keeps high-core CI
    // and developer machines within memory.
    pool: "threads",
    maxWorkers: "50%",
    reporters: ["default", "./tests/tools/slowest-tests-reporter.ts"],
  },
});
