import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";

let ADMIN_TOKEN = "email-templates-admin-token";

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(`https://app.test${path}`, {
    ...init,
    headers,
  });
}

async function callAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    adminRequest(path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function setupAdminTemplates(): Promise<{ adminId: string }> {
  await seedEventAndAdmin(env.DB);
  const adminRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0];
  ADMIN_TOKEN = await createAdminSession(env.DB, adminRow.id, ADMIN_TOKEN);
  await seedWorkflowEmailTemplates(env.DB, adminRow.id);
  return { adminId: adminRow.id };
}

describe("admin email template endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists active template versions through the router", async () => {
    await setupAdminTemplates();

    const response = await callAdmin("/api/v1/admin/email-templates");
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
    await setupAdminTemplates();

    const page1 = await callAdmin("/api/v1/admin/email-templates?limit=1&offset=0&sort=template_key");
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

    const page2 = await callAdmin("/api/v1/admin/email-templates?limit=1&offset=1&sort=template_key");
    const page2Payload = (await page2.json()) as { templates: Array<{ template_key: string }> };
    expect(page2Payload.templates).toHaveLength(1);
    expect(page2Payload.templates[0].template_key).not.toBe(page1Payload.templates[0].template_key);

    const lastPage = await callAdmin(
      `/api/v1/admin/email-templates?limit=1&offset=${page1Payload.page.total - 1}&sort=template_key`,
    );
    const lastPagePayload = (await lastPage.json()) as { page: { hasMore: boolean } };
    expect(lastPagePayload.page.hasMore).toBe(false);
  });

  it("filters the list by ?q= against template_key", async () => {
    await setupAdminTemplates();

    const response = await callAdmin("/api/v1/admin/email-templates?q=registration_confirm_email");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { templates: Array<{ template_key: string }>; page: { total: number } };
    expect(payload.templates).toHaveLength(1);
    expect(payload.templates[0].template_key).toBe("registration_confirm_email");
    expect(payload.page.total).toBe(1);
  });

  it("rejects an unknown ?sort= column as a schema validation error", async () => {
    await setupAdminTemplates();

    const response = await callAdmin("/api/v1/admin/email-templates?sort=not_a_real_column");
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });

  it("filters template catalogs by a validated key prefix in D1", async () => {
    await setupAdminTemplates();
    const response = await callAdmin("/api/v1/admin/email-templates?templateKeyPrefix=registration_");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { templates: Array<{ template_key: string }> };
    expect(payload.templates.length).toBeGreaterThan(0);
    expect(payload.templates.every((template) => template.template_key.startsWith("registration_"))).toBe(true);
    expect((await callAdmin("/api/v1/admin/email-templates?templateKeyPrefix=bad%2A")).status).toBe(400);
  });

  it("renders preview HTML and text with seeded partials and layout", async () => {
    await setupAdminTemplates();

    const response = await callAdmin("/api/v1/admin/email-templates/preview", {
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

  it("attributes a new template version to the real admin user and audit actor", async () => {
    const { adminId } = await setupAdminTemplates();

    const response = await callAdmin("/api/v1/admin/email-templates/attribution_test/versions", {
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

  it("keeps API-key audit identity out of the nullable template creator foreign key", async () => {
    await setupAdminTemplates();
    ADMIN_TOKEN = env.ADMIN_API_KEY ?? "test-admin-key";

    const response = await callAdmin("/api/v1/admin/email-templates/api_key_attribution_test/versions", {
      method: "POST",
      body: JSON.stringify({ content: "API-key attribution test body", contentType: "markdown" }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { version: { id: string } };
    expect(
      await queryAll<{ created_by_user_id: string | null }>(
        env.DB,
        "SELECT created_by_user_id FROM email_template_versions WHERE id = ?",
        payload.version.id,
      ),
    ).toEqual([{ created_by_user_id: null }]);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'email_template_version_created' AND entity_id = ?",
        payload.version.id,
      ),
    ).toEqual([{ actor_id: "api-key" }]);
  });

  it("rolls back a new template version when its audit row cannot be written", async () => {
    await setupAdminTemplates();
    await env.DB.prepare(
      `CREATE TRIGGER fail_email_template_version_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'email_template_version_created'
       BEGIN
         SELECT RAISE(ABORT, 'forced email template audit failure');
       END`,
    ).run();

    try {
      const response = await callAdmin("/api/v1/admin/email-templates/audit_rollback_test/versions", {
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
    await setupAdminTemplates();

    const versionsResponse = await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/versions", {
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
      version: { template_key: string; version: number; status: string };
    };
    expect(versionsPayload.success).toBe(true);
    expect(versionsPayload.version.template_key).toBe("registration_confirm_email");
    expect(versionsPayload.version.version).toBe(2);
    expect(versionsPayload.version.status).toBe("draft");

    const activateResponse = await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/activate", {
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

    const missingResponse = await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/activate", {
      method: "POST",
      body: JSON.stringify({ version: 999 }),
    });
    expect(missingResponse.status).toBe(404);
    const missingPayload = (await missingResponse.json()) as { error?: { code?: string } };
    expect(missingPayload.error?.code).toBe("EMAIL_TEMPLATE_VERSION_NOT_FOUND");
  });

  it("bounds GET .../:key/versions with limit/offset, ordered newest version first", async () => {
    await setupAdminTemplates();

    await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/versions", {
      method: "POST",
      body: JSON.stringify({
        content: "Updated confirmation body for {{firstName}}",
        subjectTemplate: "Updated confirmation",
        contentType: "markdown",
      }),
    });

    const unbounded = await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/versions");
    expect(unbounded.status).toBe(200);
    const unboundedPayload = (await unbounded.json()) as {
      versions: Array<{ version: number }>;
      page: { limit: number; offset: number; hasMore: boolean; total: number };
    };
    expect(unboundedPayload.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(unboundedPayload.page.total).toBe(2);
    expect(unboundedPayload.page.hasMore).toBe(false);

    const page1 = await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/versions?limit=1&offset=0");
    const page1Payload = (await page1.json()) as {
      versions: Array<{ version: number }>;
      page: { hasMore: boolean; total: number };
    };
    expect(page1Payload.versions).toHaveLength(1);
    expect(page1Payload.versions[0].version).toBe(2);
    expect(page1Payload.page.hasMore).toBe(true);
    expect(page1Payload.page.total).toBe(2);

    const page2 = await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/versions?limit=1&offset=1");
    const page2Payload = (await page2.json()) as { versions: Array<{ version: number }>; page: { hasMore: boolean } };
    expect(page2Payload.versions).toHaveLength(1);
    expect(page2Payload.versions[0].version).toBe(1);
    expect(page2Payload.page.hasMore).toBe(false);
  });

  it("searches and sorts template versions in D1 through the shared list contract", async () => {
    await setupAdminTemplates();

    await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/versions", {
      method: "POST",
      body: JSON.stringify({
        content: "Updated confirmation body",
        subjectTemplate: "Distinct draft subject",
        contentType: "markdown",
      }),
    });

    const search = await callAdmin(
      "/api/v1/admin/email-templates/registration_confirm_email/versions?q=distinct&sort=version",
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

    const invalidSort = await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/versions?sort=body");
    expect(invalidSort.status).toBe(400);
  });

  it("filters one template's versions by lifecycle status in D1", async () => {
    await setupAdminTemplates();
    await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/versions", {
      method: "POST",
      body: JSON.stringify({ content: "Draft body", subjectTemplate: "Draft", contentType: "markdown" }),
    });

    const active = await callAdmin(
      "/api/v1/admin/email-templates/registration_confirm_email/versions?status=active&limit=1&sort=-version",
    );
    expect(active.status).toBe(200);
    const activePayload = (await active.json()) as {
      versions: Array<{ version: number; status: string }>;
      page: { total: number };
    };
    expect(activePayload.versions).toEqual([expect.objectContaining({ version: 1, status: "active" })]);
    expect(activePayload.page.total).toBe(1);

    const drafts = await callAdmin(
      "/api/v1/admin/email-templates/registration_confirm_email/versions?status=draft&limit=1&sort=-version",
    );
    const draftPayload = (await drafts.json()) as {
      versions: Array<{ version: number; status: string }>;
      page: { total: number };
    };
    expect(draftPayload.versions).toEqual([expect.objectContaining({ version: 2, status: "draft" })]);
    expect(draftPayload.page.total).toBe(1);
    await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/activate", {
      method: "POST",
      body: JSON.stringify({ version: 2 }),
    });
    const archived = await callAdmin(
      "/api/v1/admin/email-templates/registration_confirm_email/versions?status=archived&limit=1",
    );
    expect(archived.status).toBe(200);
    const archivedPayload = (await archived.json()) as {
      versions: Array<{ version: number; status: string }>;
      page: { total: number };
    };
    expect(archivedPayload.versions).toEqual([expect.objectContaining({ version: 1, status: "archived" })]);
    expect(archivedPayload.page.total).toBe(1);
    expect(
      (await callAdmin("/api/v1/admin/email-templates/registration_confirm_email/versions?status=deleted")).status,
    ).toBe(400);
  });
});
