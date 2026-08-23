import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { apiErrorPayloadSchema, successResponseSchema } from "../assets/shared/schemas/api-common";
import { adminEventTermsResponseSchema } from "../assets/shared/schemas/admin-events";
import { adminEventSyncResponseSchema } from "../assets/shared/schemas/route-contracts-admin-events";
import { eventSponsorTiersResponseSchema } from "../assets/shared/schemas/admin-sponsorships";
import { openapi } from "../functions/router";

async function setupAdmin(): Promise<string> {
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  return createAdminSession(env.DB, admin.id, `event-config-${crypto.randomUUID()}`);
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("admin event configuration OpenAPI boundaries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("documents every event configuration route through its mounted OpenAPI router", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    expect(spec.paths["/api/v1/admin/events/sync-from-hugo"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/settings"].patch).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/terms"].get).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/terms"].put).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/sponsor-tiers"].get).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/sponsor-tiers"].put).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/permissions/{permId}"].delete).toBeDefined();
  });

  it("returns the canonical error envelope for malformed and invalid configuration payloads", async () => {
    const token = await setupAdmin();

    const malformed = await call(token, "/api/v1/admin/events/sync-from-hugo", {
      method: "POST",
      body: "{not-json",
    });
    expect(malformed.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await malformed.json()).error.code).toBe("INVALID_JSON");

    const invalidTerms = await call(token, "/api/v1/admin/events/pqc-2026/terms", {
      method: "PUT",
      body: JSON.stringify({
        attendee: [
          { termKey: "privacy-policy", version: "v1", displayText: "Accept this policy." },
          { termKey: "privacy-policy", version: "v1", displayText: "Accept this policy twice." },
        ],
        speaker: [],
        presentation: [],
      }),
    });
    expect(invalidTerms.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await invalidTerms.json()).error.code).toBe("VALIDATION_ERROR");

    const invalidTiers = await call(token, "/api/v1/admin/events/pqc-2026/sponsor-tiers", {
      method: "PUT",
      body: JSON.stringify({
        tiers: [
          { tierName: "Leader", hasAttendeeDataAccess: true },
          { tierName: "leader", hasAttendeeDataAccess: false },
        ],
      }),
    });
    expect(invalidTiers.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await invalidTiers.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("parses successful response bodies for sync, terms, sponsor tiers, and permission revocation", async () => {
    const token = await setupAdmin();

    const sync = await call(token, "/api/v1/admin/events/sync-from-hugo", {
      method: "POST",
      body: JSON.stringify({
        event: { slug: "contract-event", name: "Contract Event", timezone: "UTC" },
      }),
    });
    expect(sync.status).toBe(200);
    expect(adminEventSyncResponseSchema.parse(await sync.json()).event.slug).toBe("contract-event");

    const terms = await call(token, "/api/v1/admin/events/pqc-2026/terms");
    expect(terms.status).toBe(200);
    expect(adminEventTermsResponseSchema.parse(await terms.json()).terms.attendee).toBeInstanceOf(Array);

    const tiersPut = await call(token, "/api/v1/admin/events/pqc-2026/sponsor-tiers", {
      method: "PUT",
      body: JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] }),
    });
    expect(tiersPut.status).toBe(200);
    expect(eventSponsorTiersResponseSchema.parse(await tiersPut.json()).tiers).toEqual([
      { tierName: "Leader", hasAttendeeDataAccess: true },
    ]);

    const permission = await call(token, "/api/v1/admin/events/pqc-2026/permissions", {
      method: "POST",
      body: JSON.stringify({ userEmail: "contract-permission@example.test", permission: "organizer" }),
    });
    expect(permission.status).toBe(201);
    const permissionBody = (await permission.json()) as { permission: { id: string } };
    const permissionId = permissionBody.permission.id;

    const revoked = await call(token, `/api/v1/admin/events/pqc-2026/permissions/${permissionId}`, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(200);
    expect(successResponseSchema.parse(await revoked.json())).toEqual({ success: true });
  });
});
