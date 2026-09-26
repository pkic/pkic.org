import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  registrationCreateSchema,
  registrationManageReadResponseSchema,
  registrationSubmissionResponseSchema,
} from "../assets/shared/schemas/registration";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { getRegistrationById } from "../functions/_lib/services/registrations";
import { getEventBySlug } from "../functions/_lib/services/events";
import { buildRegistrationCsv } from "../functions/_lib/services/registrations/export";
import { prepareValidatedAttendeeRegistration } from "../functions/_lib/services/attendee-registration";
import { commitRegistrationSubmission } from "../functions/_lib/services/registration-submission";
import {
  selectRegistrationIdentity,
  prepareSelectedRegistrationIdentityGuard,
} from "../functions/_lib/services/registrations/selected-identity";
import { listSponsorAttendeesForExport } from "../functions/_lib/services/sponsorship/sponsor-access";
import { nowIso } from "../functions/_lib/utils/time";

beforeEach(resetDb);

async function fixture() {
  await seedEventAndAdmin(env.DB);
  const email = `identity-${crypto.randomUUID()}@example.test`;
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare(
    "UPDATE users SET first_name = 'Event', last_name = 'Attendee', organization_name = 'Account organization', job_title = 'Account role' WHERE id = ?",
  )
    .bind(userId)
    .run();
  const organizationId = await insertOrganization(env.DB, "Selected organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Selected role" });
  const token = await createMemberSession(env.DB, userId, `registration-${crypto.randomUUID()}`);
  const body = registrationCreateSchema.parse({
    firstName: "Event",
    lastName: "Attendee",
    email,
    identityId,
    attendanceType: "virtual",
    sourceType: "direct",
    consents: [
      { termKey: "privacy-policy", version: "v1" },
      { termKey: "code-of-conduct", version: "v1" },
    ],
  });
  return { userId, identityId, memberId, email, token, body };
}

function register(body: unknown, token?: string) {
  return callApi(env, "/api/v1/events/pqc-2026/registrations", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function participationCounts(userId: string) {
  return queryAll<{ identities: number; memberships: number; subscriptions: number }>(
    env.DB,
    `SELECT (SELECT COUNT(*) FROM identities WHERE user_id = ?) AS identities,
      (SELECT COUNT(*) FROM group_memberships WHERE user_id = ?) AS memberships,
      (SELECT COUNT(*) FROM mailing_list_subscription_preferences WHERE user_id = ?) AS subscriptions`,
    [userId, userId, userId],
  );
}

async function managePath(registrationId: string) {
  const token = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "registration_manage",
    resourceId: registrationId,
  });
  return `/api/v1/registrations/access/${encodeURIComponent(token)}`;
}

