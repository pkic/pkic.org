import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { resolveTemplate } from "../functions/_lib/email/templates";
import { callSystem, callWithToken, createStaffSession, setupSystemTemplates } from "./helpers/system-email-templates";

describe("system email template endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists active template versions through the router", async () => {
    await setupSystemTemplates();

    const response = await callSystem("/api/v1/email/templates");
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      templates: Array<{
        template_key: string;
        active_version: number | null;
        version_count: number;
        draft_count: number;
      }>;
      page: { limit: number; offset: number; hasMore: boolean; total: number };
    };
    expect(payload.templates.some((t) => t.template_key === "email_layout" && t.active_version != null)).toBe(true);
    expect(
      payload.templates.some((t) => t.template_key === "registration_confirm_email" && t.active_version != null),
    ).toBe(true);
    expect(payload.page).toBeDefined();
    expect(payload.page.total).toBeGreaterThanOrEqual(2);
  });

  it("bounds the list with limit/offset and computes hasMore/total from a real COUNT, not a limit+1 slice", async () => {
    await setupSystemTemplates();

    const page1 = await callSystem("/api/v1/email/templates?limit=1&offset=0&sort=template_key");
    expect(page1.status).toBe(200);
    const page1Payload = (await page1.json()) as {
      templates: Array<{ template_key: string }>;
      page: { limit: number; offset: number; hasMore: boolean; total: number };
    };
    expect(page1Payload.templates).toHaveLength(1);
    expect(page1Payload.page.limit).toBe(1);
    expect(page1Payload.page.offset).toBe(0);
    expect(page1Payload.page.total).toBeGreaterThan(1);
    expect(page1Payload.page.hasMore).toBe(true);

    const page2 = await callSystem("/api/v1/email/templates?limit=1&offset=1&sort=template_key");
    const page2Payload = (await page2.json()) as { templates: Array<{ template_key: string }> };
    expect(page2Payload.templates).toHaveLength(1);
    expect(page2Payload.templates[0].template_key).not.toBe(page1Payload.templates[0].template_key);

    const lastPage = await callSystem(
      `/api/v1/email/templates?limit=1&offset=${page1Payload.page.total - 1}&sort=template_key`,
    );
    const lastPagePayload = (await lastPage.json()) as { page: { hasMore: boolean } };
    expect(lastPagePayload.page.hasMore).toBe(false);
  });

  it("filters the list by ?q= against template_key", async () => {
    await setupSystemTemplates();

    const response = await callSystem("/api/v1/email/templates?q=registration_confirm_email");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { templates: Array<{ template_key: string }>; page: { total: number } };
    expect(payload.templates).toHaveLength(1);
    expect(payload.templates[0].template_key).toBe("registration_confirm_email");
    expect(payload.page.total).toBe(1);
  });

  it("rejects an unknown ?sort= column as a schema validation error", async () => {
    await setupSystemTemplates();

    const response = await callSystem("/api/v1/email/templates?sort=not_a_real_column");
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });

  it("filters template catalogs by a validated key prefix in D1", async () => {
    await setupSystemTemplates();
    const response = await callSystem("/api/v1/email/templates?templateKeyPrefix=registration_");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { templates: Array<{ template_key: string }> };
    expect(payload.templates.length).toBeGreaterThan(0);
    expect(payload.templates.every((template) => template.template_key.startsWith("registration_"))).toBe(true);
    expect((await callSystem("/api/v1/email/templates?templateKeyPrefix=bad%2A")).status).toBe(400);
  });

  it("renders preview HTML and text with seeded partials and layout", async () => {
    await setupSystemTemplates();

    const response = await callSystem("/api/v1/email/templates/preview", {
      method: "POST",
      body: JSON.stringify({
        subjectTemplate: "Preview for {{eventName}}",
        content: "Hello **{{firstName}}** from {{{eventUrl}}}",
        contentType: "markdown",
        data: {
          eventName: "Demo Day",
          firstName: "Jordan",
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { success: boolean; subject: string; html: string; text: string };
    expect(payload.success).toBe(true);
    expect(payload.subject).toBe("Preview for Demo Day");
    expect(payload.html).toContain("Jordan");
    expect(payload.text).toContain("Jordan");
  });

  it("rejects preview data collections beyond the shared contract limit", async () => {
    await setupSystemTemplates();

    const response = await callSystem("/api/v1/email/templates/preview", {
      method: "POST",
      body: JSON.stringify({
        content: "{{#each items}}{{/each}}",
        data: { items: Array.from({ length: 1_001 }, () => null) },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("fails closed when bounded preview input would amplify beyond the renderer limit", async () => {
    await setupSystemTemplates();

    const response = await callSystem("/api/v1/email/templates/preview", {
      method: "POST",
      body: JSON.stringify({
        content: `{{#each items}}${"x".repeat(2_001)}{{/each}}`,
        data: { items: Array.from({ length: 1_000 }, () => null) },
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EMAIL_TEMPLATE_RENDER_LIMIT_EXCEEDED" },
    });
  });

  it("rejects an oversized subject override through the mounted preview route", async () => {
    await setupSystemTemplates();

    const response = await callSystem("/api/v1/email/templates/preview", {
      method: "POST",
      body: JSON.stringify({
        content: "Preview body",
        data: { __subjectOverride: "x".repeat(8_193) },
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EMAIL_TEMPLATE_RENDER_LIMIT_EXCEEDED" },
    });
  });

  it("attributes a new template version to the real staff user and audit actor", async () => {
    const { adminId } = await setupSystemTemplates();

    const response = await callSystem("/api/v1/email/templates/attribution_test/versions", {
      method: "POST",
      body: JSON.stringify({ content: "Attribution test body", contentType: "markdown" }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { version: { id: string } };
    expect(
      await queryAll<{ created_by_user_id: string | null }>(
        env.DB,
        "SELECT created_by_user_id FROM email_template_versions WHERE id = ?",
        payload.version.id,
      ),
    ).toEqual([{ created_by_user_id: adminId }]);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'email_template_version_created' AND entity_id = ?",
        payload.version.id,
      ),
    ).toEqual([{ actor_id: adminId }]);
  });

  it("rejects the shared admin API key on attributable system mutations", async () => {
    await setupSystemTemplates();
    const response = await callWithToken(
      env.ADMIN_API_KEY ?? "test-admin-key",
      "/api/v1/email/templates/api_key_attribution_test/versions",
      {
        method: "POST",
        body: JSON.stringify({ content: "API-key attribution test body", contentType: "markdown" }),
      },
    );

    expect(response.status).toBe(403);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_template_versions WHERE template_key = 'api_key_attribution_test'"),
    ).toHaveLength(0);
  });

  it("rolls back a new template version when its audit row cannot be written", async () => {
    await setupSystemTemplates();
    await env.DB.prepare(
      `CREATE TRIGGER fail_email_template_version_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'email_template_version_created'
       BEGIN
         SELECT RAISE(ABORT, 'forced email template audit failure');
       END`,
    ).run();

    try {
      const response = await callSystem("/api/v1/email/templates/audit_rollback_test/versions", {
        method: "POST",
        body: JSON.stringify({ content: "Must roll back", contentType: "markdown" }),
      });
      expect(response.status).toBe(500);
      expect(
        await queryAll(env.DB, "SELECT id FROM email_template_versions WHERE template_key = 'audit_rollback_test'"),
      ).toHaveLength(0);
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM audit_log WHERE action = 'email_template_version_created' AND entity_type = 'email_template_version'",
        ),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_email_template_version_audit").run();
    }
  });

  it("creates a new version, activates it, and rejects unknown versions", async () => {
    const { adminId } = await setupSystemTemplates();

    const versionsResponse = await callSystem("/api/v1/email/templates/registration_confirm_email/versions", {
      method: "POST",
      body: JSON.stringify({
        content: "Updated confirmation body for {{firstName}}",
        subjectTemplate: "Updated confirmation",
        contentType: "markdown",
      }),
    });

    expect(versionsResponse.status).toBe(200);
    const versionsPayload = (await versionsResponse.json()) as {
      success: boolean;
      version: { id: string; template_key: string; version: number; status: string };
    };
    expect(versionsPayload.success).toBe(true);
    expect(versionsPayload.version.template_key).toBe("registration_confirm_email");
    expect(versionsPayload.version.version).toBe(2);
    expect(versionsPayload.version.status).toBe("draft");

    const activateResponse = await callSystem("/api/v1/email/templates/registration_confirm_email/activate", {
      method: "POST",
      body: JSON.stringify({ version: 2 }),
    });

    expect(activateResponse.status).toBe(200);
    const activatePayload = (await activateResponse.json()) as { success: boolean };
    expect(activatePayload.success).toBe(true);

    const rows = await queryAll<{ version: number; status: string }>(
      env.DB,
      "SELECT version, status FROM email_template_versions WHERE template_key = ? ORDER BY version",
      ["registration_confirm_email"],
    );
    expect(rows).toEqual([
      { version: 1, status: "archived" },
      { version: 2, status: "active" },
    ]);
    expect(
      await queryAll<{ actor_id: string | null; entity_id: string | null }>(
        env.DB,
        "SELECT actor_id, entity_id FROM audit_log WHERE action = 'email_template_version_activated' ORDER BY created_at",
      ),
    ).toEqual([{ actor_id: adminId, entity_id: versionsPayload.version.id }]);
    expect(
      await queryAll<{ active_count: number }>(
        env.DB,
        "SELECT COUNT(*) AS active_count FROM email_template_versions WHERE template_key = ? AND status = 'active'",
        "registration_confirm_email",
      ),
    ).toEqual([{ active_count: 1 }]);
    await expect(resolveTemplate(env.DB, "registration_confirm_email")).resolves.toMatchObject({
      version: 2,
      content: "Updated confirmation body for {{firstName}}",
    });

    const reactivateResponse = await callSystem("/api/v1/email/templates/registration_confirm_email/activate", {
      method: "POST",
      body: JSON.stringify({ version: 1 }),
    });
    expect(reactivateResponse.status).toBe(200);
    expect(
      await queryAll<{ version: number; status: string }>(
        env.DB,
        "SELECT version, status FROM email_template_versions WHERE template_key = ? ORDER BY version",
        "registration_confirm_email",
      ),
    ).toEqual([
      { version: 1, status: "active" },
      { version: 2, status: "archived" },
    ]);
    await expect(resolveTemplate(env.DB, "registration_confirm_email")).resolves.toMatchObject({ version: 1 });

    const missingResponse = await callSystem("/api/v1/email/templates/registration_confirm_email/activate", {
      method: "POST",
      body: JSON.stringify({ version: 999 }),
    });
    expect(missingResponse.status).toBe(404);
    const missingPayload = (await missingResponse.json()) as { error?: { code?: string } };
    expect(missingPayload.error?.code).toBe("EMAIL_TEMPLATE_VERSION_NOT_FOUND");
  });

  it("rolls back activation when its audit row cannot be written", async () => {
    await setupSystemTemplates();
    const createResponse = await callSystem("/api/v1/email/templates/registration_confirm_email/versions", {
      method: "POST",
      body: JSON.stringify({ content: "Activation audit rollback", contentType: "markdown" }),
    });
    expect(createResponse.status).toBe(200);
    await env.DB.prepare(
      `CREATE TRIGGER fail_email_template_activation_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'email_template_version_activated'
       BEGIN
         SELECT RAISE(ABORT, 'forced email template activation audit failure');
       END`,
    ).run();

    try {
      const response = await callSystem("/api/v1/email/templates/registration_confirm_email/activate", {
        method: "POST",
        body: JSON.stringify({ version: 2 }),
      });
      expect(response.status).toBe(500);
      expect(
        await queryAll<{ version: number; status: string }>(
          env.DB,
          "SELECT version, status FROM email_template_versions WHERE template_key = ? ORDER BY version",
          "registration_confirm_email",
        ),
      ).toEqual([
        { version: 1, status: "active" },
        { version: 2, status: "draft" },
      ]);
      expect(
        await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'email_template_version_activated'"),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_email_template_activation_audit").run();
    }
  });

  it("bounds GET .../:key/versions with limit/offset, ordered newest version first", async () => {
    await setupSystemTemplates();

    await callSystem("/api/v1/email/templates/registration_confirm_email/versions", {
      method: "POST",
      body: JSON.stringify({
        content: "Updated confirmation body for {{firstName}}",
        subjectTemplate: "Updated confirmation",
        contentType: "markdown",
      }),
    });

    const unbounded = await callSystem("/api/v1/email/templates/registration_confirm_email/versions");
    expect(unbounded.status).toBe(200);
    const unboundedPayload = (await unbounded.json()) as {
      versions: Array<{ version: number }>;
      page: { limit: number; offset: number; hasMore: boolean; total: number };
    };
    expect(unboundedPayload.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(unboundedPayload.page.total).toBe(2);
    expect(unboundedPayload.page.hasMore).toBe(false);

    const page1 = await callSystem("/api/v1/email/templates/registration_confirm_email/versions?limit=1&offset=0");
    const page1Payload = (await page1.json()) as {
      versions: Array<{ version: number }>;
      page: { hasMore: boolean; total: number };
    };
    expect(page1Payload.versions).toHaveLength(1);
    expect(page1Payload.versions[0].version).toBe(2);
    expect(page1Payload.page.hasMore).toBe(true);
    expect(page1Payload.page.total).toBe(2);

    const page2 = await callSystem("/api/v1/email/templates/registration_confirm_email/versions?limit=1&offset=1");
    const page2Payload = (await page2.json()) as { versions: Array<{ version: number }>; page: { hasMore: boolean } };
    expect(page2Payload.versions).toHaveLength(1);
    expect(page2Payload.versions[0].version).toBe(1);
    expect(page2Payload.page.hasMore).toBe(false);
  });

  it("searches and sorts template versions in D1 through the shared list contract", async () => {
    await setupSystemTemplates();

    await callSystem("/api/v1/email/templates/registration_confirm_email/versions", {
      method: "POST",
      body: JSON.stringify({
        content: "Updated confirmation body",
        subjectTemplate: "Distinct draft subject",
        contentType: "markdown",
      }),
    });

    const search = await callSystem(
      "/api/v1/email/templates/registration_confirm_email/versions?q=distinct&sort=version",
    );
    expect(search.status).toBe(200);
    const payload = (await search.json()) as {
      versions: Array<{ version: number; subject_template: string | null }>;
      page: { total: number };
    };
    expect(payload.versions).toEqual([
      expect.objectContaining({ version: 2, subject_template: "Distinct draft subject" }),
    ]);
    expect(payload.page.total).toBe(1);

    const invalidSort = await callSystem("/api/v1/email/templates/registration_confirm_email/versions?sort=body");
    expect(invalidSort.status).toBe(400);
  });

  it("filters one template's versions by lifecycle status in D1", async () => {
    await setupSystemTemplates();
    await callSystem("/api/v1/email/templates/registration_confirm_email/versions", {
      method: "POST",
      body: JSON.stringify({ content: "Draft body", subjectTemplate: "Draft", contentType: "markdown" }),
    });

    const active = await callSystem(
      "/api/v1/email/templates/registration_confirm_email/versions?status=active&limit=1&sort=-version",
    );
    expect(active.status).toBe(200);
    const activePayload = (await active.json()) as {
      versions: Array<{ version: number; status: string }>;
      page: { total: number };
    };
    expect(activePayload.versions).toEqual([expect.objectContaining({ version: 1, status: "active" })]);
    expect(activePayload.page.total).toBe(1);

    const drafts = await callSystem(
      "/api/v1/email/templates/registration_confirm_email/versions?status=draft&limit=1&sort=-version",
    );
    const draftPayload = (await drafts.json()) as {
      versions: Array<{ version: number; status: string }>;
      page: { total: number };
    };
    expect(draftPayload.versions).toEqual([expect.objectContaining({ version: 2, status: "draft" })]);
    expect(draftPayload.page.total).toBe(1);
    await callSystem("/api/v1/email/templates/registration_confirm_email/activate", {
      method: "POST",
      body: JSON.stringify({ version: 2 }),
    });
    const archived = await callSystem(
      "/api/v1/email/templates/registration_confirm_email/versions?status=archived&limit=1",
    );
    expect(archived.status).toBe(200);
    const archivedPayload = (await archived.json()) as {
      versions: Array<{ version: number; status: string }>;
      page: { total: number };
    };
    expect(archivedPayload.versions).toEqual([expect.objectContaining({ version: 1, status: "archived" })]);
    expect(archivedPayload.page.total).toBe(1);
    expect(
      (await callSystem("/api/v1/email/templates/registration_confirm_email/versions?status=deleted")).status,
    ).toBe(400);
  });

  it("enforces the read/write permission split for user-backed staff", async () => {
    await setupSystemTemplates();
    const readToken = await createStaffSession("email-templates:read");
    const writeToken = await createStaffSession("email-templates:write");

    const readList = await callWithToken(readToken, "/api/v1/email/templates");
    expect(readList.status).toBe(200);
    const readPreview = await callWithToken(readToken, "/api/v1/email/templates/preview", {
      method: "POST",
      body: JSON.stringify({ content: "Read-only preview", contentType: "markdown" }),
    });
    expect(readPreview.status).toBe(403);
    const readCreate = await callWithToken(readToken, "/api/v1/email/templates/permission_split/versions", {
      method: "POST",
      body: JSON.stringify({ content: "Read-only create", contentType: "markdown" }),
    });
    expect(readCreate.status).toBe(403);

    const writeList = await callWithToken(writeToken, "/api/v1/email/templates");
    expect(writeList.status).toBe(403);
    const writeCreate = await callWithToken(writeToken, "/api/v1/email/templates/permission_split/versions", {
      method: "POST",
      body: JSON.stringify({ content: "Write-only create", contentType: "markdown" }),
    });
    expect(writeCreate.status).toBe(200);
  });

  it("keeps every retired admin email-template route unmounted", async () => {
    await setupSystemTemplates();
    const oldRoutes: Array<[string, RequestInit?]> = [
      ["/api/v1/admin/email-templates"],
      ["/api/v1/admin/email-templates/preview", { method: "POST", body: JSON.stringify({ content: "old" }) }],
      [
        "/api/v1/admin/email-templates/legacy/versions",
        { method: "POST", body: JSON.stringify({ content: "old", contentType: "markdown" }) },
      ],
      ["/api/v1/admin/email-templates/legacy/versions"],
      ["/api/v1/admin/email-templates/legacy/activate", { method: "POST", body: JSON.stringify({ version: 1 }) }],
      ["/api/v1/admin/email-templates/legacy/exists"],
    ];
    for (const [path, init] of oldRoutes) expect((await callSystem(path, init)).status).toBe(404);
  });

  it("does not retain the former generic system email-template route", async () => {
    await setupSystemTemplates();
    const oldRoutes: Array<[string, RequestInit?]> = [
      ["/api/v1/system/email-templates"],
      ["/api/v1/system/email-templates/preview", { method: "POST", body: JSON.stringify({ content: "old" }) }],
      ["/api/v1/system/email-templates/example/versions"],
      ["/api/v1/system/email-templates/example/activate", { method: "POST", body: JSON.stringify({ version: 1 }) }],
    ];
    for (const [path, init] of oldRoutes) expect((await callSystem(path, init)).status).toBe(404);
  });
});
