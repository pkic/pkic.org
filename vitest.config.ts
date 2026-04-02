import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrationsPath = path.join(__dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        main: "./functions/router.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Test-only bindings: secrets not in wrangler.jsonc, plus
          // the pre-read migrations array for the apply-migrations setup file.
          bindings: {
            TEST_MIGRATIONS: migrations,
            CF_PAGES_URL: "https://app.test",
            INTERNAL_SIGNING_SECRET: "test-signing-secret",
            SENDGRID_API_KEY: "test-key",
            FEEDBACK_IDENTITY_SECRET_V1: "feedback-secret",
            ADMIN_API_KEY: "test-admin-key",
            STRIPE_SECRET_KEY: "sk_test_fake",
            STRIPE_PUBLISHABLE_KEY: "pk_test_fake",
            STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
          },
        },
      }),
    ],
    test: {
      include: ["tests/**/*.test.ts"],
      exclude: ["tests/frontend/**", "tests/e2e/**"],
      setupFiles: ["./tests/helpers/apply-migrations.ts"],
    },
  };
});
