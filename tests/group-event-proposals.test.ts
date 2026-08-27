import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createGroupManagedEvent } from "../functions/_lib/services/events/group-management";
import { createProposal, getProposalById } from "../functions/_lib/services/proposals";
import { inviteProposalSpeaker } from "../functions/_lib/services/proposal-speaker-invitations";
import { getEventById } from "../functions/_lib/services/events";
import { preparePermissionsAuthorizationGuard } from "../functions/_lib/auth/permissions";
import { editProposalSpeaker } from "../functions/_lib/services/proposal-speaker-admin";
import { removeProposalSpeakerByManager } from "../functions/_lib/services/proposal-speaker-removal";
import { sendProposalSpeakerReminders } from "../functions/_lib/services/proposal-reminders";
import { removeProposalSpeakerHeadshot } from "../functions/_lib/services/proposal-speaker-headshot";
import { prepareGroupEventProposalContextGuard } from "../functions/_lib/services/proposal-group-context";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import type { AuthAdmin, DatabaseLike } from "../functions/_lib/types";
import { eventProposalsResponseSchema } from "../assets/shared/schemas/event-proposals";
import { proposalCommentsListResponseSchema } from "../assets/shared/schemas/proposal-comments";
import { proposalReviewsListResponseSchema } from "../assets/shared/schemas/proposal-reviews";
import {
  cancelAcceptedProposalResponseSchema,
  finalizeProposalResponseSchema,
  proposalPatchResponseSchema,
  coSpeakerInviteResponseSchema,
} from "../assets/shared/schemas/proposal-management";
import { proposalDecisionPreviewResponseSchema } from "../assets/shared/schemas/proposal-decisions";
import { proposalSpeakersResponseSchema } from "../assets/shared/schemas/proposal-speakers";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import type { AuthScope } from "../functions/_lib/auth/scopes";
import { insertOrgRepresentative, insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";

interface Fixture {
  ownerGroupId: string;
  otherGroupId: string;
  eventId: string;
  otherEventId: string;
  proposalId: string;
  proposerUserId: string;
  reviewerId: string;
  reviewerToken: string;
}

async function user(emailPrefix: string, role = "user"): Promise<{ id: string; email: string }> {
  const email = emailPrefix + "-" + crypto.randomUUID() + "@example.test";
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { id, email };
}

async function grant(userId: string, eventId: string, permission: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at) " +
      "VALUES (?, ?, ?, 'event', ?, ?, datetime('now'))",
  )
    .bind(crypto.randomUUID(), userId, permission, eventId, userId)
    .run();
}

