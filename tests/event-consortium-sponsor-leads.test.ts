import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrgRepresentative, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { withScannedInput } from "./helpers/scanned-input";
import { generateBadgeCredential } from "../assets/shared/schemas/badge-credential";
import { eventAudienceDetailSchema } from "../assets/shared/schemas/event-management";
import {
  leadCaptureRequestSchema,
  leadCaptureResponseSchema,
} from "../assets/shared/schemas/event-participation-reporting";
import {
  sponsorLeadConfirmationSchema,
  sponsorLeadDetailSchema,
  sponsorLeadListSchema,
  sponsorLeadNoteResponseSchema,
} from "../assets/shared/schemas/event-sponsor-lead-list";
import { hashBadgeCredential } from "../functions/_lib/services/event-participation/badge-hash";

const now = "2026-10-04T10:00:00.000Z";

function call(path: string, token: string, init: RequestInit = {}) {
  return app.fetch(
    new Request(`https://app.test/api/v1/events${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    }),
    env,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function sessionFor(person: { userId: string; identityId: string }) {
  return createAdminSession(env.DB, person.userId, crypto.randomUUID(), undefined, person.identityId);
}

async function sponsorship(type: "consortium" | "event", organizationId: string, eventId: string | null) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO sponsorships(id,sponsor_type,event_id,organization_id,tier,pipeline_stage,created_at,updated_at)
     VALUES(?,?,?,?,?,'active',?,?)`,
  )
    .bind(id, type, eventId, organizationId, type === "consortium" ? "Titanium" : "Leader", now, now)
    .run();
  return id;
}

async function admitTier(eventId: string, tier = "Titanium") {
  await env.DB.prepare("INSERT INTO event_consortium_lead_tiers(event_id,tier,created_at) VALUES(?,?,?)")
    .bind(eventId, tier, now)
    .run();
}

/** A registered attendee who agreed to sponsor data sharing, with a badge to scan. */
async function consentingAttendee(eventId: string) {
  const attendeeId = await insertUser(env.DB, `lead-${crypto.randomUUID()}@synthetic.test`);
  await env.DB.prepare("UPDATE users SET first_name='Alex',last_name='Example' WHERE id=?").bind(attendeeId).run();
  const registrationId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO registrations(id,event_id,user_id,status,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','test',?,?,?)",
  )
    .bind(registrationId, eventId, attendeeId, crypto.randomUUID(), now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,active,created_at) VALUES(?,?,'attendee','sponsor-data-sharing','1',1,?) ON CONFLICT DO NOTHING",
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
  return credential;
}

async function capture(sponsorId: string, operatorUserId: string, token: string, credential: string) {
  const input = leadCaptureRequestSchema.parse(
    withScannedInput({
      operatorUserId,
      operationId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      badgeId: credential,
      consentConfirmed: true,
      observedAt: now,
    }),
  );
  const response = await call(`/pqc-2026/sponsors/${sponsorId}/leads`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return { response, operationId: input.operationId };
}

beforeEach(async () => {
  await resetDb();
});

describe("consortium sponsor lead capture", () => {
  it("lets a consortium sponsor's staff scan only at events that admit its tier", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE events SET visibility='invitation_only' WHERE id=?").bind(eventId).run();
    const representative = await insertOrgRepresentative(env.DB);
    const consortiumId = await sponsorship("consortium", representative.organizationId, null);
    const token = await sessionFor(representative);
    const credential = await consentingAttendee(eventId);

    // No event admits the tier yet: the private event stays hidden and the sponsor holds no scanning grant.
    expect((await call("/pqc-2026", token)).status).toBe(404);
    expect((await capture(consortiumId, representative.userId, token, credential)).response.status).toBe(403);

    await admitTier(eventId);
    const detail = await call("/pqc-2026", token);
    expect(detail.status, await detail.clone().text()).toBe(200);
    const event = eventAudienceDetailSchema.parse(((await detail.json()) as { event: unknown }).event);
    expect(event.scannerAccess?.sponsors.map((sponsor) => sponsor.id)).toEqual([consortiumId]);

    const captured = await capture(consortiumId, representative.userId, token, credential);
    expect(captured.response.status, await captured.response.clone().text()).toBe(200);
    expect(leadCaptureResponseSchema.parse(await captured.response.json())).toMatchObject({ captured: true });
    const leads = await call(`/pqc-2026/sponsors/${consortiumId}/leads`, token);
    expect(sponsorLeadListSchema.parse(await leads.json()).leads).toMatchObject([{ name: "Alex Example" }]);

    // Withdrawing the tier from the event withdraws the sponsor's access to its leads there.
    await env.DB.prepare("DELETE FROM event_consortium_lead_tiers WHERE event_id=?").bind(eventId).run();
    expect((await call(`/pqc-2026/sponsors/${consortiumId}/leads`, token)).status).toBe(403);
  });

  it("scans as the organization's own event sponsorship when it also sponsors the event directly", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const representative = await insertOrgRepresentative(env.DB);
    const consortiumId = await sponsorship("consortium", representative.organizationId, null);
    const eventSponsorId = await sponsorship("event", representative.organizationId, eventId);
    await admitTier(eventId);
    const token = await sessionFor(representative);
    const credential = await consentingAttendee(eventId);

    const detail = await call("/pqc-2026", token);
    const event = eventAudienceDetailSchema.parse(((await detail.json()) as { event: unknown }).event);
    expect(event.scannerAccess?.sponsors.map((sponsor) => sponsor.id)).toEqual([eventSponsorId]);
    expect((await capture(consortiumId, representative.userId, token, credential)).response.status).toBe(404);
    expect((await capture(eventSponsorId, representative.userId, token, credential)).response.status).toBe(200);
  });
});

