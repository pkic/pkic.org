import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createGroupManagedEvent } from "../functions/_lib/services/events/group-management";
import { createProposal } from "../functions/_lib/services/proposals";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import type { AuthAdmin } from "../functions/_lib/types";
import { eventProposalsResponseSchema } from "../assets/shared/schemas/event-proposals";
import { proposalCommentsListResponseSchema } from "../assets/shared/schemas/proposal-comments";
import { proposalReviewsListResponseSchema } from "../assets/shared/schemas/proposal-reviews";
import {
  cancelAcceptedProposalResponseSchema,
  proposalPatchResponseSchema,
} from "../assets/shared/schemas/proposal-management";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { insertOrgRepresentative, insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

interface Fixture {
  ownerGroupId: string;
  otherGroupId: string;
  eventId: string;
  otherEventId: string;
  proposalId: string;
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
  const path = "/api/v1/groups/" + fixture.ownerGroupId + "/events/" + fixture.eventId + "/proposals" + suffix;
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
});
