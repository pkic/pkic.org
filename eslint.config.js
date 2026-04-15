import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────────────────────
  { ignores: ["public/", "resources/", "static/", "node_modules/", "dist/", ".wrangler/", "layouts/", "scripts/"] },

  // ── Base JS recommended rules ───────────────────────────────────────────────
  eslint.configs.recommended,

  // ── TypeScript recommended (type-checked) ───────────────────────────────────
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.frontend.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Custom rule overrides ───────────────────────────────────────────────────
  {
    rules: {
      // Already enforced by tsconfig noUnusedLocals; avoid double-reporting
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // Catch unhandled promises — one of the biggest async footguns
      "@typescript-eslint/no-floating-promises": "error",

      // Allow `any` in pragmatic code — too noisy for an existing codebase
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",

      // Allow non-null assertions — the codebase uses them intentionally
      "@typescript-eslint/no-non-null-assertion": "off",

      // Relax for test helpers and flexible APIs
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },

  // ── Prettier (must be last to override formatting rules) ────────────────────
  eslintConfigPrettier,
  eslintPluginPrettier,
);
