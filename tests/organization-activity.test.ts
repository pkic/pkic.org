/**
 * The organization account record's activity collections.
 *
 * Each asserts three things the read model exists to guarantee: it is bounded
 * to the organization's ACTIVE identities, it aggregates in D1 rather than in
 * the caller, and its query dialect is the shared one (search, sort, filter,
 * page envelope).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import {
  organizationEventsListResponseSchema,
  organizationGroupsListResponseSchema,
  organizationProposalsListResponseSchema,
} from "../assets/shared/schemas/organization-activity";
import { createAdminSession } from "./helpers/auth";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const PAST_START = "2020-03-01T09:00:00.000Z";
const PAST_END = "2020-03-02T17:00:00.000Z";
const FUTURE_START = "2099-03-01T09:00:00.000Z";
const FUTURE_END = "2099-03-02T17:00:00.000Z";

async function call(path: string, token?: string): Promise<Response> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return app.fetch(
    new Request(`https://app.test${path}`, { headers }),
    env as never,
    { passThroughOnException: () => {}, waitUntil: () => {} } as never,
  );
}

async function grantToken(...permissions: string[]): Promise<string> {
  const userId = await insertUser(env.DB, `activity-reader-${crypto.randomUUID()}@example.test`);
  if (permissions.length > 0) {
    await env.DB.batch(
      permissions.map((permission) =>
        env.DB.prepare(
          `INSERT INTO permission_grants
             (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
           VALUES (?, ?, ?, NULL, NULL, ?, datetime('now'))`,
        ).bind(crypto.randomUUID(), userId, permission, userId),
      ),
    );
  }
  return createAdminSession(env.DB, userId, `organization-activity-${crypto.randomUUID()}`);
}

async function insertGroup(name: string, typeKey = "working_group"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups (id, type_key, name, slug, visibility, eligibility_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'public', 'open', datetime('now'), datetime('now'))`,
  )
    .bind(id, typeKey, name, `${name.toLowerCase().replaceAll(" ", "-")}-${id.slice(0, 6)}`)
    .run();
  return id;
}

async function joinGroup(
  groupId: string,
  who: { userId: string; identityId: string; memberId: string },
  joinedAt: string,
  leftAt: string | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO group_memberships
       (id, group_id, user_id, identity_id, member_id, source, joined_at, left_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'staff', ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), groupId, who.userId, who.identityId, who.memberId, joinedAt, leftAt)
    .run();
}

async function insertEvent(slug: string, name: string, startsAt: string | null, endsAt: string | null) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, registration_mode, invite_limit_attendee,
                         settings_json, created_at, updated_at)
     VALUES (?, ?, ?, 'Europe/Amsterdam', ?, ?, 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
  )
    .bind(id, slug, name, startsAt, endsAt)
    .run();
  return id;
}

async function register(eventId: string, userId: string, status = "registered"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO registrations
       (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'virtual', 'test_fixture', ?, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), eventId, userId, status, crypto.randomUUID())
    .run();
}

async function participate(eventId: string, userId: string, role: string, status = "active"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_participants (id, event_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), eventId, userId, role, status)
    .run();
}

async function propose(
  eventId: string,
  userId: string,
  title: string,
  options: { status?: string; submittedAt?: string; deletedAt?: string | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO session_proposals
       (id, event_id, proposer_user_id, status, proposal_type, title, abstract, manage_link_secret,
        submitted_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'talk', ?, 'An abstract.', ?, ?, datetime('now'), ?)`,
  )
    .bind(
      id,
      eventId,
      userId,
      options.status ?? "submitted",
      title,
      crypto.randomUUID(),
      options.submittedAt ?? "2026-01-01T00:00:00.000Z",
      options.deletedAt ?? null,
    )
    .run();
  return id;
}

/**
 * Ends a representation. The group-membership triggers require an active
 * identity at insert time, so a fixture that wants a departed representative's
 * history seeds the history first and ends the identity afterwards — which is
 * also the order the real lifecycle happens in.
 */
