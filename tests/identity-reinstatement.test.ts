import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identityReinstatementLinkRequestSchema, identityUpdateSchema } from "../assets/shared/schemas/identity";
import { reconcileAutomaticGroupEnrollmentForUser } from "../functions/_lib/services/groups/automatic-enrollment";
import type { Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { createTestRateLimiter, deliveredEmailPayload, queryAll } from "./helpers/context";
import {
  REPRESENTATIVE_ROLE_IDS,
  addRepresentative,
  assignRepresentativeRole,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

let environment: Env;
let sessionCounter = 0;

async function publicationCount(identityId: string) {
  return env.DB.prepare(
    "SELECT COUNT(*) AS count FROM site_publication_requests WHERE resource_type='identity_profile' AND resource_id=?",
  )
    .bind(identityId)
    .first<number>("count");
}

function call(token: string, path: string, method: string, body?: unknown): Promise<Response> {
  return callApi(environment, path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * A person keeps a session through event participation even without an
 * organization identity, as someone registered for an event does.
 */
async function withEventRegistration(userId: string): Promise<void> {
  const at = nowIso();
  const eventId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, visibility, created_at, updated_at)
       VALUES (?, ?, 'Reinstatement Event', 'Europe/Amsterdam', 'public', ?, ?)`,
    ).bind(eventId, `reinstatement-${eventId}`, at, at),
    env.DB.prepare(
      `INSERT INTO registrations (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret,
         created_at, updated_at)
       VALUES (?, ?, ?, 'registered', 'in_person', 'test', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), at, at),
  ]);
}

async function session(userId: string, identityId: string | null = null): Promise<string> {
  sessionCounter += 1;
  return createMemberSession(env.DB, userId, `reinstatement-session-${sessionCounter}`, undefined, identityId);
}

interface Fixture {
  organizationId: string;
  memberId: string;
  contactToken: string;
  userId: string;
  identityId: string;
  /** A seat that ended before the identity did. */
  earlierSeatId: string;
  path: string;
}

/** An organization contact and a representative with group seats and a contact role. */
async function representative(): Promise<Fixture> {
  const organizationId = await insertOrganization(env.DB, "Reinstatement Organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  // The organization's work domain: the owner's emailed path proves an address there.
  await env.DB.prepare(
    "INSERT INTO organization_domain_claims (id, domain, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), "reinstatement.example", organizationId, nowIso(), nowIso())
    .run();
  const contactUserId = await insertUser(env.DB, "contact@reinstatement.example");
  const contactIdentityId = await addRepresentative(env.DB, memberId, contactUserId);
  await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
  const contactToken = await session(contactUserId, contactIdentityId);

  const userId = await insertUser(env.DB, "person@reinstatement.example");
  const identityId = await addRepresentative(env.DB, memberId, userId);
  await env.DB.prepare("UPDATE identities SET invited_at = ?, started_at = ? WHERE id = ?")
    .bind("2025-12-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", identityId)
    .run();
  await reconcileAutomaticGroupEnrollmentForUser(env.DB, userId);
  await assignRepresentativeRole(env.DB, memberId, userId, REPRESENTATIVE_ROLE_IDS.secondaryContact);
  const [automaticSeat] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM group_memberships WHERE identity_id = ? AND left_at IS NULL",
    [identityId],
  );
  expect(automaticSeat).toBeDefined();
  const at = "2026-01-10T00:00:00.000Z";
  const parentGroupId = crypto.randomUUID();
  const subgroupId = crypto.randomUUID();
  const earlierGroupId = crypto.randomUUID();
  const seat = (groupId: string, joinedAt = at, leftAt: string | null = null) =>
    env.DB.prepare(
      `INSERT INTO group_memberships (id, group_id, user_id, identity_id, member_id, source, joined_at, left_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'self_service', ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), groupId, userId, identityId, memberId, joinedAt, leftAt, at, at);
  const group = (id: string, slug: string, parent: string | null) =>
    env.DB.prepare(
      `INSERT INTO groups (id, type_key, parent_group_id, name, slug, visibility, eligibility_mode, created_at, updated_at)
       VALUES (?, 'working_group', ?, ?, ?, 'public', 'open', ?, ?)`,
    ).bind(id, parent, slug, slug, at, at);
  await env.DB.batch([
    group(parentGroupId, "reinstatement-parent", null),
    group(subgroupId, "reinstatement-subgroup", parentGroupId),
    group(earlierGroupId, "reinstatement-earlier", null),
    seat(parentGroupId),
    seat(subgroupId),
    seat(earlierGroupId, "2026-01-15T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, identity_id, member_id, role_id, context_type, context_id,
         single_holder_per_context, created_at)
       VALUES (?, ?, ?, ?, 'role-group_lead', 'group', ?, 0, ?)`,
    ).bind(crypto.randomUUID(), userId, identityId, memberId, subgroupId, at),
  ]);
  const [earlierSeat] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM group_memberships WHERE group_id = ?", [
    earlierGroupId,
  ]);
  const earlierSeatId = earlierSeat!.id;
  return {
    organizationId,
    memberId,
    contactToken,
    userId,
    identityId,
    earlierSeatId,
    path: `/api/v1/organizations/${organizationId}/identities/${identityId}`,
  };
}

