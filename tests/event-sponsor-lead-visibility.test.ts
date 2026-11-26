import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app, { callApi } from "./helpers/app";
import { eventAudienceDetailSchema, eventsAudienceListResponseSchema } from "../assets/shared/schemas/event-management";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { insertOrgRepresentative } from "./helpers/membership";
import { withScannedInput } from "./helpers/scanned-input";
import { generateBadgeCredential } from "../assets/shared/schemas/badge-credential";
import { hashBadgeCredential } from "../functions/_lib/services/event-participation/badge-hash";
import {
  leadCaptureRequestSchema,
  leadCaptureResponseSchema,
} from "../assets/shared/schemas/event-participation-reporting";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { computeGrantsForUser } from "../functions/_lib/auth/permissions";
import { findEligibleStaffUserById } from "../functions/_lib/auth/identity-capacities";
import { resetDb } from "./helpers/reset-db";
import {
  sponsorLeadConfirmationSchema,
  sponsorLeadListSchema,
  sponsorLeadSponsorsSchema,
} from "../assets/shared/schemas/event-sponsor-lead-list";

type LeadPermission = "agenda:leads_view" | "agenda:leads_capture" | "agenda:leads_export";

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

describe("sponsor lead event discovery", () => {
  beforeEach(resetDb);

  it("grants capture to active staff of the sponsoring organization and removes it when their link ends", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE events SET visibility='invitation_only' WHERE id=?").bind(eventId).run();
    const representative = await insertOrgRepresentative(env.DB);
    const outsider = await insertOrgRepresentative(env.DB);
    const sponsorId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO sponsorships(id,sponsor_type,event_id,organization_id,pipeline_stage,created_at,updated_at)
       VALUES(?,'event',?,?,'active',?,?)`,
    )
      .bind(sponsorId, eventId, representative.organizationId, now, now)
      .run();
    const token = await createAdminSession(
      env.DB,
      representative.userId,
      crypto.randomUUID(),
      undefined,
      representative.identityId,
    );
    const outsiderToken = await createAdminSession(
      env.DB,
      outsider.userId,
      crypto.randomUUID(),
      undefined,
      outsider.identityId,
    );
    expect(await findEligibleStaffUserById(env.DB, representative.userId)).not.toBeNull();
    expect(await computeGrantsForUser(env.DB, representative.userId, representative.memberId)).toContainEqual({
      permission: "agenda:leads_capture",
      contextType: "event_sponsor",
      contextId: sponsorId,
    });
    const sessionResponse = await app.fetch(
      new Request("https://app.test/api/v1/auth/session", { headers: { authorization: `Bearer ${token}` } }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(sessionResponse.status, await sessionResponse.clone().text()).toBe(200);
    expect(userAuthSessionResponseSchema.parse(await sessionResponse.json()).staff?.grants).toContainEqual({
      permission: "agenda:leads_capture",
      contextType: "event_sponsor",
      contextId: sponsorId,
    });
    const detailResponse = await request("/pqc-2026", token);
    expect(detailResponse.status, await detailResponse.clone().text()).toBe(200);
    const detail = eventAudienceDetailSchema.parse(((await detailResponse.json()) as { event: unknown }).event);
    expect(detail.scannerAccess?.sponsors.map((sponsor) => sponsor.id)).toEqual([sponsorId]);
    expect(detail.sponsorLeadAccess).toBe(true);
    expect((await request("/pqc-2026/scans/attendees?q=Test", token)).status).toBe(403);
    expect((await request(`/pqc-2026/scans/attendees/${crypto.randomUUID()}/badge`, token)).status).toBe(403);
    expect((await request("/pqc-2026/badges/attendees?q=Test", token)).status).toBe(403);
    const beforeScans = await request(`/pqc-2026/sponsors/${sponsorId}/leads`, token);
    expect(beforeScans.status).toBe(200);
    expect(sponsorLeadListSchema.parse(await beforeScans.json()).leads).toEqual([]);
    const offlineQuery = new URLSearchParams({
      epochId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      includeBadgeNames: "true",
    });
    expect((await request(`/pqc-2026/offline-eligibility?${offlineQuery}`, token)).status).toBe(403);
    expect((await request("/pqc-2026", outsiderToken)).status).toBe(404);

    const attendeeId = await insertUser(env.DB, "lead-attendee@synthetic.test");
    await env.DB.prepare("UPDATE users SET first_name='Alex',last_name='Example' WHERE id=?").bind(attendeeId).run();
    const registrationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','test',?,?,?)",
    )
      .bind(registrationId, eventId, attendeeId, crypto.randomUUID(), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,active,created_at) VALUES(?,?,'attendee','sponsor-data-sharing','1',1,?)",
    )
      .bind(crypto.randomUUID(), eventId, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO consent_acceptances(id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at) VALUES(?,?,?,?,'attendee','sponsor-data-sharing','1',?)",
    )
      .bind(crypto.randomUUID(), registrationId, eventId, attendeeId, now)
      .run();
    const credential = generateBadgeCredential();
    await env.DB.prepare(
      "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at) VALUES(?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, attendeeId, await hashBadgeCredential(credential), now)
      .run();
    const input = leadCaptureRequestSchema.parse(
      withScannedInput({
        operatorUserId: representative.userId,
        operationId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        badgeId: credential,
        consentConfirmed: true,
        observedAt: now,
      }),
    );
    const withoutConsent = await app.fetch(
      new Request(`https://app.test/api/v1/events/pqc-2026/sponsors/${sponsorId}/leads`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...input, consentConfirmed: false }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(withoutConsent.status).toBe(400);
    const captured = await app.fetch(
      new Request(`https://app.test/api/v1/events/pqc-2026/sponsors/${sponsorId}/leads`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(captured.status, await captured.clone().text()).toBe(200);
    expect(leadCaptureResponseSchema.parse(await captured.json())).toMatchObject({ recorded: true, captured: true });
    const ownScans = await request(`/pqc-2026/sponsors/${sponsorId}/leads`, token);
    expect(ownScans.status).toBe(200);
    expect(sponsorLeadListSchema.parse(await ownScans.json()).leads).toMatchObject([{ name: "Alex Example" }]);
    const savedCount = await request("/pqc-2026/sponsors/leads", token);
    expect(savedCount.status).toBe(200);
    expect(sponsorLeadSponsorsSchema.parse(await savedCount.json()).sponsors[0]).toMatchObject({
      canView: false,
      canCapture: true,
    });
    const confirmationPath = `/pqc-2026/sponsors/${sponsorId}/leads/confirmations/${input.operationId}`;
    const confirmation = await callApi(
      env,
      `/api/v1/events${confirmationPath}`,
      { headers: { authorization: `Bearer ${token}` } },
      { maxRoundTrips: 1 },
    );
    expect(confirmation.status, await confirmation.clone().text()).toBe(200);
    expect(confirmation.headers.get("cache-control")).toContain("no-store");
    expect(sponsorLeadConfirmationSchema.parse(await confirmation.json())).toMatchObject({ name: "Alex Example" });
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:leads_capture','event_sponsor',?,?)",
    )
      .bind(crypto.randomUUID(), representative.userId, sponsorId, now)
      .run();
    await env.DB.prepare("UPDATE sponsorships SET renewal_date='2000-01-01' WHERE id=?").bind(sponsorId).run();
    expect((await request(confirmationPath, token)).status).toBe(404);
    const expiredCapture = await callApi(env, `/api/v1/events/pqc-2026/sponsors/${sponsorId}/leads`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...input, operationId: crypto.randomUUID() }),
    });
    expect(expiredCapture.status, await expiredCapture.clone().text()).toBe(404);
    await env.DB.prepare("UPDATE sponsorships SET renewal_date=NULL,ended_reason='cancelled' WHERE id=?")
      .bind(sponsorId)
      .run();
    expect((await request(confirmationPath, token)).status).toBe(404);
    await env.DB.prepare("UPDATE sponsorships SET ended_reason=NULL WHERE id=?").bind(sponsorId).run();
    expect((await request(confirmationPath, outsiderToken)).status).toBe(403);
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:leads_capture','event_sponsor',?,?)",
    )
      .bind(crypto.randomUUID(), outsider.userId, sponsorId, now)
      .run();
    const otherOperatorToken = await createAdminSession(
      env.DB,
      outsider.userId,
      crypto.randomUUID(),
      undefined,
      outsider.identityId,
    );
    const otherScans = await request(`/pqc-2026/sponsors/${sponsorId}/leads?q=Alex`, otherOperatorToken);
    expect(otherScans.status).toBe(200);
    expect(sponsorLeadListSchema.parse(await otherScans.json()).leads).toEqual([]);
    expect((await request(confirmationPath, otherOperatorToken)).status).toBe(404);
    expect(
      (await request(`/pqc-2026/sponsors/${sponsorId}/leads/confirmations/${crypto.randomUUID()}`, token)).status,
    ).toBe(404);
    await env.DB.prepare("UPDATE consent_acceptances SET withdrawn_at=? WHERE registration_id=?")
      .bind(now, registrationId)
      .run();
    // The person agreed in person when scanned, so withdrawing portal sponsor sharing leaves the lead in place.
    expect((await request(confirmationPath, token)).status).toBe(200);
    await env.DB.prepare(
      "DELETE FROM permission_grants WHERE user_id=? AND context_id=? AND permission='agenda:leads_capture'",
    )
      .bind(representative.userId, sponsorId)
      .run();
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(now, representative.identityId).run();
    expect((await request(confirmationPath, token)).status).toBe(403);
    expect((await request("/pqc-2026", token)).status).toBe(404);
  });

  it("never grants a lead-only operator attendee search, badge resolution, or the offline name inventory", async () => {
    const { token, sponsorId } = await fixture("agenda:leads_capture");
    const detailResponse = await request("/pqc-2026", token);
    expect(detailResponse.status).toBe(200);
    const detail = eventAudienceDetailSchema.parse(((await detailResponse.json()) as { event: unknown }).event);
    expect(detail.scannerAccess?.sponsors).toContainEqual({ id: sponsorId, name: "Only my sponsor" });
    expect(detail.sponsorLeadAccess).toBe(true);
    expect((await request("/pqc-2026/scans/attendees?q=Test", token)).status).toBe(403);
    expect((await request(`/pqc-2026/scans/attendees/${crypto.randomUUID()}/badge`, token)).status).toBe(403);
    expect((await request("/pqc-2026/badges/attendees?q=Test", token)).status).toBe(403);
    const ownScans = await request(`/pqc-2026/sponsors/${sponsorId}/leads`, token);
    expect(ownScans.status).toBe(200);
    expect(sponsorLeadListSchema.parse(await ownScans.json()).leads).toEqual([]);
    const offlineQuery = new URLSearchParams({
      epochId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      includeBadgeNames: "true",
    });
    expect((await request(`/pqc-2026/offline-eligibility?${offlineQuery}`, token)).status).toBe(403);
  });

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
        expect(await slugs(token)).toEqual([]);
        expect((await request("/pqc-2026", token)).status).toBe(404);
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
