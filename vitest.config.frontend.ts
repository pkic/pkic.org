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
    include: ["tests/frontend/**/*.test.ts"],
    environment: "jsdom",
  },
});
