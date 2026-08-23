import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { openapi } from "../functions/router";

let adminToken: string;

async function setupAdmin(): Promise<void> {
  await seedEventAndAdmin(env.DB);
  const [{ id }] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
  );
  adminToken = await createAdminSession(env.DB, id, `admin-openapi-boundary-${crypto.randomUUID()}`);
}

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${adminToken}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function callAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    adminRequest(path, init),
    env as any,
    {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any,
  );
}

describe("admin OpenAPI mutation boundaries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("publishes contracts for the previously raw admin mutations", () => {
    const spec = decorateOpenApiSpec(openapi.schema);

    expect(spec.paths["/api/v1/admin/email-templates/preview"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/email-templates/{key}/versions"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/organizations/{id}/logo"].put).toBeDefined();
    expect(spec.paths["/api/v1/admin/organizations/{id}/logo"].delete).toBeDefined();
    expect(spec.paths["/api/v1/admin/users/{userId}/anonymize"].post).toBeDefined();
    expect(
      spec.paths["/api/v1/admin/organizations/{id}/logo"].delete.responses["200"].content["application/json"].schema,
    ).toMatchObject({ required: ["success"] });
  });

  it("rejects invalid JSON bodies at the preview and version contract boundaries", async () => {
    await setupAdmin();

    const preview = await callAdmin("/api/v1/admin/email-templates/preview", {
      method: "POST",
      body: JSON.stringify({ content: "" }),
    });
    expect(preview.status).toBe(400);
    await expect(preview.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const version = await callAdmin("/api/v1/admin/email-templates/example/versions", {
      method: "POST",
      body: JSON.stringify({ content: "" }),
    });
    expect(version.status).toBe(400);
    await expect(version.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("validates path parameters before anonymization or binary logo processing", async () => {
    await setupAdmin();

    const anonymize = await callAdmin("/api/v1/admin/users/not-a-database-id/anonymize", { method: "POST" });
    expect(anonymize.status).toBe(400);
    await expect(anonymize.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const logo = await callAdmin("/api/v1/admin/organizations/not-a-database-id/logo", {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(logo.status).toBe(400);
    await expect(logo.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("mounts organization logo handlers without consuming the binary request body as JSON", async () => {
    await setupAdmin();
    const organizationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
       VALUES (?, 'Mounted Logo Organization', 'mounted logo organization', datetime('now'), datetime('now'))`,
    )
      .bind(organizationId)
      .run();

    const put = await callAdmin(`/api/v1/admin/organizations/${organizationId}/logo`, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { success: boolean; r2Key: string; logoUrl: string };
    expect(putBody).toMatchObject({ success: true, logoUrl: `/api/v1/members/${organizationId}/logo` });

    const remove = await callAdmin(`/api/v1/admin/organizations/${organizationId}/logo`, { method: "DELETE" });
    expect(remove.status).toBe(200);
    await expect(remove.json()).resolves.toEqual({ success: true });
  });
});