function transition(state: "active" | "ended" | "blocked", extra: Record<string, unknown> = {}) {
  return identityUpdateSchema.parse({
    transition: { state, reason: "Recorded by the organization contact", ...extra },
  });
}

async function endBy(fixture: Fixture, endedAt?: string): Promise<void> {
  const response = await call(
    fixture.contactToken,
    fixture.path,
    "PATCH",
    transition("ended", endedAt ? { endedAt } : {}),
  );
  expect(response.status, await response.clone().text()).toBe(200);
}

async function openSeats(identityId: string) {
  return queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM group_memberships WHERE identity_id = ? AND left_at IS NULL ORDER BY id",
    [identityId],
  );
}

async function openRoles(identityId: string) {
  return queryAll<{ role_id: string }>(
    env.DB,
    "SELECT role_id FROM user_roles WHERE identity_id = ? AND revoked_at IS NULL ORDER BY role_id",
    [identityId],
  );
}

async function endedAt(identityId: string) {
  return (
    await queryAll<{ ended_at: string | null }>(env.DB, "SELECT ended_at FROM identities WHERE id = ?", [identityId])
  )[0]!.ended_at;
}

beforeEach(async () => {
  await resetDb();
  environment = { ...env, EMAIL_RATE_LIMITER: createTestRateLimiter(50), IP_RATE_LIMITER: createTestRateLimiter(50) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an organization contact reinstates an ended identity", () => {
  it("removes the end and reopens the seats and roles the end closed, but not earlier ones", async () => {
    const fixture = await representative();
    const seatsBefore = (await openSeats(fixture.identityId)).map((seat) => seat.id);
    await endBy(fixture, "2026-03-01T00:00:00.000Z");
    expect(await openSeats(fixture.identityId)).toEqual([]);
    expect(await openRoles(fixture.identityId)).toEqual([]);

    const response = await call(fixture.contactToken, fixture.path, "PATCH", transition("active"));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ identityId: fixture.identityId, state: "active" });
    expect(await endedAt(fixture.identityId)).toBeNull();
    const reopened = (await openSeats(fixture.identityId)).map((seat) => seat.id);
    expect(reopened).toEqual(expect.arrayContaining(seatsBefore));
    expect(
      await queryAll(env.DB, "SELECT left_at FROM group_memberships WHERE id = ?", [fixture.earlierSeatId]),
    ).toEqual([{ left_at: "2026-02-01T00:00:00.000Z" }]);
    expect(await openRoles(fixture.identityId)).toEqual([
      { role_id: "role-group_lead" },
      { role_id: REPRESENTATIVE_ROLE_IDS.secondaryContact },
    ]);
    expect(await publicationCount(fixture.identityId)).toBe(2);
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE predecessor_identity_id = ?", [fixture.identityId]),
    ).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'organization_identity_reinstated' AND entity_id = ?",
        [fixture.identityId],
      ),
    ).toHaveLength(1);
  });

  it("rolls back a reinstatement's identity, seats and roles when publication fails, then retries", async () => {
    const fixture = await representative();
    await endBy(fixture);
    const end = await endedAt(fixture.identityId);
    await env.DB.prepare(`CREATE TRIGGER fail_reinstatement_publication BEFORE INSERT ON site_publication_requests
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_REINSTATEMENT_PUBLICATION_FAILURE'); END`).run();
    try {
      expect((await call(fixture.contactToken, fixture.path, "PATCH", transition("active"))).status).toBe(500);
      expect(await endedAt(fixture.identityId)).toBe(end);
      expect(await openSeats(fixture.identityId)).toEqual([]);
      expect(await openRoles(fixture.identityId)).toEqual([]);
      expect(await publicationCount(fixture.identityId)).toBe(1);
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM audit_log WHERE action='organization_identity_reinstated' AND entity_id=?",
          [fixture.identityId],
        ),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_reinstatement_publication").run();
    }
    const retried = await call(fixture.contactToken, fixture.path, "PATCH", transition("active"));
    expect(retried.status, await retried.clone().text()).toBe(200);
    expect(await publicationCount(fixture.identityId)).toBe(2);
  });

  it("refuses a blocked identity, a superseded one, and one whose person has another live identity", async () => {
    const blocked = await representative();
    const blockedResponse = await call(blocked.contactToken, blocked.path, "PATCH", transition("blocked"));
    expect(blockedResponse.status).toBe(200);
    const refusedBlocked = await call(blocked.contactToken, blocked.path, "PATCH", transition("active"));
    expect(refusedBlocked.status).toBe(403);
    expect(await refusedBlocked.json()).toMatchObject({ error: { code: "IDENTITY_IMMEDIATE_ACTIVATION_REQUIRED" } });

    await resetDb();
    const superseded = await representative();
    await endBy(superseded);
    const successorId = await addRepresentative(env.DB, superseded.memberId, superseded.userId);
    await env.DB.prepare("UPDATE identities SET predecessor_identity_id = ?, ended_at = started_at WHERE id = ?")
      .bind(superseded.identityId, successorId)
      .run();
    const refusedSuperseded = await call(superseded.contactToken, superseded.path, "PATCH", transition("active"));
    expect(refusedSuperseded.status).toBe(409);
    expect(await refusedSuperseded.json()).toMatchObject({ error: { code: "IDENTITY_SUPERSEDED" } });

    await resetDb();
    const conflicting = await representative();
    await endBy(conflicting);
    const otherId = await addRepresentative(env.DB, conflicting.memberId, conflicting.userId);
    await env.DB.prepare("UPDATE identities SET predecessor_identity_id = NULL WHERE id = ?").bind(otherId).run();
    const refusedConflict = await call(conflicting.contactToken, conflicting.path, "PATCH", transition("active"));
    expect(refusedConflict.status).toBe(409);
    expect(await refusedConflict.json()).toMatchObject({ error: { code: "IDENTITY_CONFLICT" } });
    expect(await endedAt(conflicting.identityId)).not.toBeNull();
  });

  it("refuses a person who does not manage the organization's identities", async () => {
    const fixture = await representative();
    await endBy(fixture);
    const outsider = await insertUser(env.DB, "outsider@reinstatement.example");
    await withEventRegistration(outsider);
    const response = await call(await session(outsider), fixture.path, "PATCH", transition("active"));
    expect(response.status).toBe(403);
    expect(await endedAt(fixture.identityId)).not.toBeNull();
  });
});

