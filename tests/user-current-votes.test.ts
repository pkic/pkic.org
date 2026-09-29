import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { currentUserVotesListResponseSchema, votesListQuerySchema } from "../assets/shared/schemas/votes";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { listVisibleVotesForMember } from "../functions/_lib/services/votes";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { resolveAuthMember } from "./helpers/voting";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function adminActor(): Promise<UserBackedAuthAdmin> {
  const id = await insertUser(env.DB, `current-votes-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { identityType: "user", id, email: "current-votes-admin@example.test", role: "admin" };
}

async function insertVote(
  ownerGroupId: string,
  createdByUserId: string,
  overrides: { title?: string; visibility?: "private" | "public"; opensAt?: string; closesAt?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO votes
       (id, slug, title, vote_type, owner_group_id, electorate_mode, created_by_user_id,
        threshold_type, opens_at, closes_at, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'motion', ?, 'per_member', ?, 'simple_majority',
             ?, ?, ?,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(
      id,
      `current-votes-${crypto.randomUUID()}`,
      overrides.title ?? "A vote",
      ownerGroupId,
      createdByUserId,
      overrides.opensAt ?? "2026-01-01T00:00:00.000Z",
      overrides.closesAt ?? "2027-01-01T00:00:00.000Z",
      overrides.visibility ?? "private",
    )
    .run();
  return id;
}

function getAs(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(resetDb);

describe("GET /api/v1/users/current/votes", () => {
  it("returns only votes visible through the caller's own group memberships, plus public votes", async () => {
    const admin = await adminActor();
    const joinedGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Votes Joined ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });
    const outsideGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Votes Outside ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });

    const userId = await insertUser(env.DB, `current-votes-member-${crypto.randomUUID()}@example.test`);
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Current Votes Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    await joinGroup(env.DB, joinedGroup.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    const token = await createMemberSession(env.DB, userId, `current-votes-${crypto.randomUUID()}`);

    const visibleViaMembership = await insertVote(joinedGroup.id, admin.id, { title: "Reachable through my group" });
    const hiddenPrivate = await insertVote(outsideGroup.id, admin.id, {
      title: "Private in a group I have not joined",
    });
    const visiblePublic = await insertVote(outsideGroup.id, admin.id, {
      title: "Public regardless of membership",
      visibility: "public",
    });
    void hiddenPrivate;

    const response = await getAs(token, "/api/v1/users/current/votes?limit=20&offset=0");
    expect(response.status, await response.clone().text()).toBe(200);
    const page = currentUserVotesListResponseSchema.parse(await response.json());
    const ids = page.votes.map((vote) => vote.id);
    expect(ids).toContain(visibleViaMembership);
    expect(ids).toContain(visiblePublic);
    expect(ids).not.toContain(hiddenPrivate);
    expect(page.page.total).toBe(2);

    // Parity: the route is a thin wrapper over the service, not a second policy.
    const member = await resolveAuthMember(env.DB, userId);
    const direct = await listVisibleVotesForMember(
      env.DB,
      member,
      votesListQuerySchema.parse({ limit: 20, offset: 0 }),
    );
    expect(new Set(direct.votes.map((vote) => vote.id))).toEqual(new Set(ids));
    expect(direct.total).toBe(page.page.total);

    // Pagination is bounded and deterministic.
    const firstPage = currentUserVotesListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/votes?limit=1&offset=0&sort=title")).json(),
    );
    expect(firstPage.votes).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ limit: 1, offset: 0, total: 2, hasMore: true });
    const secondPage = currentUserVotesListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/votes?limit=1&offset=1&sort=title")).json(),
    );
    expect(secondPage.votes).toHaveLength(1);
    expect(secondPage.page).toMatchObject({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect(firstPage.votes[0]!.id).not.toBe(secondPage.votes[0]!.id);
  });

  it("filters by derived status and searches without a stored status column", async () => {
    const admin = await adminActor();
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Votes Status ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });
    const userId = await insertUser(env.DB, `current-votes-status-${crypto.randomUUID()}@example.test`);
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Current Votes Status Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    await joinGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    const token = await createMemberSession(env.DB, userId, `current-votes-status-${crypto.randomUUID()}`);

    const openVote = await insertVote(group.id, admin.id, { title: "Charter amendment ballot" });
    const scheduledVote = await insertVote(group.id, admin.id, {
      title: "Scheduled for later",
      opensAt: "2030-01-01T00:00:00.000Z",
      closesAt: "2031-01-01T00:00:00.000Z",
    });
    const closedVote = await insertVote(group.id, admin.id, {
      title: "Closed long ago",
      opensAt: "2020-01-01T00:00:00.000Z",
      closesAt: "2020-02-01T00:00:00.000Z",
    });

    // Status is derived from the lifecycle facts; the votes table stores no
    // status column, so this exercises the shared SQL derivation.
    const openPage = currentUserVotesListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/votes?status=open")).json(),
    );
    expect(openPage.votes.map((vote) => vote.id)).toEqual([openVote]);
    expect(openPage.votes[0]!.status).toBe("open");

    const multiPage = currentUserVotesListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/votes?status=open,scheduled&sort=title")).json(),
    );
    expect(new Set(multiPage.votes.map((vote) => vote.id))).toEqual(new Set([openVote, scheduledVote]));
    expect(multiPage.votes.map((vote) => vote.id)).not.toContain(closedVote);

    const searchPage = currentUserVotesListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/votes?q=charter")).json(),
    );
    expect(searchPage.votes.map((vote) => vote.id)).toEqual([openVote]);
  });

  it("rejects an unauthenticated caller and a session with no active membership", async () => {
    expect((await callApi(env, "/api/v1/users/current/votes")).status).toBe(401);

    const staffOnlyUserId = await insertUser(env.DB, `current-votes-staff-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(staffOnlyUserId).run();
    const staffToken = await createMemberSession(env.DB, staffOnlyUserId, `current-votes-staff-${crypto.randomUUID()}`);
    expect((await getAs(staffToken, "/api/v1/users/current/votes")).status).toBe(403);
  });
});
