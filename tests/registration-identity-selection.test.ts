import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  registrationCreateSchema,
  registrationManageReadResponseSchema,
  registrationSubmissionResponseSchema,
} from "../assets/shared/schemas/registration";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin, createTestRateLimiter } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { getRegistrationById, createRegistration } from "../functions/_lib/services/registrations";
import { getEventBySlug } from "../functions/_lib/services/events";
import { buildRegistrationCsv } from "../functions/_lib/services/registrations/export";
import { prepareValidatedAttendeeRegistration } from "../functions/_lib/services/attendee-registration";
import { commitRegistrationSubmission } from "../functions/_lib/services/registration-submission";
import {
  selectRegistrationIdentity,
  prepareSelectedRegistrationIdentityGuard,
} from "../functions/_lib/services/registrations/selected-identity";
import { listSponsorAttendeesForExport } from "../functions/_lib/services/sponsorship/sponsor-access";
import { nowIso, addHours } from "../functions/_lib/utils/time";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { findEligibleMemberById } from "../functions/_lib/auth/identity-capacities";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import type { DatabaseLike, Env } from "../functions/_lib/types";

let registrationEnvironment: Env;

beforeEach(async () => {
  await resetDb();
  registrationEnvironment = {
    ...env,
    EMAIL_RATE_LIMITER: createTestRateLimiter(3),
    IP_RATE_LIMITER: createTestRateLimiter(20),
  };
});

async function fixture(withMembership = true) {
  await seedEventAndAdmin(env.DB);
  const email = `identity-${crypto.randomUUID()}@example.test`;
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare(
    "UPDATE users SET first_name = 'Event', last_name = 'Attendee', organization_name = 'Account organization', job_title = 'Account role' WHERE id = ?",
  )
    .bind(userId)
    .run();
  const organizationId = await insertOrganization(env.DB, "Selected organization");
  const memberId = withMembership ? await seedOrganizationAggregate(env.DB, organizationId, "A") : null;
  const identity = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId,
    source: "staff",
    jobTitle: "Selected role",
    startImmediately: true,
  });
  await env.DB.batch([identity.statement]);
  const identityId = identity.identityId;
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
  return { userId, identityId, organizationId, memberId, email, token, body };
}

