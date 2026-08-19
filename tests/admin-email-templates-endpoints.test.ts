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
});
