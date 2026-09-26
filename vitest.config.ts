import path from "node:path";
import { builtinModules } from "node:module";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { NODE_UNIT_TEST_FILES } from "./vitest.config.unit";

export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, "migrations");
  const migrations = (await readD1Migrations(migrationsPath)).filter(
    (migration) => !path.basename(migration.name).startsWith("._"),
  );

  const workerOptions = {
    wrangler: { configPath: "./wrangler.jsonc", environment: "local" },
    miniflare: {
      // Test-only bindings: secrets not in wrangler.jsonc, plus
      // the pre-read migrations array for the apply-migrations setup file.
      bindings: {
        TEST_MIGRATIONS: migrations,
        APP_BASE_URL: "https://app.test",
        INTERNAL_SIGNING_SECRET: "test-signing-secret",
        SENDGRID_API_KEY: "test-key",
        FEEDBACK_IDENTITY_SECRET_V1: "feedback-secret",
        ADMIN_API_KEY: "test-admin-key",
        STRIPE_SECRET_KEY: "sk_test_fake",
        STRIPE_PUBLISHABLE_KEY: "pk_test_fake",
        STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
        WEBAUTHN_RP_ID: "app.test",
        WEBAUTHN_RP_NAME: "PKIC Test",
        WEBAUTHN_ORIGIN: "https://app.test",
      },
    },
  };
  const testOptions = {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          // Bundle SDK module graphs once, but let workerd resolve its native
          // Node/Cloudflare APIs. Runtime and per-file storage stay isolated.
          rolldownOptions: { external: [...builtinModules, /^node:/, /^cloudflare:/] },
          include: [
            "zod",
            "hono",
            "chanfana",
            "handlebars",
            "ical.js",
            "postal-mime",
            "fast-xml-parser",
            "@simplewebauthn/server",
            "@simplewebauthn/server/helpers",
            "@cloudflare/codemode",
            "@cloudflare/codemode/mcp",
            "agents/mcp",
            "@cloudflare/workers-oauth-provider",
          ],
        },
      },
    },
    setupFiles: ["./tests/helpers/apply-migrations.ts"],
  };
  // Only SELF.fetch needs an eagerly loaded entry point. Other tests import
  // their actual router/service explicitly, still inside isolated workerd
  // with the same bindings and real migrations.
  const workerFetchFiles = ["tests/api-security.test.ts"];
  return {
    test: {
      maxWorkers: 3,
      reporters: ["default", "./tests/tools/slowest-tests-reporter.ts"],
      projects: [
        {
          plugins: [cloudflareTest({ ...workerOptions, main: "./tests/helpers/d1-test-worker.ts" })],
          test: {
            ...testOptions,
            name: "d1",
            include: ["tests/**/*.test.ts"],
            exclude: [
              ...NODE_UNIT_TEST_FILES,
              ...workerFetchFiles,
              "tests/frontend/**",
              "tests/e2e/**",
              "tests/tools/**",
              "**/._*",
            ],
          },
        },
        {
          plugins: [cloudflareTest({ ...workerOptions, main: "./functions/router.ts" })],
          test: { ...testOptions, name: "worker-fetch", include: workerFetchFiles, exclude: ["**/._*"] },
        },
      ],
    },
  };
});