describe("sponsor lead notes", () => {
  it("lets the capturing operator and the sponsor's lead viewers keep one shared note", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const representative = await insertOrgRepresentative(env.DB);
    const consortiumId = await sponsorship("consortium", representative.organizationId, null);
    await admitTier(eventId);
    const token = await sessionFor(representative);
    const credential = await consentingAttendee(eventId);
    const { operationId } = await capture(consortiumId, representative.userId, token, credential);

    const confirmation = sponsorLeadConfirmationSchema.parse(
      await (await call(`/pqc-2026/sponsors/${consortiumId}/leads/confirmations/${operationId}`, token)).json(),
    );
    expect(confirmation).toMatchObject({ name: "Alex Example", note: null });
    const notePath = `/pqc-2026/sponsors/${consortiumId}/leads/${confirmation.leadId}/note`;
    const put = (as: string, note: string) => call(notePath, as, { method: "PUT", body: JSON.stringify({ note }) });

    const saved = await put(token, "  Wants a PQC migration demo.  ");
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(sponsorLeadNoteResponseSchema.parse(await saved.json()).note).toBe("Wants a PQC migration demo.");
    const detail = await call(`/pqc-2026/sponsors/${consortiumId}/leads/${confirmation.leadId}`, token);
    expect(sponsorLeadDetailSchema.parse(await detail.json()).lead.note).toBe("Wants a PQC migration demo.");
    expect((await put(token, "x".repeat(1001))).status).toBe(400);

    // A colleague who can scan for the sponsor but never captured this lead cannot write about it.
    const colleagueId = await insertUser(env.DB, "colleague@synthetic.test");
    const colleague = {
      userId: colleagueId,
      identityId: await addRepresentative(env.DB, representative.memberId, colleagueId),
    };
    expect((await put(await sessionFor(colleague), "Not mine")).status).toBe(404);

    // The sponsorship's verified contact mailbox edits every lead's note, and an empty note removes it.
    const viewerId = await insertUser(env.DB, "lead-contact@synthetic.test");
    await env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?").bind(now, viewerId).run();
    await env.DB.prepare("UPDATE sponsorships SET contact_email='lead-contact@synthetic.test' WHERE id=?")
      .bind(consortiumId)
      .run();
    const viewerToken = await createAdminSession(env.DB, viewerId, crypto.randomUUID());
    const cleared = await put(viewerToken, "   ");
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    expect(sponsorLeadNoteResponseSchema.parse(await cleared.json()).note).toBeNull();

    // The audit trail records each change, never the note's text.
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE action='sponsor_lead_note_replaced'",
    ).all<{ details_json: string }>();
    const details = audit.results.map((row) => JSON.parse(row.details_json) as { hasNote: { to: boolean } });
    expect(details.map((entry) => entry.hasNote.to).sort()).toEqual([false, true]);
    expect(audit.results.some((row) => row.details_json.includes("migration demo"))).toBe(false);
  });
});
