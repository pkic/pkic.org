import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceTypeScriptFiles = [
  "functions/**/*.ts",
  "assets/ts/**/*.{ts,tsx}",
  "assets/shared/**/*.ts",
  "tests/**/*.ts",
];
const toolingTypeScriptFiles = ["*.config.ts"];
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
    files: ["assets/js/**/*.js", "static/scripts/**/*.js"],
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
  eslintConfigPrettier,
  {
    ...eslintPluginPrettier,
    files: sourceTypeScriptFiles,
  },
);
