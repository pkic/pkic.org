import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { revalidateLiveRoomParticipants } from "../functions/_lib/services/live-session/room-access";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../functions/_lib/errors";
import { callApi } from "./helpers/app";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { resolveUserSessionClaims } from "../functions/_lib/auth/user-session";
import { resolveUserSessionClaimsBatch } from "../functions/_lib/auth/user-session-live-data";
import { verifyUserSessionToken, type UserSessionTokenClaims } from "../functions/_lib/auth/user-session-token";
import type { DatabaseLike } from "../functions/_lib/types";
import { createLiveRoomFixture } from "./helpers/live-session-room";
const f = createLiveRoomFixture();
async function claimsFor(person: keyof typeof f.tokens): Promise<UserSessionTokenClaims> {
  const verified = await verifyUserSessionToken(env.INTERNAL_SIGNING_SECRET!, f.tokens[person]);
  if (!verified.ok) throw new Error("Fixture token failed verification");
  return verified.claims;
}
async function singleton(claims: UserSessionTokenClaims) {
  try {
    return { ok: true as const, session: await resolveUserSessionClaims(env.DB, claims) };
  } catch (error) {
    if (error instanceof AppError) return { ok: false as const, error };
    throw error;
  }
}
function comparable(result: Awaited<ReturnType<typeof singleton>>) {
  return result.ok ? result : { ok: false, code: result.error.code, status: result.error.status };
}
describe("live setwise auth follows the canonical HTTP claims policy", () => {
  beforeEach(() => f.setup());
  it("refreshes an already-recorded month using at most seven read-only database round trips", async () => {
    await env.DB.prepare(
      "UPDATE standing_settings SET activity_started_at='2026-01-01T00:00:00.000Z' WHERE id='default'",
    ).run();
    await callApi(env, "/api/v1/auth/session", { headers: { "x-user-token": f.tokens.operator } });
    const profile = profileD1Flow(env.DB);
    const response = await callApi({ ...env, DB: profile.db }, "/api/v1/auth/session", {
      headers: { "x-user-token": f.tokens.operator },
    });
    expect(response.status).toBe(200);
    userAuthSessionResponseSchema.parse(await response.json());
    const report = await profile.report();
    expect(report.roundTrips).toBeLessThanOrEqual(7);
    expect(report.queries.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(true);
  });
  it("has identical active capacity and grants projections", async () => {
    const claims = await Promise.all([claimsFor("attendee"), claimsFor("speaker"), claimsFor("operator")]);
    const batch = await resolveUserSessionClaimsBatch(env.DB, claims);
    expect(batch.map(comparable)).toEqual((await Promise.all(claims.map(singleton))).map(comparable));
  });
  it.each([
    ["revoked row", "UPDATE sessions SET revoked_at='2000-01-01T00:00:00.000Z' WHERE user_id=?"],
    ["expired row", "UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?"],
    ["inactive human", "UPDATE users SET active=0 WHERE id=?"],
    ["lost staff capacity", "UPDATE user_roles SET revoked_at='2000-01-01T00:00:00.000Z' WHERE user_id=?"],
  ])("matches singleton refusal for %s", async (_case, sql) => {
    const claim = await claimsFor("operator");
    await env.DB.prepare(sql).bind(f.users.operator).run();
    expect((await resolveUserSessionClaimsBatch(env.DB, [claim])).map(comparable)).toEqual([
      comparable(await singleton(claim)),
    ]);
  });
  it("does not deduplicate claim activity or acting identity along with a session row", async () => {
    const fresh = await claimsFor("attendee");
    const old = { ...fresh, lastActivityAt: 0 };
    const claims = [fresh, old, { ...fresh, iid: crypto.randomUUID() }];
    const batch = await resolveUserSessionClaimsBatch(env.DB, claims);
    expect(batch.map(comparable)).toEqual((await Promise.all(claims.map(singleton))).map(comparable));
    expect(batch[0].ok).toBe(true);
    expect(batch[1].ok).toBe(false);
  });
  it("preserves token and elevated staff idle expiry even with another event capacity", async () => {
    const claim = await claimsFor("operator");
    const values = [
      { ...claim, exp: 0 },
      { ...claim, staffLastActivityAt: 0 },
    ];
    expect((await resolveUserSessionClaimsBatch(env.DB, values)).map(comparable)).toEqual(
      (await Promise.all(values.map(singleton))).map(comparable),
    );
  });
  it.each([1, 10, 100, 512, 513])("bounds query count for %i connected claim entries", async (count) => {
    const claim = await claimsFor("attendee");
    let queries = 0;
    const db: DatabaseLike = {
      ...env.DB,
      prepare(sql) {
        queries++;
        return env.DB.prepare(sql);
      },
      batch: env.DB.batch.bind(env.DB),
    };
    const results = await resolveUserSessionClaimsBatch(
      db,
      Array.from({ length: count }, () => ({ ...claim })),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(queries).toBe(6 * Math.ceil(count / 512));
  });
});

describe("setwise selected identity, membership, and verified sponsor email parity", () => {
  beforeEach(() => f.setup());
  async function compare(claims: UserSessionTokenClaims[]) {
    const batch = await resolveUserSessionClaimsBatch(env.DB, claims);
    expect(batch.map(comparable)).toEqual((await Promise.all(claims.map(singleton))).map(comparable));
    return batch;
  }
  it("keeps two choices of the same person's session separate and removes ended identity membership", async () => {
    const identityIds: string[] = [];
    for (const name of ["Alpha org", "Beta org"]) {
      const organization = await insertOrganization(env.DB, name);
      const member = await seedOrganizationAggregate(env.DB, organization);
      identityIds.push(await addRepresentative(env.DB, member, f.users.attendee));
    }
    const fresh = await claimsFor("attendee");
    const claims = [
      { ...fresh, iid: identityIds[0] },
      { ...fresh, iid: identityIds[1] },
      { ...fresh, iid: undefined },
    ];
    const first = await compare(claims);
    expect(first[0].ok && first[0].session.member?.identityId).toBe(identityIds[0]);
    expect(first[1].ok && first[1].session.member?.identityId).toBe(identityIds[1]);
    expect(first[2].ok && first[2].session.member).toBeUndefined();
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?")
      .bind(new Date().toISOString(), identityIds[0])
      .run();
    await compare(claims);
  });
  it("uses the selected identity's proved organization email and reflects inactive membership immediately", async () => {
    const organization = await insertOrganization(env.DB, "Selected email org");
    const member = await seedOrganizationAggregate(env.DB, organization);
    const identity = await addRepresentative(env.DB, member, f.users.attendee);
    const emailId = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,verification_method,created_at) VALUES(?,?,?,?,?,'staff',?)",
    )
      .bind(emailId, f.users.attendee, "work@example.test", "work@example.test", now, now)
      .run();
    await env.DB.prepare("UPDATE identities SET email_id=? WHERE id=?").bind(emailId, identity).run();
    const claim = { ...(await claimsFor("attendee")), iid: identity };
    const [active] = await compare([claim]);
    expect(active.ok && active.session.member?.email).toBe("work@example.test");
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(member).run();
    const [inactive] = await compare([claim]);
    expect(inactive.ok && inactive.session.member).toBeUndefined();
  });
  it.each([true, false])(
    "admits sponsor capacity only through proved alias (verified=%s) and drops lapsed sponsor",
    async (verified) => {
      const now = new Date().toISOString(),
        emailId = crypto.randomUUID(),
        sponsorId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,verification_method,created_at) VALUES(?,?,?,?,?,?,?)",
      )
        .bind(
          emailId,
          f.users.attendee,
          "sponsor-contact@example.test",
          "sponsor-contact@example.test",
          verified ? now : null,
          verified ? "staff" : null,
          now,
        )
        .run();
      await env.DB.prepare(
        "INSERT INTO sponsorships(id,sponsor_type,event_id,tier,contact_email,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'Leader',?,'active',?,?)",
      )
        .bind(sponsorId, f.eventId, "sponsor-contact@example.test", now, now)
        .run();
      const claim = await claimsFor("attendee");
      const [active] = await compare([claim]);
      expect(active.ok && active.session.sponsors.length).toBe(verified ? 1 : 0);
      if (verified) {
        await env.DB.prepare("UPDATE user_emails SET verified_at=NULL WHERE id=?").bind(emailId).run();
        const [unverified] = await compare([claim]);
        expect(unverified.ok && unverified.session.sponsors).toEqual([]);
        await env.DB.prepare("UPDATE user_emails SET verified_at=? WHERE id=?").bind(now, emailId).run();
      }
      await env.DB.prepare("UPDATE sponsorships SET pipeline_stage='lapsed' WHERE id=?").bind(sponsorId).run();
      const [lapsed] = await compare([claim]);
      expect(lapsed.ok && lapsed.session.sponsors).toEqual([]);
    },
  );
  it.each([1, 10, 100, 512, 513])("bounds all recipient eligibility work for %i passive readers", async (count) => {
    const claim = await claimsFor("attendee");
    let queries = 0;
    const db: DatabaseLike = {
      prepare(sql) {
        queries++;
        return env.DB.prepare(sql);
      },
      batch: env.DB.batch.bind(env.DB),
    };
    const participants = Array.from({ length: count }, () => ({
      role: "attendee" as const,
      userId: f.users.attendee,
      name: "Synthetic attendee",
      sessionClaims: { ...claim },
    }));
    const results = await revalidateLiveRoomParticipants(db, participants, f.eventId, f.occurrenceId);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(queries).toBe(1 + 7 * Math.ceil(count / 512));
  });
});

