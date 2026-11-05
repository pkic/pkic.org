import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { registrationCreateSchema, registrationSubmissionResponseSchema } from "../assets/shared/schemas/registration";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import type { DatabaseLike } from "../functions/_lib/types";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { createTestRateLimiter, seedEventAndAdmin } from "./helpers/context";
import { insertOrgRepresentative } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function fixture(delegated = false) {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const create = (name: string) =>
    createGroup(env.DB, admin, {
      typeKey: "working_group",
      name,
      visibility: "authenticated",
      eligibilityMode: "open",
    });
  const owner = await create("Registration owner");
  const group = delegated ? await create("Registration delegate") : owner;
  const email = `group-attendee-${crypto.randomUUID()}@example.test`;
  const member = await insertOrgRepresentative(env.DB, {
    category: "A",
    email,
  });
  await env.DB.prepare("UPDATE users SET first_name='Test', last_name='Attendee' WHERE id=?").bind(member.userId).run();
  await joinGroup(env.DB, group.id, {
    actorUserId: member.userId,
    targetUserId: member.userId,
    selection: { mode: "all_eligible", confirmed: true },
    source: "self_service",
    allowManaged: false,
  });
  await env.DB.prepare("UPDATE events SET owner_group_id=?, registration_mode='required' WHERE id=?")
    .bind(owner.id, eventId)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,'2026-12-01',?,?)",
  )
    .bind(crypto.randomUUID(), eventId, nowIso(), nowIso())
    .run();
  if (delegated)
    await grantResourceToGroup(env.DB, admin, owner.id, "event", eventId, {
      granteeGroupId: group.id,
      capability: "register",
    });
  const token = await createMemberSession(env.DB, member.userId, crypto.randomUUID());
  const body = registrationCreateSchema.parse({
    identityId: member.identityId,
    firstName: "Test",
    lastName: "Attendee",
    email,
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
    consents: [
      { termKey: "privacy-policy", version: "v1" },
      { termKey: "code-of-conduct", version: "v1" },
    ],
  });
  const submit = (payload: unknown = body, authenticated = true, database: DatabaseLike = env.DB) =>
    callApi(
      {
        ...env,
        DB: database,
        EMAIL_RATE_LIMITER: createTestRateLimiter(20),
        IP_RATE_LIMITER: createTestRateLimiter(20),
      },
      "/api/v1/events/pqc-2026/registrations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      },
    );
  return { eventId, groupId: group.id, userId: member.userId, body, submit };
}

beforeEach(resetDb);

describe("group access through the canonical registration route", () => {
  it.each([false, true])("registers a signed-in member using live group access (delegated: %s)", async (delegated) => {
    const f = await fixture(delegated);
    const response = await f.submit();
    expect(response.status, await response.clone().text()).toBe(200);
    const result = registrationSubmissionResponseSchema.parse(await response.json());
    expect(result.status).toBe("registered");
    expect(
      await env.DB.prepare("SELECT user_id, registration_group_id FROM registrations WHERE id=?")
        .bind(result.registrationId)
        .first(),
    ).toEqual({ user_id: f.userId, registration_group_id: f.groupId });
  });

  it("keeps open registration independent of group membership", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE events SET registration_mode='public' WHERE id=?").bind(f.eventId).run();
    const response = await f.submit();
    expect(response.status, await response.clone().text()).toBe(200);
    const result = registrationSubmissionResponseSchema.parse(await response.json());
    expect(
      await env.DB.prepare("SELECT registration_group_id FROM registrations WHERE id=?")
        .bind(result.registrationId)
        .first("registration_group_id"),
    ).toBeNull();
  });

  it.each(["membership", "grant", "group"])("still requires an invitation after losing %s access", async (revoked) => {
    const f = await fixture(true);
    if (revoked === "membership")
      await env.DB.prepare("UPDATE group_memberships SET left_at=? WHERE group_id=? AND user_id=?")
        .bind(nowIso(), f.groupId, f.userId)
        .run();
    if (revoked === "grant")
      await env.DB.prepare("DELETE FROM event_group_grants WHERE event_id=? AND group_id=? AND capability='register'")
        .bind(f.eventId, f.groupId)
        .run();
    if (revoked === "group") await env.DB.prepare("UPDATE groups SET active=0 WHERE id=?").bind(f.groupId).run();
    const response = await f.submit();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "EVENT_REGISTRATION_ACCESS_REQUIRED" },
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM registrations WHERE event_id=?")
        .bind(f.eventId)
        .first("total"),
    ).toBe(0);
  });

  it("rolls back registration and its effects if group access is revoked before commit", async () => {
    const f = await fixture(true);
    const racingDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO registrations"),
      () =>
        env.DB.prepare("DELETE FROM event_group_grants WHERE event_id=? AND group_id=? AND capability='register'")
          .bind(f.eventId, f.groupId)
          .run(),
    );
    const response = await f.submit(f.body, true, racingDb);
    expect(response.status, await response.clone().text()).toBe(409);
    for (const table of ["registrations", "consent_acceptances", "email_outbox"]) {
      expect(
        await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE event_id=?`).bind(f.eventId).first("total"),
      ).toBe(0);
    }
  });

  it("never authorizes an anonymous caller or a client-supplied group ID", async () => {
    const f = await fixture();
    const { identityId: _identityId, ...unselectedBody } = f.body;
    expect((await f.submit(unselectedBody, false)).status).toBe(403);
    expect((await f.submit({ ...f.body, registrationGroupId: f.groupId })).status).toBe(400);
    expect((await f.submit({ ...unselectedBody, email: "other-attendee@example.test" })).status).toBe(403);
  });
});