describe("the owner reinstates their own ended identity by email", () => {
  const requestPath = (identityId: string) => `/api/v1/users/current/identities/${identityId}/reinstatement`;
  const linkCall = (token: string, path: "preview" | "confirmation", linkToken: string) =>
    call(
      token,
      `/api/v1/users/current/identities/reinstatement/${path}`,
      "POST",
      identityReinstatementLinkRequestSchema.parse({ token: linkToken }),
    );

  async function latestLink(): Promise<{ token: string; recipient: string }> {
    const [outbox] = await queryAll<{ payload_json: string; recipient_email: string }>(
      env.DB,
      `SELECT payload_json, recipient_email FROM email_outbox
        WHERE template_key = 'organization_identity_reinstatement' ORDER BY rowid DESC LIMIT 1`,
    );
    expect(outbox).toBeDefined();
    const payload = await deliveredEmailPayload<{ reinstatementUrl: string }>(
      env.DB,
      environment,
      outbox!.payload_json,
    );
    const url = new URL(payload.reinstatementUrl);
    expect(`${url.pathname}${url.hash.split("?", 1)[0]}`).toBe("/portal/#/users/current");
    const token = new URLSearchParams(url.hash.split("?", 2)[1]).get("reinstatement");
    if (!token) throw new Error("Missing reinstatement capability");
    return { token, recipient: outbox!.recipient_email };
  }

  /** The person's only identity was the ended organization one; an event registration keeps their session. */
  async function endedOwnIdentity() {
    const fixture = await representative();
    await endBy(fixture);
    await withEventRegistration(fixture.userId);
    return { ...fixture, ownerToken: await session(fixture.userId) };
  }

  it("emails the identity's address and reinstates only when the same account confirms the latest link", async () => {
    const fixture = await endedOwnIdentity();
    const requested = await call(fixture.ownerToken, requestPath(fixture.identityId), "POST");
    expect(requested.status, await requested.clone().text()).toBe(202);
    expect(await requested.json()).toMatchObject({ recipientEmail: "person@reinstatement.example" });
    const first = await latestLink();
    expect(first.recipient).toBe("person@reinstatement.example");

    expect((await call(fixture.ownerToken, requestPath(fixture.identityId), "POST")).status).toBe(202);
    const latest = await latestLink();
    expect(latest.token).not.toBe(first.token);

    const preview = await linkCall(fixture.ownerToken, "preview", latest.token);
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(await preview.json()).toMatchObject({
      identityId: fixture.identityId,
      organizationName: "Reinstatement Organization",
      recipientEmail: "person@reinstatement.example",
    });
    expect(await endedAt(fixture.identityId)).not.toBeNull();

    const otherUser = await insertUser(env.DB, "other@reinstatement.example");
    await withEventRegistration(otherUser);
    const wrongAccount = await linkCall(await session(otherUser), "confirmation", latest.token);
    expect(wrongAccount.status).toBe(403);
    expect(await wrongAccount.json()).toMatchObject({ error: { code: "IDENTITY_REINSTATEMENT_OTHER_ACCOUNT" } });

    expect((await linkCall(fixture.ownerToken, "confirmation", first.token)).status).toBe(404);
    expect(await endedAt(fixture.identityId)).not.toBeNull();

    const confirmed = await linkCall(fixture.ownerToken, "confirmation", latest.token);
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    expect(await confirmed.json()).toMatchObject({ identityId: fixture.identityId, state: "active" });
    expect(await endedAt(fixture.identityId)).toBeNull();
    expect((await openSeats(fixture.identityId)).length).toBeGreaterThan(0);
    expect(await openRoles(fixture.identityId)).toHaveLength(2);

    const reused = await linkCall(fixture.ownerToken, "confirmation", latest.token);
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ error: { code: "MAGIC_LINK_USED" } });
    expect(await publicationCount(fixture.identityId)).toBe(2);
  });

  it("refuses an expired link", async () => {
    const fixture = await endedOwnIdentity();
    expect((await call(fixture.ownerToken, requestPath(fixture.identityId), "POST")).status).toBe(202);
    const { token } = await latestLink();
    const later = Date.now() + 25 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    const response = await linkCall(fixture.ownerToken, "confirmation", token);
    expect(response.status).toBe(410);
    expect(await endedAt(fixture.identityId)).not.toBeNull();
  });

  it("sends the link only to an address that still resolves to the organization", async () => {
    const fixture = await endedOwnIdentity();
    const formerIdentity = async () => {
      const response = await call(fixture.ownerToken, `/api/v1/users/${fixture.userId}`, "GET");
      expect(response.status, await response.clone().text()).toBe(200);
      const { user } = (await response.json()) as {
        user: { formerIdentities: Array<{ identityId: string; reinstatable: boolean; selfReinstatable: boolean }> };
      };
      return user.formerIdentities.find((entry) => entry.identityId === fixture.identityId);
    };
    expect(await formerIdentity()).toMatchObject({ reinstatable: true, selfReinstatable: true });

    // A personal mailbox proves nothing about employment, even as the account's own address.
    await env.DB.prepare("UPDATE users SET email = ?, normalized_email = ? WHERE id = ?")
      .bind("person@gmail.com", "person@gmail.com", fixture.userId)
      .run();
    const refused = await call(fixture.ownerToken, requestPath(fixture.identityId), "POST");
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "IDENTITY_REINSTATEMENT_ADDRESS_NOT_ORGANIZATION",
        message: "Ask a contact at the organization to reinstate it, or add your work address first.",
      },
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'organization_identity_reinstatement'"),
    ).toEqual([]);
    expect(await formerIdentity()).toMatchObject({ reinstatable: true, selfReinstatable: false });

    // A verified address at the organization's domain, selected for the identity, gets the link.
    const workEmailId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(workEmailId, fixture.userId, "work@reinstatement.example", "work@reinstatement.example", nowIso(), nowIso())
      .run();
    await env.DB.prepare("UPDATE identities SET email_id = ? WHERE id = ?").bind(workEmailId, fixture.identityId).run();
    expect(await formerIdentity()).toMatchObject({ selfReinstatable: true });
    const requested = await call(fixture.ownerToken, requestPath(fixture.identityId), "POST");
    expect(requested.status, await requested.clone().text()).toBe(202);
    expect((await latestLink()).recipient).toBe("work@reinstatement.example");
  });

  it("refuses to send a link for an identity that is not ended or not the caller's", async () => {
    const fixture = await representative();
    const ownerToken = await session(fixture.userId, fixture.identityId);
    const active = await call(ownerToken, requestPath(fixture.identityId), "POST");
    expect(active.status).toBe(409);
    expect(await active.json()).toMatchObject({ error: { code: "IDENTITY_NOT_ENDED" } });

    await endBy(fixture);
    const otherUser = await insertUser(env.DB, "stranger@reinstatement.example");
    await withEventRegistration(otherUser);
    expect((await call(await session(otherUser), requestPath(fixture.identityId), "POST")).status).toBe(404);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'organization_identity_reinstatement'"),
    ).toEqual([]);
  });
});