async function setupFixture(): Promise<Fixture> {
  const administrator = await user("proposal-route-administrator", "admin");
  const adminActor: AuthAdmin = { identityType: "user", ...administrator, role: "admin" };
  const owner = await createGroup(env.DB, adminActor, {
    typeKey: "working_group",
    name: "Proposal route owner " + crypto.randomUUID(),
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const other = await createGroup(env.DB, adminActor, {
    typeKey: "working_group",
    name: "Proposal route other " + crypto.randomUUID(),
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const createEvent = (slug: string, name: string, startsAt: string) =>
    createGroupManagedEvent(env.DB, adminActor, owner.id, {
      slug,
      name,
      timezone: "UTC",
      startsAt,
      endsAt: startsAt.replace("09:00", "17:00"),
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      inviteLimitAttendee: 5,
      links: [],
    });
  const event = await createEvent(
    "proposal-route-event-" + crypto.randomUUID(),
    "Proposal route event",
    "2027-01-01T09:00:00.000Z",
  );
  const otherEvent = await createEvent(
    "proposal-route-other-event-" + crypto.randomUUID(),
    "Proposal route other event",
    "2027-02-01T09:00:00.000Z",
  );
  const author = await user("proposal-route-author");
  const { proposal } = await createProposal(env.DB, {
    eventId: event.eventId,
    proposerUserId: author.id,
    proposalType: "talk",
    title: "Route proposal",
    abstract: "A sufficiently detailed proposal abstract for mounted route tests.",
  });
  const reviewer = await user("proposal-route-reviewer");
  for (const permission of [
    "proposals:read",
    "proposals:score",
    "proposals:manage",
    "proposals:edit_accepted_abstract",
    "proposals:cancel_accepted",
  ]) {
    await grant(reviewer.id, event.eventId, permission);
  }
  return {
    ownerGroupId: owner.id,
    otherGroupId: other.id,
    eventId: event.eventId,
    otherEventId: otherEvent.eventId,
    proposalId: proposal.id,
    proposerUserId: author.id,
    reviewerId: reviewer.id,
    reviewerToken: await createAdminSession(env.DB, reviewer.id, "proposal-route-" + crypto.randomUUID()),
  };
}

function route(
  fixture: Fixture,
  suffix = "",
  init: RequestInit = {},
  token = fixture.reviewerToken,
): Promise<Response> {
  return routeAt(fixture, fixture.ownerGroupId, fixture.eventId, suffix, init, token);
}

function routeAt(
  fixture: Fixture,
  groupId: string,
  eventId: string,
  suffix = "",
  init: RequestInit = {},
  token = fixture.reviewerToken,
): Promise<Response> {
  const path = "/api/v1/groups/" + groupId + "/events/" + eventId + "/proposals" + suffix;
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer " + token);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(
    new Request("https://app.test" + path, { ...init, headers }),
    env as any,
    {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any,
  );
}

async function scopedToken(
  fixture: Fixture,
  permissions: readonly string[],
  options: { scopes?: AuthScope[]; scopeRestricted?: boolean } = {},
): Promise<string> {
  const actor = await user("proposal-route-scoped-actor");
  for (const permission of permissions) await grant(actor.id, fixture.eventId, permission);
  return createAdminSession(env.DB, actor.id, "proposal-route-scoped-" + crypto.randomUUID(), undefined, {
    scopes: options.scopes,
    scopeRestricted: options.scopeRestricted,
  });
}

async function addCurrentRoundReviews(fixture: Fixture, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const reviewer = await user(`proposal-route-reviewer-${index}`);
    await env.DB.prepare(
      `INSERT INTO proposal_reviews
         (id, proposal_id, reviewer_user_id, review_round, recommendation, score, reviewer_comment, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'accept', ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), fixture.proposalId, reviewer.id, 8 + index, `Review ${index}`)
      .run();
  }
}

async function addProposalSpeaker(
  fixture: Fixture,
  status: "confirmed" | "declined",
  role: "speaker" | "proposer" = "speaker",
): Promise<string> {
  const speaker = await user(`proposal-route-speaker-${status}`);
  await env.DB.prepare(
    `INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), fixture.proposalId, speaker.id, role, status)
    .run();
  return speaker.id;
}

async function proposalManager(fixture: Fixture): Promise<AuthAdmin> {
  const manager = await user("proposal-route-race-manager");
  await grant(manager.id, fixture.eventId, "proposals:manage");
  return {
    identityType: "user",
    ...manager,
    role: "user",
    grants: [{ permission: "proposals:manage", contextType: "event", contextId: fixture.eventId }],
  };
}

function proposalContextGuard(db: DatabaseLike, fixture: Fixture) {
  return prepareGroupEventProposalContextGuard(db, {
    groupId: fixture.ownerGroupId,
    eventId: fixture.eventId,
    proposalId: fixture.proposalId,
  });
}

function revokeProposalManagement(fixture: Fixture, actor: AuthAdmin): Promise<unknown> {
  return env.DB.prepare(
    `UPDATE permission_grants SET revoked_at = datetime('now')
      WHERE user_id = ? AND permission = 'proposals:manage'
        AND context_type = 'event' AND context_id = ?`,
  )
    .bind(actor.id, fixture.eventId)
    .run();
}

describe("group event proposal routes", () => {
  beforeEach(resetDb);

  it("allows a program-only user to list/open its assigned program and rejects unrelated paths", async () => {
    const fixture = await setupFixture();
    const listResponse = await route(fixture);
    expect(listResponse.status).toBe(200);
    const list = eventProposalsResponseSchema.parse(await listResponse.json());
    expect(list.event.id).toBe(fixture.eventId);
    expect(list.proposals.map((proposal) => proposal.id)).toEqual([fixture.proposalId]);
    const filteredResponse = await route(fixture, "?limit=1&q=Route&sort=-title");
    expect(filteredResponse.status).toBe(200);
    const filtered = eventProposalsResponseSchema.parse(await filteredResponse.json());
    expect(filtered.proposals).toHaveLength(1);
    expect(filtered.page).toMatchObject({ limit: 1, offset: 0, total: 1, hasMore: false });
    const legacyDeletedSelector = eventProposalsResponseSchema.parse(await (await route(fixture, "?deleted=1")).json());
    expect(legacyDeletedSelector.proposals.map((proposal) => proposal.id)).toEqual([fixture.proposalId]);
    expect((await route(fixture, "/" + fixture.proposalId)).status).toBe(200);

    const wrongGroupResponse = await app.fetch(
      new Request(
        "https://app.test/api/v1/groups/" + fixture.otherGroupId + "/events/" + fixture.eventId + "/proposals",
        { headers: { authorization: "Bearer " + fixture.reviewerToken } },
      ),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(wrongGroupResponse.status).toBe(404);

    const wrongEventResponse = await app.fetch(
      new Request(
        "https://app.test/api/v1/groups/" +
          fixture.ownerGroupId +
          "/events/" +
          fixture.otherEventId +
          "/proposals/" +
          fixture.proposalId,
        { headers: { authorization: "Bearer " + fixture.reviewerToken } },
      ),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(wrongEventResponse.status).toBe(404);
  });

  it("mounts the group speaker roster behind the private proposal-score boundary and exact tuple", async () => {
    const fixture = await setupFixture();
    await addProposalSpeaker(fixture, "confirmed");
    const readOnlyToken = await scopedToken(fixture, ["proposals:read"]);
    expect((await route(fixture, "/" + fixture.proposalId + "/speakers", {}, readOnlyToken)).status).toBe(403);

    const response = await route(fixture, "/" + fixture.proposalId + "/speakers");
    expect(response.status).toBe(200);
    expect(proposalSpeakersResponseSchema.parse(await response.json()).speakers).toHaveLength(1);

    expect(
      (await routeAt(fixture, fixture.otherGroupId, fixture.eventId, "/" + fixture.proposalId + "/speakers")).status,
    ).toBe(404);
  });

  it("invites a co-speaker through the exact group proposal boundary with an event-bounded deadline", async () => {
    const fixture = await setupFixture();
    const response = await route(fixture, "/" + fixture.proposalId + "/speakers", {
      method: "POST",
      body: JSON.stringify({
        email: "new-program-speaker@example.test",
        firstName: "New",
        lastName: "Speaker",
        role: "panelist",
        expiresAt: "2027-01-01T12:00:00.000Z",
      }),
    });
    expect(response.status).toBe(200);
    expect(coSpeakerInviteResponseSchema.parse(await response.json())).toEqual({
      success: true,
      email: "new-program-speaker@example.test",
      role: "panelist",
      expiresAt: "2027-01-01T12:00:00.000Z",
      queued: true,
    });
    await expect(
      queryAll<{ invite_expires_at: string; actor_id: string; actor_type: string }>(
        env.DB,
        `SELECT ps.invite_expires_at, al.actor_id, al.actor_type
           FROM proposal_speakers ps
           JOIN users u ON u.id = ps.user_id
           JOIN audit_log al ON al.entity_id = ps.id AND al.action = 'co_speaker_invited'
          WHERE ps.proposal_id = ? AND u.normalized_email = ?`,
        [fixture.proposalId, "new-program-speaker@example.test"],
      ),
    ).resolves.toEqual([
      {
        invite_expires_at: "2027-01-01T12:00:00.000Z",
        actor_id: fixture.reviewerId,
        actor_type: "admin",
      },
    ]);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", ["new-program-speaker@example.test"]),
    ).resolves.toHaveLength(1);

    const scoreOnly = await scopedToken(fixture, ["proposals:score"]);
    expect(
      (
        await route(
          fixture,
          "/" + fixture.proposalId + "/speakers",
          { method: "POST", body: JSON.stringify({ email: "score-only@example.test", role: "speaker" }) },
          scoreOnly,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await routeAt(fixture, fixture.otherGroupId, fixture.eventId, "/" + fixture.proposalId + "/speakers", {
          method: "POST",
          body: JSON.stringify({ email: "wrong-group@example.test", role: "speaker" }),
        })
      ).status,
    ).toBe(404);
  });

  it("defaults co-speaker validity to event start and rejects deadlines beyond the event", async () => {
    const fixture = await setupFixture();
    const defaultResponse = await route(fixture, "/" + fixture.proposalId + "/speakers", {
      method: "POST",
      body: JSON.stringify({ email: "default-expiry@example.test", role: "speaker" }),
    });
    expect(defaultResponse.status).toBe(200);
    expect(coSpeakerInviteResponseSchema.parse(await defaultResponse.json()).expiresAt).toBe(
      "2027-01-01T09:00:00.000Z",
    );

    const invalidResponse = await route(fixture, "/" + fixture.proposalId + "/speakers", {
      method: "POST",
      body: JSON.stringify({
        email: "overlong-expiry@example.test",
        role: "speaker",
        expiresAt: "2027-01-02T00:00:00.000Z",
      }),
    });
    expect(invalidResponse.status).toBe(400);
    await expect(
      queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", ["overlong-expiry@example.test"]),
    ).resolves.toHaveLength(0);
  });

  it("keeps active invitations idempotent and renews an expired invitation with a new generation", async () => {
    const fixture = await setupFixture();
    const email = "renewed-program-speaker@example.test";
    const firstResponse = await route(fixture, "/" + fixture.proposalId + "/speakers", {
      method: "POST",
      body: JSON.stringify({ email, role: "speaker", expiresAt: "2027-01-01T12:00:00.000Z" }),
    });
    expect(firstResponse.status).toBe(200);
    const [firstSpeaker] = await queryAll<{
      id: string;
      invite_expires_at: string;
      invite_generation: number;
      manage_link_secret: string;
    }>(
      env.DB,
      `SELECT ps.id, ps.invite_expires_at, ps.invite_generation, ps.manage_link_secret
       FROM proposal_speakers ps JOIN users u ON u.id = ps.user_id
       WHERE ps.proposal_id = ? AND u.normalized_email = ?`,
      [fixture.proposalId, email],
    );

    const duplicateResponse = await route(fixture, "/" + fixture.proposalId + "/speakers", {
      method: "POST",
      body: JSON.stringify({ email, role: "speaker", expiresAt: "2027-01-01T13:00:00.000Z" }),
    });
    expect(duplicateResponse.status).toBe(200);
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      queued: false,
      expiresAt: "2027-01-01T12:00:00.000Z",
    });

    await env.DB.prepare("UPDATE proposal_speakers SET invite_expires_at = ? WHERE id = ?")
      .bind("2020-01-01T00:00:00.000Z", firstSpeaker.id)
      .run();
    const renewalResponse = await route(fixture, "/" + fixture.proposalId + "/speakers", {
      method: "POST",
      body: JSON.stringify({ email, role: "speaker", expiresAt: "2027-01-01T15:00:00.000Z" }),
    });
    const renewalBody = await renewalResponse.json();
    expect(renewalResponse.status, JSON.stringify(renewalBody)).toBe(200);
    expect(renewalBody).toMatchObject({
      queued: true,
      expiresAt: "2027-01-01T15:00:00.000Z",
    });
    await expect(
      queryAll<{
        invite_expires_at: string;
        invite_generation: number;
        manage_link_secret: string;
      }>(
        env.DB,
        "SELECT invite_expires_at, invite_generation, manage_link_secret FROM proposal_speakers WHERE id = ?",
        [firstSpeaker.id],
      ),
    ).resolves.toEqual([
      {
        invite_expires_at: "2027-01-01T15:00:00.000Z",
        invite_generation: firstSpeaker.invite_generation + 1,
        manage_link_secret: expect.not.stringMatching(firstSpeaker.manage_link_secret),
      },
    ]);
    await expect(
      queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox WHERE recipient_email = ?", [
        email,
      ]),
    ).resolves.toEqual([{ count: 2 }]);
  });

  it("does not resurrect an invitation that is declined after duplicate-invite preflight", async () => {
    const fixture = await setupFixture();
    const email = "concurrently-declined-program-speaker@example.test";
    expect(
      (
        await route(fixture, "/" + fixture.proposalId + "/speakers", {
          method: "POST",
          body: JSON.stringify({ email, role: "speaker" }),
        })
      ).status,
    ).toBe(200);
    const [speaker] = await queryAll<{ id: string; manage_link_secret: string; invite_generation: number }>(
      env.DB,
      `SELECT ps.id, ps.manage_link_secret, ps.invite_generation
         FROM proposal_speakers ps JOIN users u ON u.id = ps.user_id
        WHERE ps.proposal_id = ? AND u.normalized_email = ?`,
      [fixture.proposalId, email],
    );
    const [proposal, event] = await Promise.all([
      getProposalById(env.DB, fixture.proposalId),
      getEventById(env.DB, fixture.eventId),
    ]);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE proposal_speakers SET status = 'declined', declined_at = datetime('now') WHERE id = ?")
        .bind(speaker.id)
        .run(),
    );

    await expect(
      inviteProposalSpeaker(racingDb, {
        proposal,
        event,
        appBaseUrl: "https://app.test",
        email,
        role: "speaker",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CHANGED" });
    await expect(
      queryAll<{ status: string; manage_link_secret: string; invite_generation: number }>(
        env.DB,
        "SELECT status, manage_link_secret, invite_generation FROM proposal_speakers WHERE id = ?",
        [speaker.id],
      ),
    ).resolves.toEqual([
      {
        status: "declined",
        manage_link_secret: speaker.manage_link_secret,
        invite_generation: speaker.invite_generation,
      },
    ]);
    await expect(
      queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox WHERE recipient_email = ?", [
        email,
      ]),
    ).resolves.toEqual([{ count: 1 }]);
  });

  it("does not downgrade a speaker confirmed after expired-renewal preflight", async () => {
    const fixture = await setupFixture();
    const email = "concurrently-confirmed-program-speaker@example.test";
    expect(
      (
        await route(fixture, "/" + fixture.proposalId + "/speakers", {
          method: "POST",
          body: JSON.stringify({ email, role: "speaker" }),
        })
      ).status,
    ).toBe(200);
    const [speaker] = await queryAll<{ id: string; manage_link_secret: string; invite_generation: number }>(
      env.DB,
      `SELECT ps.id, ps.manage_link_secret, ps.invite_generation
         FROM proposal_speakers ps JOIN users u ON u.id = ps.user_id
        WHERE ps.proposal_id = ? AND u.normalized_email = ?`,
      [fixture.proposalId, email],
    );
    await env.DB.prepare("UPDATE proposal_speakers SET invite_expires_at = ? WHERE id = ?")
      .bind("2020-01-01T00:00:00.000Z", speaker.id)
      .run();
    const [proposal, event] = await Promise.all([
      getProposalById(env.DB, fixture.proposalId),
      getEventById(env.DB, fixture.eventId),
    ]);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE proposal_speakers SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?")
        .bind(speaker.id)
        .run(),
    );

    await expect(
      inviteProposalSpeaker(racingDb, {
        proposal,
        event,
        appBaseUrl: "https://app.test",
        email,
        role: "speaker",
        expiresAt: "2027-01-01T15:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CHANGED" });
    await expect(
      queryAll<{
        status: string;
        manage_link_secret: string;
        invite_generation: number;
        invite_expires_at: string;
      }>(
        env.DB,
        `SELECT status, manage_link_secret, invite_generation, invite_expires_at
           FROM proposal_speakers WHERE id = ?`,
        [speaker.id],
      ),
    ).resolves.toEqual([
      {
        status: "confirmed",
        manage_link_secret: speaker.manage_link_secret,
        invite_generation: speaker.invite_generation,
        invite_expires_at: "2020-01-01T00:00:00.000Z",
      },
    ]);
    await expect(
      queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox WHERE recipient_email = ?", [
        email,
      ]),
    ).resolves.toEqual([{ count: 1 }]);
  });

  it("rolls back co-speaker creation when proposal management is revoked after preflight", async () => {
    const fixture = await setupFixture();
    const actor = await proposalManager(fixture);
    const [proposal, event] = await Promise.all([
      getProposalById(env.DB, fixture.proposalId),
      getEventById(env.DB, fixture.eventId),
    ]);
    const racingDb = mutateBeforeNextBatch(env.DB, () => revokeProposalManagement(fixture, actor));
    await expect(
      inviteProposalSpeaker(racingDb, {
        proposal,
        event,
        appBaseUrl: "https://app.test",
        email: "revoked-before-invite@example.test",
        role: "speaker",
        authorization: { contextGuard: proposalContextGuard(racingDb, fixture) },
        permissionGuard: preparePermissionsAuthorizationGuard(racingDb, actor, [
          { permission: "proposals:manage", context: { type: "event", id: fixture.eventId } },
        ]),
        auditActor: { type: "admin", id: actor.id },
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CHANGED" });
    await expect(
      queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", ["revoked-before-invite@example.test"]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", ["revoked-before-invite@example.test"]),
    ).resolves.toHaveLength(0);
  });

  it("rolls back co-speaker creation when the event window changes after preflight", async () => {
    const fixture = await setupFixture();
    const actor = await proposalManager(fixture);
    const [proposal, event] = await Promise.all([
      getProposalById(env.DB, fixture.proposalId),
      getEventById(env.DB, fixture.eventId),
    ]);
    const racingDb = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE events SET starts_at = ?, ends_at = ?, updated_at = datetime('now') WHERE id = ?")
        .bind("2027-01-02T09:00:00.000Z", "2027-01-02T17:00:00.000Z", fixture.eventId)
        .run();
    });
    await expect(
      inviteProposalSpeaker(racingDb, {
        proposal,
        event,
        appBaseUrl: "https://app.test",
        email: "rescheduled-before-invite@example.test",
        role: "speaker",
        authorization: { contextGuard: proposalContextGuard(racingDb, fixture) },
        permissionGuard: preparePermissionsAuthorizationGuard(racingDb, actor, [
          { permission: "proposals:manage", context: { type: "event", id: fixture.eventId } },
        ]),
        auditActor: { type: "admin", id: actor.id },
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CHANGED" });
    await expect(
      queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", ["rescheduled-before-invite@example.test"]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", [
        "rescheduled-before-invite@example.test",
      ]),
    ).resolves.toHaveLength(0);
  });

  it("rolls back a mounted group speaker patch when its audit record fails", async () => {
    const fixture = await setupFixture();
    const speakerId = await addProposalSpeaker(fixture, "confirmed");
    const [before] = await queryAll<{ first_name: string | null }>(
      env.DB,
      "SELECT first_name FROM users WHERE id = ?",
      [speakerId],
    );
    await env.DB.prepare(
      `CREATE TRIGGER reject_group_speaker_patch_audit
         BEFORE INSERT ON audit_log
         WHEN NEW.action = 'speaker_profile_updated'
         BEGIN SELECT RAISE(ABORT, 'reject group speaker patch audit'); END`,
    ).run();

    const response = await route(fixture, "/" + fixture.proposalId + "/speakers/" + speakerId, {
      method: "PATCH",
      body: JSON.stringify({ firstName: "Must not persist" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(queryAll(env.DB, "SELECT first_name FROM users WHERE id = ?", [speakerId])).resolves.toEqual([before]);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'speaker_profile_updated' AND entity_id IS NOT NULL"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back speaker profile and reminder writes when management is revoked after preflight", async () => {
    const fixture = await setupFixture();
    const speakerId = await addProposalSpeaker(fixture, "confirmed");
    const actor = await proposalManager(fixture);
    const before = await queryAll<{ profile_overrides_json: string }>(
      env.DB,
      "SELECT profile_overrides_json FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
      [fixture.proposalId, speakerId],
    );
    const racingEditDb = mutateBeforeNextBatch(env.DB, () => revokeProposalManagement(fixture, actor));

    await expect(
      editProposalSpeaker(
        racingEditDb,
        actor,
        fixture.proposalId,
        speakerId,
        { firstName: "Revoked update" },
        "https://app.test",
        { contextGuard: proposalContextGuard(racingEditDb, fixture) },
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT profile_overrides_json FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        fixture.proposalId,
        speakerId,
      ]),
    ).resolves.toEqual(before);

    const secondActor = await proposalManager(fixture);
    await seedWorkflowEmailTemplates(env.DB, fixture.reviewerId);
    const outboxBefore = await queryAll(env.DB, "SELECT id FROM email_outbox");
    const racingReminderDb = mutateBeforeNextBatch(env.DB, () => revokeProposalManagement(fixture, secondActor));
    await expect(
      sendProposalSpeakerReminders(racingReminderDb, {
        proposalId: fixture.proposalId,
        userId: speakerId,
        kind: "profile",
        actor: secondActor,
        appBaseUrl: "https://app.test",
        authorization: { contextGuard: proposalContextGuard(racingReminderDb, fixture) },
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(queryAll(env.DB, "SELECT id FROM email_outbox")).resolves.toEqual(outboxBefore);

    const thirdActor = await proposalManager(fixture);
    const racingRosterDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("DELETE FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?")
        .bind(fixture.proposalId, speakerId)
        .run(),
    );
    await expect(
      sendProposalSpeakerReminders(racingRosterDb, {
        proposalId: fixture.proposalId,
        userId: speakerId,
        kind: "profile",
        actor: thirdActor,
        appBaseUrl: "https://app.test",
        authorization: { contextGuard: proposalContextGuard(racingRosterDb, fixture) },
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(queryAll(env.DB, "SELECT id FROM email_outbox")).resolves.toEqual(outboxBefore);
  });

  it("rolls back speaker removal and headshot writes when management is revoked after preflight", async () => {
    const fixture = await setupFixture();
    const removedSpeakerId = await addProposalSpeaker(fixture, "confirmed");
    await addProposalSpeaker(fixture, "confirmed");
    const [speaker] = await queryAll<{ id: string; headshot_override_set: number; headshot_r2_key: string | null }>(
      env.DB,
      `SELECT id, headshot_override_set, headshot_r2_key FROM proposal_speakers
        WHERE proposal_id = ? AND user_id = ?`,
      [fixture.proposalId, removedSpeakerId],
    );
    const actor = await proposalManager(fixture);
    const racingRemovalDb = mutateBeforeNextBatch(env.DB, () => revokeProposalManagement(fixture, actor));
    await expect(
      removeProposalSpeakerByManager(racingRemovalDb, {
        actor,
        proposalId: fixture.proposalId,
        userId: removedSpeakerId,
        appBaseUrl: "https://app.test",
        authorization: { contextGuard: proposalContextGuard(racingRemovalDb, fixture) },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        fixture.proposalId,
        removedSpeakerId,
      ]),
    ).resolves.toHaveLength(1);

    const secondActor = await proposalManager(fixture);
    const racingHeadshotDb = mutateBeforeNextBatch(env.DB, () => revokeProposalManagement(fixture, secondActor));
    await expect(
      removeProposalSpeakerHeadshot({
        db: racingHeadshotDb,
        proposalId: fixture.proposalId,
        proposalEventId: fixture.eventId,
        permissionActor: secondActor,
        proposalSpeakerId: speaker.id,
        speakerUserId: removedSpeakerId,
        previousOverrideSet: speaker.headshot_override_set,
        previousOverrideKey: speaker.headshot_r2_key,
        authorization: { contextGuard: proposalContextGuard(racingHeadshotDb, fixture) },
        audit: {
          actorType: "admin",
          actorId: secondActor.id,
          action: "proposal_speaker_headshot_removed_by_manager",
          scope: { type: "proposal", id: fixture.proposalId },
        },
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT headshot_override_set, headshot_r2_key FROM proposal_speakers WHERE id = ?", [
        speaker.id,
      ]),
    ).resolves.toEqual([
      { headshot_override_set: speaker.headshot_override_set, headshot_r2_key: speaker.headshot_r2_key },
    ]);
  });

  it("keeps generic event access and unrelated proposal grants out of the program", async () => {
    const fixture = await setupFixture();
    const genericViewer = await user("proposal-route-generic-viewer");
    await grant(genericViewer.id, fixture.eventId, "events:read");
    const genericToken = await createAdminSession(env.DB, genericViewer.id, "generic-" + crypto.randomUUID());
    const genericResponse = await app.fetch(
      new Request(
        "https://app.test/api/v1/groups/" + fixture.ownerGroupId + "/events/" + fixture.eventId + "/proposals",
        { headers: { authorization: "Bearer " + genericToken } },
      ),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(genericResponse.status).toBe(403);

    const unrelated = await user("proposal-route-unrelated");
    await grant(unrelated.id, fixture.otherEventId, "proposals:read");
    const unrelatedToken = await createAdminSession(env.DB, unrelated.id, "unrelated-" + crypto.randomUUID());
    const unrelatedResponse = await app.fetch(
      new Request(
        "https://app.test/api/v1/groups/" + fixture.ownerGroupId + "/events/" + fixture.eventId + "/proposals",
        { headers: { authorization: "Bearer " + unrelatedToken } },
      ),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(unrelatedResponse.status).toBe(403);
  });

  it("does not treat generic event sharing as proposal-program access", async () => {
    const fixture = await setupFixture();
    const grantee = await insertOrgRepresentative(env.DB, { category: "A" });
    await joinGroup(env.DB, fixture.otherGroupId, {
      actorUserId: grantee.userId,
      targetUserId: grantee.userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    // Give the member an authenticated staff-capable portal session without
    // granting any event permission; event_group_grants are the only sharing
    // inputs under test here.
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, created_at)
       VALUES (?, ?, 'role-event_volunteer', 'event', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), grantee.userId, fixture.eventId)
      .run();
    await env.DB.batch(
      (["view", "register", "manage"] as const).map((capability) =>
        env.DB.prepare(
          "INSERT INTO event_group_grants (event_id, group_id, capability, created_at) VALUES (?, ?, ?, datetime('now'))",
        ).bind(fixture.eventId, fixture.otherGroupId, capability),
      ),
    );
    // A staff-eligible identity is required to obtain this portal session;
    // its unrelated event capability must still not reveal proposals.
    await grant(grantee.userId, fixture.eventId, "events:read");
    const token = await createAdminSession(env.DB, grantee.userId, "generic-event-share-" + crypto.randomUUID());
    expect((await route(fixture, "", {}, token)).status).toBe(403);
  });

  it("uses the shared D1 review list contract and keeps review PATCH owner-bound", async () => {
    const fixture = await setupFixture();
    const createResponse = await route(fixture, "/" + fixture.proposalId + "/reviews", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 9, reviewerComment: "Route review" }),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { review: { id: string } };
    const listResponse = await route(fixture, "/" + fixture.proposalId + "/reviews?limit=1&q=Route&sort=-score");
    expect(listResponse.status).toBe(200);
    const list = proposalReviewsListResponseSchema.parse(await listResponse.json());
    expect(list.reviews).toHaveLength(1);
    expect(list.page).toMatchObject({ limit: 1, offset: 0, total: 1, hasMore: false });

    const otherReviewer = await user("proposal-route-second-reviewer");
    const otherReviewId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO proposal_reviews (id, proposal_id, reviewer_user_id, recommendation, score, created_at, updated_at) " +
        "VALUES (?, ?, ?, 'reject', 2, datetime('now'), datetime('now'))",
    )
      .bind(otherReviewId, fixture.proposalId, otherReviewer.id)
      .run();
    const patchResponse = await route(fixture, "/" + fixture.proposalId + "/reviews/" + otherReviewId, {
      method: "PATCH",
      body: JSON.stringify({ score: 10 }),
    });
    expect(patchResponse.status).toBe(403);
    expect(created.review.id).not.toBe(otherReviewId);
  });

  it("uses the same group/event boundary for comments and proposal edits", async () => {
    const fixture = await setupFixture();
    const commentResponse = await route(fixture, "/" + fixture.proposalId + "/comments", {
      method: "POST",
      body: JSON.stringify({ comment: "A private route comment" }),
    });
    expect(commentResponse.status).toBe(200);
    const commentsResponse = await route(fixture, "/" + fixture.proposalId + "/comments?q=private");
    expect(commentsResponse.status).toBe(200);
    const comments = proposalCommentsListResponseSchema.parse(await commentsResponse.json());
    expect(comments.comments).toHaveLength(1);

    const patchResponse = await route(fixture, "/" + fixture.proposalId, {
      method: "PATCH",
      body: JSON.stringify({ title: "Updated route proposal" }),
    });
    expect(patchResponse.status).toBe(200);
    const patch = proposalPatchResponseSchema.parse(await patchResponse.json());
    expect(patch.proposal.title).toBe("Updated route proposal");
  });

  it("allows an accepted abstract correction only with the dedicated capability", async () => {
    const fixture = await setupFixture();
    await env.DB.batch([
      env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(fixture.proposalId),
      env.DB.prepare(
        "UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ? AND permission = ?",
      ).bind(fixture.reviewerId, "proposals:manage"),
    ]);
    const abstract =
      "This corrected abstract is intentionally long enough to satisfy the canonical proposal abstract minimum length.";
    const abstractResponse = await route(fixture, "/" + fixture.proposalId, {
      method: "PATCH",
      body: JSON.stringify({ abstract }),
    });
    expect(abstractResponse.status).toBe(200);
    const titleResponse = await route(fixture, "/" + fixture.proposalId, {
      method: "PATCH",
      body: JSON.stringify({ title: "Updated accepted title" }),
    });
    expect(titleResponse.status).toBe(403);
    const bothResponse = await route(fixture, "/" + fixture.proposalId, {
      method: "PATCH",
      body: JSON.stringify({ title: "Another accepted title", abstract }),
    });
    expect(bothResponse.status).toBe(403);
  });

  it("cancels accepted proposals only with a comment and preserves decisions while deactivating speakers", async () => {
    const fixture = await setupFixture();
    const speakerIds: string[] = [];
    for (const status of ["confirmed", "invited", "declined"] as const) {
      const speaker = await user("proposal-route-speaker-" + status);
      speakerIds.push(speaker.id);
      await env.DB.prepare(
        "INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, created_at) " +
          "VALUES (?, ?, ?, 'speaker', ?, datetime('now'))",
      )
        .bind(crypto.randomUUID(), fixture.proposalId, speaker.id, status)
        .run();
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(fixture.proposalId),
      env.DB.prepare(
        "INSERT INTO proposal_decisions (id, proposal_id, decided_by_user_id, final_status, decision_note, min_reviews_required, review_count, decided_at) " +
          "VALUES (?, ?, ?, 'accepted', 'Accepted', 1, 1, datetime('now'))",
      ).bind(crypto.randomUUID(), fixture.proposalId, fixture.reviewerId),
    ]);

    const missingComment = await route(fixture, "/" + fixture.proposalId + "/cancel", {
      method: "POST",
      body: JSON.stringify({ comment: "  " }),
    });
    expect(missingComment.status).toBe(400);
    const cancelResponse = await route(fixture, "/" + fixture.proposalId + "/cancel", {
      method: "POST",
      body: JSON.stringify({ comment: "Speaker unavailable" }),
    });
    expect(cancelResponse.status).toBe(200);
    const canceled = cancelAcceptedProposalResponseSchema.parse(await cancelResponse.json());
    expect(canceled).toMatchObject({ proposalId: fixture.proposalId, status: "canceled", notifiedSpeakerCount: 3 });
    await expect(
      queryAll(env.DB, "SELECT final_status FROM proposal_decisions WHERE proposal_id = ?", [fixture.proposalId]),
    ).resolves.toEqual([{ final_status: "accepted" }]);
    await expect(
      queryAll<{ recipient_user_id: string }>(
        env.DB,
        "SELECT recipient_user_id FROM email_outbox WHERE idempotency_key LIKE 'proposal-canceled:%' ORDER BY recipient_user_id",
      ),
    ).resolves.toEqual(speakerIds.sort().map((recipient_user_id) => ({ recipient_user_id })));
    await expect(
      queryAll<{ status: string }>(
        env.DB,
        `SELECT status
           FROM effective_event_participant_roles
          WHERE event_id = ? AND user_id IN (${speakerIds.map(() => "?").join(", ")}) AND role = 'speaker'
        ORDER BY user_id`,
        [fixture.eventId, ...speakerIds],
      ),
    ).resolves.toEqual(speakerIds.map(() => ({ status: "inactive" })));
  });

  it("keeps decision preview/finalize and audit behind their distinct event permissions", async () => {
    const fixture = await setupFixture();
    const readOnlyToken = await scopedToken(fixture, ["proposals:read"]);
    const reviewerToken = await scopedToken(fixture, ["proposals:read", "proposals:score"]);
    const genericToken = await scopedToken(fixture, ["events:read"]);
    const scopeRestrictedToken = await scopedToken(fixture, ["proposals:manage"], {
      scopes: ["proposals:read"],
      scopeRestricted: true,
    });

    expect(
      (
        await route(
          fixture,
          "/" + fixture.proposalId + "/finalize-preview",
          {
            method: "POST",
            body: JSON.stringify({ finalStatus: "accepted" }),
          },
          readOnlyToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await route(
          fixture,
          "/" + fixture.proposalId + "/finalize-preview",
          {
            method: "POST",
            body: JSON.stringify({ finalStatus: "accepted" }),
          },
          reviewerToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await route(
          fixture,
          "/" + fixture.proposalId + "/finalize-preview",
          {
            method: "POST",
            body: JSON.stringify({ finalStatus: "accepted" }),
          },
          scopeRestrictedToken,
        )
      ).status,
    ).toBe(403);
    expect((await route(fixture, "/" + fixture.proposalId + "/audit-log", {}, readOnlyToken)).status).toBe(403);
    expect((await route(fixture, "/" + fixture.proposalId + "/audit-log", {}, reviewerToken)).status).toBe(200);
    expect((await route(fixture, "/" + fixture.proposalId + "/audit-log", {}, genericToken)).status).toBe(403);

    expect(
      (
        await routeAt(
          fixture,
          fixture.otherGroupId,
          fixture.eventId,
          "/" + fixture.proposalId + "/audit-log",
          {},
          fixture.reviewerToken,
        )
      ).status,
    ).toBe(404);
  });

  it("previews and finalizes a group-bound proposal without mutating during preview", async () => {
    const fixture = await setupFixture();
    await addCurrentRoundReviews(fixture, 2);
    await env.DB.prepare(
      `INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, created_at)
       VALUES (?, ?, ?, 'proposer', 'confirmed', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), fixture.proposalId, fixture.proposerUserId)
      .run();
    const confirmedSpeakerId = await addProposalSpeaker(fixture, "confirmed");
    const declinedSpeakerId = await addProposalSpeaker(fixture, "declined");
    await seedWorkflowEmailTemplates(env.DB, fixture.reviewerId);

    const previewResponse = await route(fixture, "/" + fixture.proposalId + "/finalize-preview", {
      method: "POST",
      body: JSON.stringify({ finalStatus: "accepted", presentationDeadline: "2027-03-01T00:00:00.000Z" }),
    });
    expect(previewResponse.status).toBe(200);
    const preview = proposalDecisionPreviewResponseSchema.parse(await previewResponse.json());
    expect(preview.messages.some((message) => message.templateKey === "proposal_decision")).toBe(true);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [fixture.proposalId]),
    ).resolves.toHaveLength(0);

    const finalizeResponse = await route(fixture, "/" + fixture.proposalId + "/finalize", {
      method: "POST",
      body: JSON.stringify({ finalStatus: "accepted", presentationDeadline: "2027-03-01T00:00:00.000Z" }),
    });
    expect(finalizeResponse.status).toBe(200);
    const finalized = finalizeProposalResponseSchema.parse(await finalizeResponse.json());
    expect(finalized).toMatchObject({ reviewCount: 2, minReviewsRequired: 2 });

    await expect(
      queryAll<{ status: string; presentation_deadline: string | null }>(
        env.DB,
        "SELECT status, presentation_deadline FROM session_proposals WHERE id = ?",
        [fixture.proposalId],
      ),
    ).resolves.toEqual([{ status: "accepted", presentation_deadline: "2027-03-01T00:00:00.000Z" }]);
    await expect(
      queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC",
        [fixture.proposalId],
      ),
    ).resolves.toEqual(expect.arrayContaining([{ action: "proposal_decision_recorded" }]));
    const outbox = await queryAll<{ recipient_user_id: string | null; template_key: string }>(
      env.DB,
      "SELECT recipient_user_id, template_key FROM email_outbox WHERE event_id = (SELECT event_id FROM session_proposals WHERE id = ?)",
      [fixture.proposalId],
    );
    expect(outbox).toEqual(
      expect.arrayContaining([{ recipient_user_id: fixture.proposerUserId, template_key: "proposal_decision" }]),
    );
    expect(outbox.some((row) => row.template_key === "speaker_profile_request")).toBe(true);
    expect(
      outbox.some(
        (row) => row.recipient_user_id === confirmedSpeakerId && row.template_key === "speaker_profile_request",
      ),
    ).toBe(true);
    expect(
      outbox.some(
        (row) => row.recipient_user_id === confirmedSpeakerId && row.template_key === "presentation_upload_request",
      ),
    ).toBe(true);
    expect(outbox.some((row) => row.recipient_user_id === declinedSpeakerId)).toBe(false);
  });

  it("renders public proposal and speaker fields literally in decision email previews", async () => {
    const fixture = await setupFixture();
    const maliciousTitle = '[review](https://attacker.invalid/link) <img src="https://attacker.invalid/pixel.gif">';
    await env.DB.batch([
      env.DB.prepare("UPDATE session_proposals SET title = ? WHERE id = ?").bind(maliciousTitle, fixture.proposalId),
      env.DB.prepare("UPDATE users SET first_name = ?, last_name = ? WHERE id = ?").bind(
        "<script>alert(1)</script>",
        "[speaker](https://attacker.invalid/name)",
        fixture.proposerUserId,
      ),
      env.DB.prepare(
        `INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, created_at)
           VALUES (?, ?, ?, 'proposer', 'confirmed', datetime('now'))`,
      ).bind(crypto.randomUUID(), fixture.proposalId, fixture.proposerUserId),
    ]);
    await seedWorkflowEmailTemplates(env.DB, fixture.reviewerId);

    const response = await route(fixture, "/" + fixture.proposalId + "/finalize-preview", {
      method: "POST",
      body: JSON.stringify({ finalStatus: "accepted" }),
    });
    expect(response.status).toBe(200);
    const preview = proposalDecisionPreviewResponseSchema.parse(await response.json());
    const decision = preview.messages.find((message) => message.templateKey === "proposal_decision");
    expect(decision).toBeDefined();
    expect(decision!.text).toContain("attacker.invalid");
    expect(decision!.html).not.toMatch(
      /<(?:a|img|script)\b[^>]*(?:href|src)?=["']?https:\/\/attacker\.invalid|<script\b/i,
    );
  });

  it("enforces needs-work notes and the current-round quorum through the group route", async () => {
    const fixture = await setupFixture();
    const missingNote = await route(fixture, "/" + fixture.proposalId + "/finalize", {
      method: "POST",
      body: JSON.stringify({ finalStatus: "needs-work" }),
    });
    expect(missingNote.status).toBe(400);

    const belowQuorum = await route(fixture, "/" + fixture.proposalId + "/finalize", {
      method: "POST",
      body: JSON.stringify({ finalStatus: "needs-work", decisionNote: "Please revise the examples." }),
    });
    expect(belowQuorum.status).toBe(409);
    await expect(belowQuorum.json()).resolves.toMatchObject({
      error: { code: "PROPOSAL_REVIEW_THRESHOLD_NOT_MET" },
    });

    await addCurrentRoundReviews(fixture, 2);
    const response = await route(fixture, "/" + fixture.proposalId + "/finalize", {
      method: "POST",
      body: JSON.stringify({ finalStatus: "needs-work", decisionNote: "Please revise the examples." }),
    });
    expect(response.status).toBe(200);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [fixture.proposalId]),
    ).resolves.toEqual([{ status: "needs-work" }]);
    await expect(
      queryAll<{ final_status: string; decision_note: string }>(
        env.DB,
        "SELECT final_status, decision_note FROM proposal_decisions WHERE proposal_id = ?",
        [fixture.proposalId],
      ),
    ).resolves.toEqual([{ final_status: "needs-work", decision_note: "Please revise the examples." }]);
  });

  it("rolls back group finalization when the proposal authorization changes before the D1 batch", async () => {
    const fixture = await setupFixture();
    await addCurrentRoundReviews(fixture, 2);
    const actor = await user("proposal-route-racing-actor");
    await grant(actor.id, fixture.eventId, "proposals:manage");
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        "UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ? AND permission = 'proposals:manage'",
      )
        .bind(actor.id)
        .run(),
    );
    const { finalizeProposalWithNotifications } = await import("../functions/_lib/services/proposal-decisions");
    const { prepareGroupEventProposalContextGuard } = await import("../functions/_lib/services/proposal-group-context");
    const context = {
      groupId: fixture.ownerGroupId,
      eventId: fixture.eventId,
      proposalId: fixture.proposalId,
    };
    const authActor: AuthAdmin = {
      identityType: "user",
      id: actor.id,
      email: actor.email,
      role: "user",
      grants: [{ permission: "proposals:manage", contextType: "event", contextId: fixture.eventId }],
    };

    await expect(
      finalizeProposalWithNotifications(
        racingDb,
        {
          proposalId: fixture.proposalId,
          actor: authActor,
          finalStatus: "accepted",
          minReviewsRequired: 2,
        },
        {
          appBaseUrl: "https://app.test",
          resolveSpeakerManageUrl: async () => "https://app.test/speaker",
          resolveProposalManageUrl: async () => "https://app.test/proposal",
        },
        { contextGuard: prepareGroupEventProposalContextGuard(env.DB, context) },
      ),
    ).rejects.toMatchObject({ code: "PROPOSAL_FINALIZATION_AUTHORIZATION_CHANGED" });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [fixture.proposalId]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'proposal_decision_recorded' AND entity_id = ?", [
        fixture.proposalId,
      ]),
    ).resolves.toHaveLength(0);
  });

  it("rejects group finalization when the owning group changes before the D1 batch", async () => {
    const fixture = await setupFixture();
    await addCurrentRoundReviews(fixture, 2);
    const actor = await user("proposal-route-owner-racing-actor");
    await grant(actor.id, fixture.eventId, "proposals:manage");
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE events SET owner_group_id = ? WHERE id = ?")
        .bind(fixture.otherGroupId, fixture.eventId)
        .run(),
    );
    const { finalizeProposalWithNotifications } = await import("../functions/_lib/services/proposal-decisions");
    const { prepareGroupEventProposalContextGuard } = await import("../functions/_lib/services/proposal-group-context");
    const authActor: AuthAdmin = {
      identityType: "user",
      id: actor.id,
      email: actor.email,
      role: "user",
      grants: [{ permission: "proposals:manage", contextType: "event", contextId: fixture.eventId }],
    };

    await expect(
      finalizeProposalWithNotifications(
        racingDb,
        {
          proposalId: fixture.proposalId,
          actor: authActor,
          finalStatus: "accepted",
          minReviewsRequired: 2,
        },
        {
          appBaseUrl: "https://app.test",
          resolveSpeakerManageUrl: async () => "https://app.test/speaker",
          resolveProposalManageUrl: async () => "https://app.test/proposal",
        },
        {
          contextGuard: prepareGroupEventProposalContextGuard(env.DB, {
            groupId: fixture.ownerGroupId,
            eventId: fixture.eventId,
            proposalId: fixture.proposalId,
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "PROPOSAL_FINALIZATION_AUTHORIZATION_CHANGED" });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [fixture.proposalId]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'proposal_decision_recorded' AND entity_id = ?", [
        fixture.proposalId,
      ]),
    ).resolves.toHaveLength(0);
  });

  it("rolls back the group decision, outbox, and audit atomically when audit insertion fails", async () => {
    const fixture = await setupFixture();
    await addCurrentRoundReviews(fixture, 2);
    await env.DB.prepare(
      `CREATE TRIGGER reject_group_proposal_decision_audit
         BEFORE INSERT ON audit_log
         WHEN NEW.action = 'proposal_decision_recorded'
         BEGIN
           SELECT RAISE(ABORT, 'forced group proposal audit failure');
         END`,
    ).run();

    try {
      const response = await route(fixture, "/" + fixture.proposalId + "/finalize", {
        method: "POST",
        body: JSON.stringify({ finalStatus: "accepted" }),
      });
      expect(response.status).toBe(500);
      await expect(
        queryAll<{ status: string; presentation_deadline: string | null }>(
          env.DB,
          "SELECT status, presentation_deadline FROM session_proposals WHERE id = ?",
          [fixture.proposalId],
        ),
      ).resolves.toEqual([{ status: "submitted", presentation_deadline: null }]);
      await expect(
        queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [fixture.proposalId]),
      ).resolves.toHaveLength(0);
      await expect(
        queryAll(env.DB, "SELECT id FROM proposal_decision_history WHERE proposal_id = ?", [fixture.proposalId]),
      ).resolves.toHaveLength(0);
      await expect(
        queryAll(env.DB, "SELECT id FROM email_outbox WHERE event_id = ?", [fixture.eventId]),
      ).resolves.toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER IF EXISTS reject_group_proposal_decision_audit").run();
    }
  });
});
