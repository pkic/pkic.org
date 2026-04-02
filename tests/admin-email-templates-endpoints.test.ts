import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";

const ADMIN_TOKEN = "email-templates-admin-token";

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
  const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1"))[0];
  await createAdminSession(env.DB, adminRow.id, ADMIN_TOKEN);
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

    const payload = await response.json() as { templates: Array<{ template_key: string; status: string; version: number }> };
    expect(payload.templates.some((template) => template.template_key === "email_layout" && template.status === "active")).toBe(true);
    expect(payload.templates.some((template) => template.template_key === "registration_confirm_email" && template.status === "active")).toBe(true);
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
    const payload = await response.json() as { success: boolean; subject: string; html: string; text: string };
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
    const versionsPayload = await versionsResponse.json() as {
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
    const activatePayload = await activateResponse.json() as { success: boolean };
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
    const missingPayload = await missingResponse.json() as { error?: { code?: string } };
    expect(missingPayload.error?.code).toBe("EMAIL_TEMPLATE_VERSION_NOT_FOUND");
  });
});