function register(body: unknown, token?: string, db: DatabaseLike = env.DB) {
  return callApi({ ...registrationEnvironment, DB: db }, "/api/v1/events/pqc-2026/registrations", {
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

async function affiliationAuthorityCounts(userId: string, organizationId: string) {
  return queryAll(
    env.DB,
    `SELECT
    (SELECT COUNT(*) FROM members WHERE user_id = ? OR organization_id = ?) AS members,
    (SELECT COUNT(*) FROM identity_member_capacities capacity JOIN identities identity
      ON identity.id = capacity.identity_id WHERE identity.user_id = ?) AS capacities,
    (SELECT COUNT(*) FROM user_roles WHERE user_id = ?) AS roles`,
    [userId, organizationId, userId, userId],
  );
}

async function expectNoRegistrationEffects(userId: string) {
  for (const table of [
    "registrations",
    "consent_acceptances",
    "referral_codes",
    "email_outbox",
    "event_day_waitlist_entries",
  ]) {
    const rows = await queryAll<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM ${table}`);
    expect(rows[0].count, table).toBe(0);
  }
  expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE actor_id = ?", [userId])).toEqual([]);
}

describe("explicit event identity selection", () => {
  it("keeps the selected identity through registration, management, email and export without changing participation or the account profile", async () => {
    const f = await fixture();
    const before = await participationCounts(f.userId);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    await env.DB.prepare(
      `INSERT INTO event_terms
       (id, event_id, audience_type, term_key, version, required, active, created_at)
       VALUES (?, ?, 'attendee', 'sponsor-data-sharing', 'v1', 0, 1, ?)`,
    )
      .bind(crypto.randomUUID(), event.id, nowIso())
      .run();
    const response = await register(
      registrationCreateSchema.parse({
        ...f.body,
        consents: [...f.body.consents, { termKey: "sponsor-data-sharing", version: "v1" }],
      }),
      f.token,
    );
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
    const exported = await buildRegistrationCsv(
      env.DB,
      { id: event.id, source_mode: event.source_mode! },
      { maxRows: 100, maxBytes: 100000 },
    );
    expect(exported.csv).toContain("Selected organization");
    expect(exported.csv).toContain("Selected role");
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
    if (!f.memberId) throw new Error("Member fixture required");
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
    if (!f.memberId) throw new Error("Member fixture required");
    const otherIdentity = await addRepresentative(env.DB, f.memberId, otherUser);
    await expect(
      env.DB.prepare("UPDATE registrations SET registration_identity_id = ? WHERE id = ?")
        .bind(otherIdentity, created.registrationId)
        .run(),
    ).rejects.toThrow("REGISTRATION_IDENTITY_OWNER_MISMATCH");
    expect((await getRegistrationById(env.DB, created.registrationId)).registration_identity_id).toBe(f.identityId);
  });
  it("registers an owned nonmember affiliation without granting membership, roles or capacity exemption", async () => {
    const f = await fixture(false);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const before = await participationCounts(f.userId);
    const authorityBefore = await affiliationAuthorityCounts(f.userId, f.organizationId);
    expect(authorityBefore).toEqual([{ members: 0, capacities: 0, roles: 0 }]);
    expect(await findEligibleMemberById(env.DB, f.userId)).toBeNull();
    await env.DB.prepare(
      `INSERT INTO event_days
      (id, event_id, day_date, in_person_capacity, sort_order, created_at, updated_at)
      VALUES (?, ?, '2026-12-01', 1, 0, ?, ?)`,
    )
      .bind(crypto.randomUUID(), event.id, nowIso(), nowIso())
      .run();
    const holderId = await insertUser(env.DB);
    const holder = await createRegistration(env.DB, {
      event,
      userId: holderId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      verifiedIdentity: { userId: holderId },
    });
    expect(holder.registration.status).toBe("registered");
    const response = await register(
      registrationCreateSchema.parse({
        ...f.body,
        attendanceType: "in_person",
        dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      }),
      f.token,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const result = registrationSubmissionResponseSchema.parse(await response.json());
    expect(result.status).toBe("registered");
    expect(result.dayWaitlist).toEqual([expect.objectContaining({ status: "waiting", priorityLane: "general" })]);
    expect(await getRegistrationById(env.DB, result.registrationId)).toMatchObject({
      registration_identity_id: f.identityId,
      registration_organization_name: "Selected organization",
      registration_job_title: "Selected role",
      registration_group_id: null,
    });
    await env.DB.prepare("UPDATE identities SET job_title = 'Later role' WHERE id = ?").bind(f.identityId).run();
    const managed = registrationManageReadResponseSchema.parse(
      await (await callApi(env, await managePath(result.registrationId))).json(),
    );
    expect(managed.user).toMatchObject({ organization_name: "Selected organization", job_title: "Selected role" });
    expect(await affiliationAuthorityCounts(f.userId, f.organizationId)).toEqual(authorityBefore);
    expect(await participationCounts(f.userId)).toEqual(before);
    expect(await findEligibleMemberById(env.DB, f.userId)).toBeNull();
    expect(await queryAll(env.DB, "SELECT organization_name, job_title FROM users WHERE id = ?", [f.userId])).toEqual([
      { organization_name: "Account organization", job_title: "Account role" },
    ]);
  });

  it.each(["optional", "required", "invitation_only", "invite_only", "automatic", "no_registration"])(
    "does not turn a nonmember representation into access to a %s event",
    async (policy) => {
      const f = await fixture(false);
      await env.DB.prepare("UPDATE events SET registration_mode = ? WHERE slug = 'pqc-2026'").bind(policy).run();
      const response = await register(f.body, f.token);
      expect(response.status, await response.clone().text()).toBe(403);
      expect(await response.json()).toMatchObject({
        error: {
          code: ["automatic", "no_registration"].includes(policy)
            ? "EVENT_REGISTRATION_DISABLED"
            : "EVENT_REGISTRATION_ACCESS_REQUIRED",
        },
      });
      await expectNoRegistrationEffects(f.userId);
      expect(await affiliationAuthorityCounts(f.userId, f.organizationId)).toEqual([
        { members: 0, capacities: 0, roles: 0 },
      ]);
    },
  );

  it.each(["pending", "blocked", "ended", "future"] as const)(
    "rejects a %s nonmember affiliation before registration",
    async (state) => {
      const f = await fixture(false);
      const fallback = await buildCreateIdentityStatement(env.DB, {
        userId: f.userId,
        organizationId: await insertOrganization(env.DB, "Other affiliation"),
        source: "staff",
        startImmediately: true,
      });
      await env.DB.batch([fallback.statement]);
      if (state === "blocked") {
        const at = nowIso();
        await env.DB.prepare("UPDATE identities SET ended_at = ?, blocked_at = ? WHERE id = ?")
          .bind(at, at, f.identityId)
          .run();
      } else {
        const update = {
          pending: ["started_at", null],
          ended: ["ended_at", nowIso()],
          future: ["started_at", addHours(nowIso(), 24)],
        }[state];
        await env.DB.prepare(`UPDATE identities SET ${update[0]} = ? WHERE id = ?`).bind(update[1], f.identityId).run();
      }
      const response = await register(f.body, f.token);
      expect(response.status, await response.clone().text()).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "REGISTRATION_IDENTITY_UNAVAILABLE" } });
      await expectNoRegistrationEffects(f.userId);
    },
  );

  it("rejects another person's nonmember affiliation", async () => {
    const f = await fixture(false);
    const other = await buildCreateIdentityStatement(env.DB, {
      userId: await insertUser(env.DB),
      organizationId: f.organizationId,
      source: "staff",
      startImmediately: true,
    });
    await env.DB.batch([other.statement]);
    const response = await register({ ...f.body, identityId: other.identityId }, f.token);
    expect(response.status, await response.clone().text()).toBe(403);
    await expectNoRegistrationEffects(f.userId);
  });

  it.each(["ended", "blocked", "title", "organization", "email", "session", "inactive"])(
    "rolls back a nonmember registration when %s authority changes after preflight",
    async (change) => {
      const f = await fixture(false);
      let changed = false;
      const raced = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("INSERT INTO authorization_guards") && sql.includes("organization.name IS ?"),
        async () => {
          changed = true;
          if (change === "blocked") {
            const at = nowIso();
            await env.DB.prepare("UPDATE identities SET ended_at = ?, blocked_at = ? WHERE id = ?")
              .bind(at, at, f.identityId)
              .run();
          } else if (change === "ended")
            await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), f.identityId).run();
          else if (change === "title")
            await env.DB.prepare("UPDATE identities SET job_title = 'Changed role' WHERE id = ?")
              .bind(f.identityId)
              .run();
          else if (change === "organization")
            await env.DB.prepare("UPDATE organizations SET name = 'Changed organization' WHERE id = ?")
              .bind(f.organizationId)
              .run();
          else if (change === "email")
            await env.DB.prepare("UPDATE users SET normalized_email = 'changed@example.test' WHERE id = ?")
              .bind(f.userId)
              .run();
          else if (change === "session")
            await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").bind(nowIso(), f.userId).run();
          else await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(f.userId).run();
        },
      );
      const response = await register(f.body, f.token, raced);
      expect(response.status, await response.clone().text()).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "EVENT_REGISTRATION_CONTEXT_CHANGED" } });
      expect(changed).toBe(true);
      await expectNoRegistrationEffects(f.userId);
      expect(await affiliationAuthorityCounts(f.userId, f.organizationId)).toEqual([
        { members: 0, capacities: 0, roles: 0 },
      ]);
    },
  );
});