describe("explicit event identity selection", () => {
  it("keeps the selected identity through registration, management, email and export without changing participation or the account profile", async () => {
    const f = await fixture();
    const before = await participationCounts(f.userId);
    const response = await register(f.body, f.token);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = registrationSubmissionResponseSchema.parse(await response.json());
    expect(result.status).toBe("registered");
    expect((await getRegistrationById(env.DB, result.registrationId)).registration_identity_id).toBe(f.identityId);
    await env.DB.prepare("UPDATE identities SET job_title = ? WHERE id = ?").bind("Later role", f.identityId).run();
    const path = await managePath(result.registrationId);
    const managed = registrationManageReadResponseSchema.parse(await (await callApi(env, path)).json());
    expect(managed.identityId).toBe(f.identityId);
    expect(managed.user).toMatchObject({ organization_name: "Selected organization", job_title: "Selected role" });
    const emails = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE recipient_user_id = ?",
      [f.userId],
    );
    expect(
      emails.some(
        (row) => row.payload_json.includes("Selected organization") && row.payload_json.includes("Selected role"),
      ),
    ).toBe(true);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const exported = await buildRegistrationCsv(
      env.DB,
      { id: event.id, source_mode: event.source_mode! },
      { maxRows: 100, maxBytes: 100000 },
    );
    expect(exported.csv).toContain("Selected organization");
    expect(exported.csv).toContain("Selected role");
    await env.DB.prepare(
      `INSERT INTO consent_acceptances
       (id, registration_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
       VALUES (?, ?, ?, ?, 'attendee', 'sponsor-data-sharing', 'v1', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), result.registrationId, event.id, f.userId)
      .run();
    expect(await listSponsorAttendeesForExport(env.DB, event.id, 100)).toEqual([
      expect.objectContaining({ organizationName: "Selected organization", jobTitle: "Selected role" }),
    ]);
    expect(await participationCounts(f.userId)).toEqual(before);
    expect(await queryAll(env.DB, "SELECT organization_name, job_title FROM users WHERE id = ?", [f.userId])).toEqual([
      { organization_name: "Account organization", job_title: "Account role" },
    ]);
    expect((await register(f.body, f.token)).status).toBe(409);
    expect(await participationCounts(f.userId)).toEqual(before);
    const edited = await callApi(env, path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", organizationName: "Different organization" }),
    });
    expect(edited.status).toBe(422);
  });

  it("keeps missing identity details specific to the event and rejects conflicting identity answers", async () => {
    const f = await fixture();
    expect(
      (await register({ ...f.body, customAnswers: { organization_name: "Conflicting organization" } }, f.token)).status,
    ).toBe(422);
    await env.DB.prepare("UPDATE identities SET job_title = NULL WHERE id = ?").bind(f.identityId).run();
    const response = await register({ ...f.body, jobTitle: "Event role only" }, f.token);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = registrationSubmissionResponseSchema.parse(await response.json());
    const path = await managePath(result.registrationId);
    const managed = registrationManageReadResponseSchema.parse(await (await callApi(env, path)).json());
    expect(managed.user?.job_title).toBe("Event role only");
    expect(
      await env.DB.prepare("SELECT job_title FROM identities WHERE id = ?").bind(f.identityId).first("job_title"),
    ).toBeNull();
    const changed = await callApi(env, path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", customAnswers: { job_title: "Changed later" } }),
    });
    expect(changed.status).toBe(422);
  });

  it("requires the signed-in owner's email and an active identity owned by that person", async () => {
    const f = await fixture();
    expect((await register(f.body)).status).toBe(401);
    expect((await register({ ...f.body, email: "another@example.test" }, f.token)).status).toBe(422);
    const otherUser = await insertUser(env.DB);
    const otherIdentity = await addRepresentative(env.DB, f.memberId, otherUser);
    expect((await register({ ...f.body, identityId: otherIdentity }, f.token)).status).toBe(403);
    // Keep another live identity so the session still resolves after this one ends.
    const otherOrganization = await insertOrganization(env.DB, "Other capacity");
    const otherMember = await seedOrganizationAggregate(env.DB, otherOrganization, "A");
    await addRepresentative(env.DB, otherMember, f.userId);
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), f.identityId).run();
    const liveToken = await createMemberSession(env.DB, f.userId, "remaining-capacity");
    expect((await register(f.body, liveToken)).status).toBe(403);
    expect(await queryAll(env.DB, "SELECT id FROM registrations WHERE user_id = ?", [f.userId])).toEqual([]);
  });

  it("rolls back registration, consent, referral and email work when the chosen capacity ends before commit", async () => {
    const f = await fixture();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const selectedIdentity = await selectRegistrationIdentity(env.DB, f.userId, f.identityId);
    const { prepared } = await prepareValidatedAttendeeRegistration(env.DB, f.body, {
      event: { id: event.id, source_mode: event.source_mode },
      invite: null,
      sourceType: "direct",
      ip: null,
      userAgent: null,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      pendingConfirmationDeadlineHours: 24,
      confirmationTtlHours: 24,
      referralCodeLength: 8,
      verifiedIdentity: { userId: f.userId, selectedIdentity },
      authorizationGuards: [prepareSelectedRegistrationIdentityGuard(env.DB, selectedIdentity)],
    });
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), f.identityId).run();
    await expect(commitRegistrationSubmission(env.DB, prepared)).rejects.toMatchObject({ status: 409 });
    for (const table of ["registrations", "consent_acceptances", "referral_codes", "email_outbox"]) {
      const rows = await queryAll<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM ${table}`);
      expect(rows[0].count, table).toBe(0);
    }
  });

  it("enforces identity ownership in D1 even outside the HTTP adapter", async () => {
    const f = await fixture();
    const created = registrationSubmissionResponseSchema.parse(await (await register(f.body, f.token)).json());
    const otherUser = await insertUser(env.DB);
    const otherIdentity = await addRepresentative(env.DB, f.memberId, otherUser);
    await expect(
      env.DB.prepare("UPDATE registrations SET registration_identity_id = ? WHERE id = ?")
        .bind(otherIdentity, created.registrationId)
        .run(),
    ).rejects.toThrow("REGISTRATION_IDENTITY_OWNER_MISMATCH");
    expect((await getRegistrationById(env.DB, created.registrationId)).registration_identity_id).toBe(f.identityId);
  });
});
