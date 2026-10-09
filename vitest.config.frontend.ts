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
    // Each jsdom worker carries a full DOM and transformed frontend graph.
    // Bound concurrency like the Workers suite so high-core CI and developer
    // machines do not exhaust memory while running the repository-wide gate.
    maxWorkers: 3,
    reporters: ["default", "./tests/tools/slowest-tests-reporter.ts"],
  },
});
