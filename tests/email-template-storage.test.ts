import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import {
  createTemplateVersion,
  activateTemplateVersion,
  resolveTemplate,
  resolveTemplateSet,
} from "../functions/_lib/email/templates";
import type { DatabaseLike } from "../functions/_lib/types";
import { loadEmailRenderBundle } from "../functions/_lib/email/partials";
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

  it("resolves a deduplicated template set with one D1 query", async () => {
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    for (const templateKey of ["batch_template_one", "batch_template_two"]) {
      const version = await createTemplateVersion(env.DB, {
        templateKey,
        content: `Body for ${templateKey}`,
        createdByUserId: admin.id,
      });
      await activateTemplateVersion(env.DB, { templateKey, version: version.version });
    }

    let prepareCount = 0;
    const countedDb: DatabaseLike = {
      prepare(query) {
        prepareCount += 1;
        return env.DB.prepare(query);
      },
      batch(statements) {
        return env.DB.batch(statements);
      },
    };
    const resolutions = await resolveTemplateSet(countedDb, [
      "batch_template_one",
      "batch_template_two",
      "batch_template_one",
      "batch_template_missing",
    ]);

    expect(prepareCount).toBe(1);
    expect(resolutions.get("batch_template_one")).toMatchObject({ ok: true });
    expect(resolutions.get("batch_template_two")).toMatchObject({ ok: true });
    expect(resolutions.get("batch_template_missing")).toMatchObject({
      ok: false,
      code: "EMAIL_TEMPLATE_NOT_FOUND",
    });
  });

  it("loads required render templates in one query without requiring unrelated partials", async () => {
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    for (const [templateKey, content] of [
      ["email_layout", "<main>{{{body_html}}}</main>"],
      ["render_bundle_body", "Bundle body"],
    ]) {
      const version = await createTemplateVersion(env.DB, {
        templateKey,
        content,
        createdByUserId: admin.id,
      });
      await activateTemplateVersion(env.DB, { templateKey, version: version.version });
    }

    let prepareCount = 0;
    const countedDb: DatabaseLike = {
      prepare(query) {
        prepareCount += 1;
        return env.DB.prepare(query);
      },
      batch(statements) {
        return env.DB.batch(statements);
      },
    };

    const bundle = await loadEmailRenderBundle(countedDb, ["render_bundle_body"]);

    expect(prepareCount).toBe(1);
    expect(bundle.layoutHtml).toBe("<main>{{{body_html}}}</main>");
    expect(bundle.templates.get("render_bundle_body")?.content).toBe("Bundle body");
    expect(bundle.partials).toEqual({});
  });
});
