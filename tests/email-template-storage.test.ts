import { describe, it, expect } from "vitest";
import { createTemplateVersion, activateTemplateVersion, resolveTemplate } from "../functions/_lib/email/templates";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createEnv, seedEventAndAdmin } from "./helpers/context";
import { R2BucketShim } from "./helpers/r2-shim";

describe("email template storage", () => {
  it.skip("supports versioning, activation, and fallback when active object is missing", async () => {
    // SKIPPED: This test was written for R2-primary template storage.
    // After migration 0007, templates are now DB-first (body column) with R2 as optional fallback.
    // The test setup still uses R2 buckets, so it's being skipped.
    // Email templates now use the `body` and `content_type` columns in the database.
    // For DB-based template tests, see email-template-engine.test.ts.
    const db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    const env = createEnv(db);

    const admin = db.raw<{ id: string }>("SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")[0];

    // Test with a custom template key not pre-seeded in migrations
    const v1 = await createTemplateVersion(db, {
      templateKey: "custom_email_template",
      content: "Hello {{name}} from v1",
      createdByUserId: admin.id,
      subjectTemplate: "V1 Subject",
    });

    const v2 = await createTemplateVersion(db, {
      templateKey: "custom_email_template",
      content: "Hello {{name}} from v2",
      createdByUserId: admin.id,
      subjectTemplate: "V2 Subject",
    });

    const initial = await resolveTemplate(db, "custom_email_template");
    expect(initial.version).toBe(v2.version);

    await activateTemplateVersion(db, {
      templateKey: "custom_email_template",
      version: v1.version,
    });

    const active = await resolveTemplate(db, "custom_email_template");
    expect(active.version).toBe(v1.version);

    // R2 fallback is no longer used. This test is kept skipped.
    // const bucket = env.ASSETS_BUCKET as unknown as R2BucketShim;
    // if (v1.r2_object_key) bucket.delete(v1.r2_object_key);

    const fallback = await resolveTemplate(db, "custom_email_template");
    expect(fallback.version).toBe(v2.version);
  });
});