async function endRepresentation(identityId: string): Promise<void> {
  await env.DB.prepare("UPDATE identities SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(identityId)
    .run();
}

/** One organization with three representatives; the third departs mid-test. */
async function seedOrganization() {
  const organizationId = await insertOrganization(env.DB, `Activity Org ${crypto.randomUUID().slice(0, 8)}`);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  const adaUserId = await insertUser(env.DB, `ada-${crypto.randomUUID()}@example.test`);
  const graceUserId = await insertUser(env.DB, `grace-${crypto.randomUUID()}@example.test`);
  const formerUserId = await insertUser(env.DB, `former-${crypto.randomUUID()}@example.test`);
  const adaIdentityId = await addRepresentative(env.DB, memberId, adaUserId);
  const graceIdentityId = await addRepresentative(env.DB, memberId, graceUserId);
  const formerIdentityId = await addRepresentative(env.DB, memberId, formerUserId);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET first_name = 'Ada', last_name = 'Lovelace' WHERE id = ?").bind(adaUserId),
    // Nameless on purpose: the projection must fall back to the address.
    env.DB.prepare("UPDATE users SET first_name = NULL, last_name = NULL WHERE id = ?").bind(graceUserId),
  ]);
  return {
    organizationId,
    memberId,
    ada: { userId: adaUserId, identityId: adaIdentityId, memberId },
    grace: { userId: graceUserId, identityId: graceIdentityId, memberId },
    former: { userId: formerUserId, identityId: formerIdentityId, memberId },
  };
}

