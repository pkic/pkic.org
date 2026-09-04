import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceTypeScriptFiles = [
  "functions/**/*.ts",
  "assets/ts/**/*.{ts,tsx}",
  "assets/shared/**/*.ts",
  "assets/design/**/*.ts",
  "tests/**/*.{ts,tsx}",
];
const toolingTypeScriptFiles = ["*.config.ts", "tests/tools/**/*.ts"];
const allTypeScriptFiles = [...sourceTypeScriptFiles, ...toolingTypeScriptFiles];

const typedTypeScriptConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: allTypeScriptFiles,
}));

export default tseslint.config(
  {
    ignores: [
      "**/._*",
      ".cache/**",
      ".claude/**",
      ".design-sync/**",
      "types/**",
      "assets/**/*.d.ts",
      ".ds-sync/**",
      "ds-bundle/**",
      ".venv/**",
      ".wrangler/**",
      "backups/**",
      "coverage/**",
      "dist/**",
      "layouts/**",
      "node_modules/**",
      "playwright-report/**",
      "public/**",
      "resources/**",
      "static/fonts/**",
      "static/img/**",
      "static/js/built/**",
      "static/pagefind/**",
      "static/uploads/**",
      "static/_pagefind/**",
      "test-results/**",
      "themes/**",
    ],
  },
  {
    ...eslint.configs.recommended,
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
  },
  ...typedTypeScriptConfigs,
  {
    files: sourceTypeScriptFiles,
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.frontend.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: toolingTypeScriptFiles,
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.tools.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["assets/js/**/*.js", "static/js/*.js", "static/scripts/**/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["assets/js/mermaid-init.js"],
    languageOptions: {
      globals: { mermaid: "readonly" },
    },
  },
  {
    files: ["static/scripts/search.js"],
    languageOptions: {
      globals: { PagefindUI: "readonly" },
    },
  },
  {
    files: ["eslint.config.js", ".dependency-cruiser.cjs", "scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: allTypeScriptFiles,
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["functions/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/_lib/db/queries", "**/_lib/db/pagination"],
              message: "API adapters must call a focused service instead of importing SQL execution helpers.",
            },
            {
              group: ["**/_lib/services/audit"],
              message: "API adapters must call a focused use case that owns the operation and its audit record.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='prepare']",
          message: "API adapters must not prepare SQL; move the query or mutation into a focused service.",
        },
        {
          selector: "CallExpression[callee.property.name='batch']",
          message: "API adapters must not execute D1 batches; the service must own the complete atomic unit of work.",
        },
        {
          selector: "Literal[value=405]",
          message:
            "API adapters must use dispatchRequestMethod/dispatchPostOnly so 405 responses and Allow headers stay canonical.",
        },
      ],
    },
  },
  eslintConfigPrettier,
  {
    ...eslintPluginPrettier,
    files: sourceTypeScriptFiles,
  },
);