describe("distinct live recipient query bounds", () => {
  beforeEach(() => f.setup());
  it("revalidates 100 distinct users and sessions with six auth and eight total recipient queries", async () => {
    const baseClaim = await claimsFor("attendee");
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
    const people = Array.from({ length: 100 }, (_, index) => ({
      userId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      registrationId: crypto.randomUUID(),
      email: `distinct-${index}@example.test`,
    }));
    const input = JSON.stringify(people);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users(id,email,normalized_email,first_name,active,created_at,updated_at)
        SELECT json_extract(value,'$.userId'),json_extract(value,'$.email'),json_extract(value,'$.email'),'Synthetic',1,?,? FROM json_each(?)`,
      ).bind(now, now, input),
      env.DB.prepare(
        `INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at)
        SELECT json_extract(value,'$.registrationId'),?,json_extract(value,'$.userId'),'registered','in_person','test',json_extract(value,'$.registrationId'),?,? FROM json_each(?)`,
      ).bind(f.eventId, now, now, input),
      env.DB.prepare(
        `INSERT INTO sessions(id,user_id,token_hash,expires_at,revoked_at,created_at)
        SELECT json_extract(value,'$.sessionId'),json_extract(value,'$.userId'),lower(hex(randomblob(32))),?,NULL,? FROM json_each(?)`,
      ).bind(expires, now, input),
    ]);
    const claims = people.map((person) => ({ ...baseClaim, sub: person.userId, sid: person.sessionId }));
    let queries = 0;
    const db: DatabaseLike = {
      prepare(sql) {
        queries++;
        return env.DB.prepare(sql);
      },
      batch: env.DB.batch.bind(env.DB),
    };
    const sessions = await resolveUserSessionClaimsBatch(db, claims);
    expect(queries).toBe(6);
    expect(sessions.every((result) => result.ok)).toBe(true);
    expect(new Set(sessions.flatMap((result) => (result.ok ? [result.session.identity.id] : []))).size).toBe(100);
    queries = 0;
    const participants = claims.map((claim) => ({
      role: "attendee" as const,
      userId: claim.sub,
      name: "Synthetic attendee",
      sessionClaims: claim,
    }));
    const audience = await revalidateLiveRoomParticipants(db, participants, f.eventId, f.occurrenceId);
    expect(queries).toBe(8);
    expect(audience.every((result) => result.ok && result.participant.role === "attendee")).toBe(true);
    expect(new Set(audience.flatMap((result) => (result.ok ? [result.participant.userId] : []))).size).toBe(100);
  });
});
