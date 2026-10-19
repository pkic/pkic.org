import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../functions/router";
import { eventAudienceDetailSchema, eventsAudienceListResponseSchema } from "../assets/shared/schemas/event-management";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

type LeadPermission = "agenda:leads_view" | "agenda:leads_export";

async function request(path: string, token: string) {
  return app.fetch(
    new Request(`https://app.test/api/v1/events${path}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function fixture(permission: LeadPermission, throughRole = false) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const otherEventId = crypto.randomUUID();
  await env.DB.prepare("UPDATE events SET visibility='invitation_only', settings_json=? WHERE id=?")
    .bind(JSON.stringify({ internal: "private-event-setting" }), eventId)
    .run();
  await env.DB.prepare(
    `INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,registration_mode,visibility,created_at,updated_at)
     SELECT ?,'other-private','Other private event',timezone,starts_at,ends_at,registration_mode,
       'invitation_only',created_at,updated_at FROM events WHERE id=?`,
  )
    .bind(otherEventId, eventId)
    .run();
  const sponsorId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,contact_email,pipeline_stage,created_at,updated_at)
     VALUES(?,'event',?,'Only my sponsor','private-sponsor-contact@example.test','active',?,?)`,
  )
    .bind(sponsorId, eventId, now, now)
    .run();
  const userId = await insertUser(env.DB);
  const grantId = crypto.randomUUID();
  let grantTable = "permission_grants";
  if (throughRole) {
    const roleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO roles(id,name,created_at,updated_at) VALUES(?,?,?,?)")
      .bind(roleId, `Sponsor-only ${roleId}`, now, now)
      .run();
    await env.DB.prepare("INSERT INTO role_permissions(id,role_id,permission,created_at) VALUES(?,?,?,?)")
      .bind(crypto.randomUUID(), roleId, permission, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO user_roles(id,user_id,role_id,context_type,context_id,created_at) VALUES(?,?,?,'event_sponsor',?,?)",
    )
      .bind(grantId, userId, roleId, sponsorId, now)
      .run();
    grantTable = "user_roles";
  } else {
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,'event_sponsor',?,?)",
    )
      .bind(grantId, userId, permission, sponsorId, now)
      .run();
  }
  const token = await createAdminSession(env.DB, userId, crypto.randomUUID());
  return { token, sponsorId, grantId, grantTable, otherEventId };
}

async function slugs(token: string) {
  const response = await request("", token);
  expect(response.status, await response.clone().text()).toBe(200);
  return eventsAudienceListResponseSchema.parse(await response.json()).events.map((event) => event.slug);
}

describe("sponsor-only lead viewer event discovery", () => {
  beforeEach(resetDb);

  for (const permission of ["agenda:leads_view", "agenda:leads_export"] as const) {
    for (const throughRole of [false, true]) {
      it(`${permission} through ${throughRole ? "a role" : "a direct grant"} discovers only its event without roster or agenda privileges`, async () => {
        const { token } = await fixture(permission, throughRole);
        expect(await slugs(token)).toEqual(["pqc-2026"]);
        expect((await request("/other-private", token)).status).toBe(404);
        const response = await request("/pqc-2026", token);
        expect(response.status).toBe(200);
        const detail = eventAudienceDetailSchema.parse(((await response.json()) as { event: unknown }).event);
        expect(detail.accessLevel).toBe("participant");
        expect(JSON.stringify(detail)).not.toContain("private-event-setting");
        expect(JSON.stringify(detail)).not.toContain("private-sponsor-contact");
        expect(detail.scannerAccess?.canScan ?? false).toBe(false);
        expect((await request("/pqc-2026/agenda", token)).status).toBe(403);
        expect((await request("/pqc-2026/badges/attendees", token)).status).toBe(403);
      });
    }

    for (const invalidation of ["revoked_at", "expires_at"] as const) {
      it(`${permission} loses discovery when its grant is ${invalidation === "revoked_at" ? "revoked" : "expired"}`, async () => {
        const { token, grantId } = await fixture(permission);
        expect(await slugs(token)).toEqual(["pqc-2026"]);
        await env.DB.prepare(`UPDATE permission_grants SET ${invalidation}=? WHERE id=?`)
          .bind("2000-01-01T00:00:00.000Z", grantId)
          .run();
        expect((await request("", token)).status).toBe(401);
        expect((await request("/pqc-2026", token)).status).toBe(401);
      });
    }

    it(`${permission} follows the active canonical sponsor event and refuses a lapsed sponsor`, async () => {
      const { token, sponsorId, otherEventId } = await fixture(permission);
      expect(await slugs(token)).toEqual(["pqc-2026"]);
      await env.DB.prepare("UPDATE sponsorships SET pipeline_stage='lapsed' WHERE id=?").bind(sponsorId).run();
      expect(await slugs(token)).toEqual([]);
      expect((await request("/pqc-2026", token)).status).toBe(404);
      await env.DB.prepare("UPDATE sponsorships SET pipeline_stage='active', event_id=? WHERE id=?")
        .bind(otherEventId, sponsorId)
        .run();
      expect(await slugs(token)).toEqual(["other-private"]);
      expect((await request("/pqc-2026", token)).status).toBe(404);
      expect((await request("/other-private/badges/attendees", token)).status).toBe(403);
    });
  }
});