describe("organization activity read models", () => {
  beforeEach(resetDb);

  it("takes organizations:read for every collection and refuses a session without it", async () => {
    const { organizationId } = await seedOrganization();
    // Staff, but holding a different permission: the refusal must come from
    // the permission check rather than from failing to authenticate at all.
    const otherStaff = await grantToken("users:read");
    const reader = await grantToken("organizations:read");

    for (const collection of ["groups", "events", "proposals"]) {
      const path = `/api/v1/organizations/${organizationId}/${collection}`;
      expect((await call(path)).status).toBe(401);
      expect((await call(path, otherStaff)).status).toBe(403);
      expect((await call(path, reader)).status).toBe(200);
    }
  });

  it("aggregates group participation over active identities only", async () => {
    const org = await seedOrganization();
    const other = await seedOrganization();
    const reader = await grantToken("organizations:read");

    const cryptography = await insertGroup("Post-Quantum Cryptography");
    const policy = await insertGroup("Policy Committee", "committee");
    const unrelated = await insertGroup("Unrelated Chapter", "chapter");
    await joinGroup(cryptography, org.ada, "2026-01-05T00:00:00.000Z");
    await joinGroup(cryptography, org.grace, "2026-03-09T00:00:00.000Z");
    // A departed representative and a closed capacity are both out of scope.
    await joinGroup(cryptography, org.former, "2025-01-01T00:00:00.000Z");
    await joinGroup(policy, org.ada, "2026-02-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z");
    await joinGroup(unrelated, other.ada, "2026-01-01T00:00:00.000Z");
    await endRepresentation(org.former.identityId);

    const response = await call(`/api/v1/organizations/${org.organizationId}/groups`, reader);
    expect(response.status).toBe(200);
    const body = organizationGroupsListResponseSchema.parse(await response.json());

    expect(body.page.total).toBe(1);
    expect(body.groups).toEqual([
      {
        groupId: cryptography,
        groupSlug: expect.stringContaining("post-quantum-cryptography"),
        groupName: "Post-Quantum Cryptography",
        groupKind: "working_group",
        groupKindLabel: "Working Group",
        representativeCount: 2,
        firstJoinedAt: "2026-01-05T00:00:00.000Z",
        latestJoinedAt: "2026-03-09T00:00:00.000Z",
      },
    ]);
  });

  it("searches, sorts, and pages group participation in D1", async () => {
    const org = await seedOrganization();
    const reader = await grantToken("organizations:read");
    const crypto1 = await insertGroup("Cryptography");
    const policy = await insertGroup("Policy");
    await joinGroup(crypto1, org.ada, "2026-01-01T00:00:00.000Z");
    await joinGroup(crypto1, org.grace, "2026-01-02T00:00:00.000Z");
    await joinGroup(policy, org.ada, "2026-05-01T00:00:00.000Z");

    const base = `/api/v1/organizations/${org.organizationId}/groups`;
    const byName = organizationGroupsListResponseSchema.parse(await (await call(base, reader)).json());
    expect(byName.groups.map((group) => group.groupName)).toEqual(["Cryptography", "Policy"]);

    const byLatest = organizationGroupsListResponseSchema.parse(
      await (await call(`${base}?sort=-latestJoinedAt`, reader)).json(),
    );
    expect(byLatest.groups.map((group) => group.groupName)).toEqual(["Policy", "Cryptography"]);

    const byCount = organizationGroupsListResponseSchema.parse(
      await (await call(`${base}?sort=-representativeCount`, reader)).json(),
    );
    expect(byCount.groups[0].groupName).toBe("Cryptography");

    const searched = organizationGroupsListResponseSchema.parse(await (await call(`${base}?q=poli`, reader)).json());
    expect(searched.page.total).toBe(1);
    expect(searched.groups[0].groupName).toBe("Policy");

    const paged = organizationGroupsListResponseSchema.parse(
      await (await call(`${base}?limit=1&offset=1`, reader)).json(),
    );
    expect(paged.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect(paged.groups[0].groupName).toBe("Policy");

    expect((await call(`${base}?sort=notAColumn`, reader)).status).toBe(400);
  });

  it("unions registrations and participant roles into one event row", async () => {
    const org = await seedOrganization();
    const other = await seedOrganization();
    const reader = await grantToken("organizations:read");

    const summit = await insertEvent("pki-summit-2099", "PKI Summit", FUTURE_START, FUTURE_END);
    const retro = await insertEvent("pki-retro-2020", "PKI Retrospective", PAST_START, PAST_END);
    const invisible = await insertEvent("other-event", "Other Event", FUTURE_START, FUTURE_END);

    await register(summit, org.ada.userId);
    await register(summit, org.grace.userId);
    await participate(summit, org.ada.userId, "speaker");
    await participate(summit, org.grace.userId, "moderator");
    // Neither of these counts: a cancelled registration or an inactive role.
    await register(retro, org.ada.userId, "cancelled");
    await participate(retro, org.ada.userId, "attendee");
    await participate(summit, org.former.userId, "organizer");
    await register(invisible, other.ada.userId);
    await endRepresentation(org.former.identityId);

    const response = await call(`/api/v1/organizations/${org.organizationId}/events`, reader);
    const body = organizationEventsListResponseSchema.parse(await response.json());

    expect(body.page.total).toBe(2);
    // Default sort is the most recent schedule first.
    expect(body.events.map((event) => event.eventSlug)).toEqual(["pki-summit-2099", "pki-retro-2020"]);

    const [summitRow, retroRow] = body.events;
    expect(summitRow).toMatchObject({
      eventName: "PKI Summit",
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
      registrationCount: 2,
      participantRoles: ["speaker", "moderator"],
      upcoming: true,
    });
    expect(retroRow).toMatchObject({
      registrationCount: 0,
      participantRoles: ["attendee"],
      upcoming: false,
    });
  });

  it("narrows events to upcoming or past in D1", async () => {
    const org = await seedOrganization();
    const reader = await grantToken("organizations:read");
    const summit = await insertEvent("future-summit", "Future Summit", FUTURE_START, FUTURE_END);
    const retro = await insertEvent("past-retro", "Past Retro", PAST_START, PAST_END);
    const undated = await insertEvent("undated", "Undated Workshop", null, null);
    for (const eventId of [summit, retro, undated]) await register(eventId, org.ada.userId);

    const base = `/api/v1/organizations/${org.organizationId}/events`;
    const upcoming = organizationEventsListResponseSchema.parse(
      await (await call(`${base}?when=upcoming`, reader)).json(),
    );
    expect(upcoming.events.map((event) => event.eventSlug)).toEqual(["future-summit"]);

    const past = organizationEventsListResponseSchema.parse(await (await call(`${base}?when=past`, reader)).json());
    expect(past.events.map((event) => event.eventSlug)).toEqual(["past-retro"]);

    // An unscheduled event belongs to neither side, and is still in the
    // unfiltered collection rather than being silently dropped.
    const all = organizationEventsListResponseSchema.parse(await (await call(base, reader)).json());
    expect(all.page.total).toBe(3);
    expect(all.events.find((event) => event.eventSlug === "undated")).toMatchObject({
      startsAt: null,
      upcoming: false,
    });

    const byName = organizationEventsListResponseSchema.parse(
      await (await call(`${base}?sort=eventName`, reader)).json(),
    );
    expect(byName.events.map((event) => event.eventName)).toEqual(["Future Summit", "Past Retro", "Undated Workshop"]);
    expect((await call(`${base}?when=someday`, reader)).status).toBe(400);
  });

  it("lists the proposals this organization's representatives submitted, with their proposer", async () => {
    const org = await seedOrganization();
    const other = await seedOrganization();
    const reader = await grantToken("organizations:read");
    const event = await insertEvent("pqc-2027", "PQC Conference", FUTURE_START, FUTURE_END);

    const accepted = await propose(event, org.ada.userId, "Hybrid certificates", {
      status: "accepted",
      submittedAt: "2026-02-01T00:00:00.000Z",
    });
    const withdrawn = await propose(event, org.grace.userId, "Zeroth draft", {
      status: "withdrawn",
      submittedAt: "2026-01-01T00:00:00.000Z",
    });
    await propose(event, org.former.userId, "Departed proposal");
    await propose(event, other.ada.userId, "Another organization");
    await propose(event, org.ada.userId, "Deleted proposal", { deletedAt: "2026-04-01T00:00:00.000Z" });
    await endRepresentation(org.former.identityId);

    const base = `/api/v1/organizations/${org.organizationId}/proposals`;
    const body = organizationProposalsListResponseSchema.parse(await (await call(base, reader)).json());

    expect(body.page.total).toBe(2);
    expect(body.proposals.map((proposal) => proposal.proposalId)).toEqual([accepted, withdrawn]);
    expect(body.proposals[0]).toEqual({
      proposalId: accepted,
      eventSlug: "pqc-2027",
      eventName: "PQC Conference",
      title: "Hybrid certificates",
      proposalType: "talk",
      status: "accepted",
      submittedAt: "2026-02-01T00:00:00.000Z",
      proposerName: "Ada Lovelace",
      proposerEmail: expect.stringContaining("ada-"),
    });
    // A proposer with no name on file is identified by the address that is on file.
    expect(body.proposals[1].proposerName).toBe(body.proposals[1].proposerEmail);

    const active = organizationProposalsListResponseSchema.parse(
      await (await call(`${base}?status=active`, reader)).json(),
    );
    // `active` is the canonical aggregate: everything but the inactive
    // statuses, so the withdrawn one drops out and the accepted one stays.
    expect(active.proposals.map((proposal) => proposal.proposalId)).toEqual([accepted]);

    const exact = organizationProposalsListResponseSchema.parse(
      await (await call(`${base}?status=accepted`, reader)).json(),
    );
    expect(exact.proposals.map((proposal) => proposal.proposalId)).toEqual([accepted]);

    const byTitle = organizationProposalsListResponseSchema.parse(
      await (await call(`${base}?sort=title`, reader)).json(),
    );
    expect(byTitle.proposals.map((proposal) => proposal.title)).toEqual(["Hybrid certificates", "Zeroth draft"]);

    const searched = organizationProposalsListResponseSchema.parse(
      await (await call(`${base}?q=hybrid`, reader)).json(),
    );
    expect(searched.page.total).toBe(1);

    expect((await call(`${base}?status=not-a-status`, reader)).status).toBe(400);
  });
});
