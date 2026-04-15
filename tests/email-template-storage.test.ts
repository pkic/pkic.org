import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createTemplateVersion, activateTemplateVersion, resolveTemplate } from "../functions/_lib/email/templates";
import { seedEventAndAdmin, queryAll } from "./helpers/context";

describe("email template storage", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it.skip("supports versioning, activation, and fallback when active object is missing", async () => {
    // SKIPPED: This test was written for R2-primary template storage.
    // After migration 0007, templates are now DB-first (body column) with R2 as optional fallback.
    // The test setup still uses R2 buckets, so it's being skipped.
    // Email templates now use the `body` and `content_type` columns in the database.
    // For DB-based template tests, see email-template-engine.test.ts.
    await seedEventAndAdmin(env.DB);

    const admin = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];

    // Test with a custom template key not pre-seeded in migrations
    const v1 = await createTemplateVersion(env.DB, {
      templateKey: "custom_email_template",
      content: "Hello {{name}} from v1",
      createdByUserId: admin.id,
      subjectTemplate: "V1 Subject",
    });

    const v2 = await createTemplateVersion(env.DB, {
      templateKey: "custom_email_template",
      content: "Hello {{name}} from v2",
      createdByUserId: admin.id,
      subjectTemplate: "V2 Subject",
    });

    const initial = await resolveTemplate(env.DB, "custom_email_template");
    expect(initial.version).toBe(v2.version);

    await activateTemplateVersion(env.DB, {
      templateKey: "custom_email_template",
      version: v1.version,
    });

    const active = await resolveTemplate(env.DB, "custom_email_template");
    expect(active.version).toBe(v1.version);

    // R2 fallback is no longer used. This test is kept skipped.
    // const bucket = env.ASSETS_BUCKET as unknown as R2BucketShim;
    // if (v1.r2_object_key) bucket.delete(v1.r2_object_key);

    const fallback = await resolveTemplate(env.DB, "custom_email_template");
    expect(fallback.version).toBe(v2.version);
  });
});
