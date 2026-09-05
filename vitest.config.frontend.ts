import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "react/jsx-dev-runtime": "preact/jsx-runtime",
      "react/jsx-runtime": "preact/jsx-runtime",
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
  },
  test: {
    include: ["tests/frontend/**/*.test.{ts,tsx}"],
    exclude: ["**/._*"],
    environment: "jsdom",
    setupFiles: ["./tests/frontend/jsdom-layout.ts"],
    // Each jsdom worker carries a full DOM and transformed frontend graph.
    // Bound concurrency like the Workers suite so high-core CI and developer
    // machines do not exhaust memory while running the repository-wide gate.
    maxWorkers: 3,
  },
});
