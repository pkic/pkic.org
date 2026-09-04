/**
 * Governance rosters on ordinary groups: dated seats with titles, leadership
 * terms with titles and tenures, and the public directory that renders the
 * Board of Directors, Executive Council, and consortium-chair pages from them.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupDirectoryResponseSchema } from "../assets/shared/schemas/group-directory";
import {
  groupLeadershipListResponseSchema,
  groupMembershipMutationResponseSchema,
  groupMembershipsManagementListResponseSchema,
} from "../assets/shared/schemas/groups";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { activeIdentityIdForMember, ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { createGroup } from "../functions/_lib/services/groups";

const BOARD_SLUG = "board";
const DAY = 24 * 60 * 60 * 1000;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString();
}

async function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return callApi(env as never, path, { ...init, headers });
}

/** Parses a response that must have succeeded, surfacing the API error body when it did not. */
async function okJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${body}`);
  return JSON.parse(body) as unknown;
}

async function seedAdmin(): Promise<{ id: string; token: string }> {
  const id = await insertUser(env.DB, `governance-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { id, token: await createAdminSession(env.DB, id, `governance-admin-${crypto.randomUUID()}`) };
}

async function seedRepresentative(
  name: [string, string],
  organizationName: string,
): Promise<{ userId: string; memberId: string; identityId: string }> {
  const userId = await insertUser(env.DB, `${name[0]}.${name[1]}-${crypto.randomUUID().slice(0, 8)}@example.test`);
  await env.DB.prepare("UPDATE users SET first_name = ?, last_name = ? WHERE id = ?")
    .bind(name[0], name[1], userId)
    .run();
  const organizationId = await insertOrganization(env.DB, organizationName);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Director" });
  return { userId, memberId, identityId };
}

async function boardGroupId(): Promise<string> {
  const [row] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM groups WHERE slug = ?", [BOARD_SLUG]);
  return row.id;
}

describe("governance rosters on groups", () => {
  beforeEach(resetDb);

  it("seeds the Board of Directors and Executive Council as roster-publishing board groups with chair titles", async () => {
    const groups = await queryAll<{ slug: string; type_key: string; public_leadership: number; public_roster: number }>(
      env.DB,
      "SELECT slug, type_key, public_leadership, public_roster FROM groups WHERE slug IN ('board', 'executive-council') ORDER BY slug",
    );
    expect(groups).toEqual([
      { slug: "board", type_key: "board", public_leadership: 1, public_roster: 1 },
      { slug: "executive-council", type_key: "board", public_leadership: 1, public_roster: 1 },
    ]);
    const types = await queryAll<{ key: string; lead_title: string; deputy_lead_title: string }>(
      env.DB,
      "SELECT key, lead_title, deputy_lead_title FROM group_types WHERE key IN ('board', 'task_force', 'working_group') ORDER BY key",
    );
    expect(types).toEqual([
      { key: "board", lead_title: "Chair", deputy_lead_title: "Vice Chair" },
      { key: "task_force", lead_title: "Lead", deputy_lead_title: "Deputy Lead" },
      { key: "working_group", lead_title: "Chair", deputy_lead_title: "Vice Chair" },
    ]);
    const typesResponse = await call(null, "/api/v1/groups/types?limit=50");
    const typesBody = (await typesResponse.json()) as {
      groupTypes: Array<{ key: string; leadershipTitles: { lead: string; deputyLead: string } }>;
    };
    expect(typesBody.groupTypes.find((type) => type.key === "task_force")?.leadershipTitles).toEqual({
      lead: "Lead",
      deputyLead: "Deputy Lead",
    });
  });

  it("records a backdated seat with a title, edits it, and lists current and former seats separately", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const director = await seedRepresentative(["Mads", "Henriksveen"], "Buypass");

    const added = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${director.userId}`, {
      method: "POST",
      body: JSON.stringify({
        capacitySelection: { mode: "all_eligible", confirmed: true },
        title: "Treasurer",
        joinedAt: "2022-06-01T00:00:00.000Z",
      }),
    });
    expect(added.status).toBe(200);
    const mutation = groupMembershipMutationResponseSchema.parse(await added.json());
    expect(mutation.memberships).toMatchObject([
      {
        userId: director.userId,
        memberId: director.memberId,
        title: "Treasurer",
        joinedAt: "2022-06-01T00:00:00.000Z",
      },
    ]);
    const seatId = mutation.memberships[0].id;

    const current = groupMembershipsManagementListResponseSchema.parse(
      await (await call(admin.token, `/api/v1/groups/${groupId}/memberships?active=true&sort=joined_at`)).json(),
    );
    expect(current.memberships.map((seat) => seat.id)).toEqual([seatId]);

    const closed = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${seatId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: null, leftAt: "2025-02-01T00:00:00.000Z" }),
    });
    expect(closed.status).toBe(200);
    expect(groupMembershipMutationResponseSchema.parse(await closed.json())).toMatchObject({
      memberships: [],
      endedMembershipIds: [seatId],
    });

    const former = groupMembershipsManagementListResponseSchema.parse(
      await (await call(admin.token, `/api/v1/groups/${groupId}/memberships?active=false&sort=-left_at`)).json(),
    );
    expect(former.memberships).toMatchObject([
      { id: seatId, title: null, joinedAt: "2022-06-01T00:00:00.000Z", leftAt: "2025-02-01T00:00:00.000Z" },
    ]);

    const invalid = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${seatId}`, {
      method: "PATCH",
      body: JSON.stringify({ leftAt: "2021-01-01T00:00:00.000Z" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "GROUP_MEMBERSHIP_INTERVAL_INVALID" } });

    const reopened = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${seatId}`, {
      method: "PATCH",
      body: JSON.stringify({ leftAt: null }),
    });
    expect(reopened.status).toBe(200);
    expect(groupMembershipMutationResponseSchema.parse(await reopened.json()).memberships).toMatchObject([
      { id: seatId, leftAt: null },
    ]);
  });

  it("records a former seat for a person whose representation has already ended", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const past = await seedRepresentative(["Kirk", "Hall"], "Entrust");
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), past.identityId)
      .run();

    const liveJoin = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${past.userId}`, {
      method: "POST",
      body: JSON.stringify({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
    });
    expect(liveJoin.status).toBe(403);

    const recorded = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${past.userId}`, {
      method: "POST",
      body: JSON.stringify({
        capacitySelection: { mode: "all_eligible", confirmed: true },
        title: "Board Chair",
        joinedAt: "2022-06-01T00:00:00.000Z",
        leftAt: "2025-02-01T00:00:00.000Z",
      }),
    });
    expect(recorded.status).toBe(200);
    const seats = await queryAll<{ member_id: string; title: string; left_at: string }>(
      env.DB,
      "SELECT member_id, title, left_at FROM group_memberships WHERE group_id = ? AND user_id = ?",
      [groupId, past.userId],
    );
    expect(seats).toEqual([{ member_id: past.memberId, title: "Board Chair", left_at: "2025-02-01T00:00:00.000Z" }]);
    const audit = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE scope_type = 'group' AND scope_id = ? AND action = 'group_former_membership_recorded'",
      [groupId],
    );
    expect(audit).toHaveLength(1);
  });

  it("assigns titled leadership terms, defaults the title from the group type, and keeps closed terms as history", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const chair = await seedRepresentative(["Chris", "Bailey"], "Entrust");
    const formerChair = await seedRepresentative(["Kirk", "Hall"], "Former Entrust");
    await ensureGroupMembershipCapacity(env.DB, groupId, chair.userId);
    await ensureGroupMembershipCapacity(env.DB, groupId, formerChair.userId);

    const assigned = await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: chair.userId,
        identityId: await activeIdentityIdForMember(env.DB, chair.userId, chair.memberId),
        roleId: "role-group_lead",
        startsAt: "2025-03-01T00:00:00.000Z",
      }),
    });
    expect(assigned.status).toBe(201);
    const afterAssign = groupLeadershipListResponseSchema.parse(await assigned.json());
    expect(afterAssign.titles).toEqual({ lead: "Chair", deputyLead: "Vice Chair" });
    expect(afterAssign.assignments).toMatchObject([
      { userId: chair.userId, title: "Chair", startsAt: "2025-03-01T00:00:00.000Z", endsAt: null, active: true },
    ]);
    expect(afterAssign.past).toEqual([]);

    const history = await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: formerChair.userId,
        identityId: await activeIdentityIdForMember(env.DB, formerChair.userId, formerChair.memberId),
        roleId: "role-group_lead",
        title: "Board Chair",
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
      }),
    });
    expect(history.status).toBe(201);
    const afterHistory = groupLeadershipListResponseSchema.parse(await history.json());
    expect(afterHistory.assignments.map((assignment) => assignment.userId)).toEqual([chair.userId]);
    expect(afterHistory.past).toMatchObject([
      {
        userId: formerChair.userId,
        title: "Board Chair",
        active: false,
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
      },
    ]);
    // A closed historical term grants nothing: the row is revoked on insert.
    const revoked = await queryAll<{ revoked_at: string | null; expires_at: string | null }>(
      env.DB,
      "SELECT revoked_at, expires_at FROM user_roles WHERE user_id = ? AND context_id = ?",
      [formerChair.userId, groupId],
    );
    expect(revoked).toEqual([{ revoked_at: "2025-02-01T00:00:00.000Z", expires_at: null }]);
  });

  it("edits a term: a future end schedules expiry, a past end closes it, and null reopens it", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const chair = await seedRepresentative(["Chris", "Bailey"], "Entrust");
    await ensureGroupMembershipCapacity(env.DB, groupId, chair.userId);
    const assigned = groupLeadershipListResponseSchema.parse(
      await (
        await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
          method: "POST",
          body: JSON.stringify({
            userId: chair.userId,
            identityId: await activeIdentityIdForMember(env.DB, chair.userId, chair.memberId),
            roleId: "role-group_deputy_lead",
            startsAt: isoDaysFromNow(-10),
          }),
        })
      ).json(),
    );
    const assignment = assigned.assignments[0];
    expect(assignment.title).toBe("Vice Chair");
    const path = `/api/v1/groups/${groupId}/leadership/${assignment.userRoleId}`;

    const scheduled = isoDaysFromNow(30);
    const withExpiry = groupLeadershipListResponseSchema.parse(
      await (
        await call(admin.token, path, {
          method: "PATCH",
          body: JSON.stringify({ title: "Co-Chair", endsAt: scheduled }),
        })
      ).json(),
    );
    expect(withExpiry.assignments).toMatchObject([{ title: "Co-Chair", active: true, endsAt: scheduled }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM user_roles WHERE id = ? AND expires_at = ? AND revoked_at IS NULL", [
        assignment.userRoleId,
        scheduled,
      ]),
    ).toHaveLength(1);

    const closedAt = isoDaysFromNow(-1);
    const closed = groupLeadershipListResponseSchema.parse(
      await okJson(await call(admin.token, path, { method: "PATCH", body: JSON.stringify({ endsAt: closedAt }) })),
    );
    expect(closed.assignments).toEqual([]);
    expect(closed.past).toMatchObject([{ userRoleId: assignment.userRoleId, active: false, endsAt: closedAt }]);

    const reopened = groupLeadershipListResponseSchema.parse(
      await okJson(await call(admin.token, path, { method: "PATCH", body: JSON.stringify({ endsAt: null }) })),
    );
    expect(reopened.assignments).toMatchObject([{ userRoleId: assignment.userRoleId, active: true, endsAt: null }]);

    const backwards = await call(admin.token, path, {
      method: "PATCH",
      body: JSON.stringify({ startsAt: "2030-01-01T00:00:00.000Z", endsAt: "2029-01-01T00:00:00.000Z" }),
    });
    expect(backwards.status).toBe(400);
    expect(
      (
        await call(admin.token, `/api/v1/groups/${groupId}/leadership/${crypto.randomUUID()}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "Nobody" }),
        })
      ).status,
    ).toBe(404);
  });

  it("cannot reopen a term whose seat has ended", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const chair = await seedRepresentative(["Chris", "Bailey"], "Entrust");
    await ensureGroupMembershipCapacity(env.DB, groupId, chair.userId);
    const assigned = groupLeadershipListResponseSchema.parse(
      await (
        await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
          method: "POST",
          body: JSON.stringify({
            userId: chair.userId,
            identityId: await activeIdentityIdForMember(env.DB, chair.userId, chair.memberId),
            roleId: "role-group_lead",
          }),
        })
      ).json(),
    );
    const [seat] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL",
      [groupId, chair.userId],
    );
    const ended = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${seat.id}`, {
      method: "PATCH",
      body: JSON.stringify({ leftAt: new Date().toISOString() }),
    });
    expect(ended.status).toBe(200);
    const leadership = groupLeadershipListResponseSchema.parse(
      await (await call(admin.token, `/api/v1/groups/${groupId}/leadership`)).json(),
    );
    expect(leadership.assignments).toEqual([]);
    expect(leadership.past).toMatchObject([{ userRoleId: assigned.assignments[0].userRoleId, active: false }]);

    const reopen = await call(
      admin.token,
      `/api/v1/groups/${groupId}/leadership/${assigned.assignments[0].userRoleId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ endsAt: null }),
      },
    );
    expect(reopen.status).toBe(409);
    expect(await reopen.json()).toMatchObject({ error: { code: "GROUP_LEADER_CAPACITY_INVALID" } });
  });

  it("publishes the dated roster and leadership history through the public directory, and hides the roster when unpublished", async () => {
    const admin = await seedAdmin();
    const group = await createGroup(
      env.DB,
      { identityType: "user", id: admin.id, email: "", role: "admin" },
      {
        typeKey: "board",
        name: "Public Directory Board",
        slug: "public-directory-board",
        visibility: "public",
        publicLeadership: true,
        publicRoster: true,
      },
    );
    const groupId = group.id;
    const chair = await seedRepresentative(["Chris", "Bailey"], "Entrust");
    const member = await seedRepresentative(["Mads", "Henriksveen"], "Buypass");
    const former = await seedRepresentative(["Kirk", "Hall"], "Former Entrust");
    await ensureGroupMembershipCapacity(env.DB, groupId, chair.userId);
    await call(admin.token, `/api/v1/groups/${groupId}/memberships/${member.userId}`, {
      method: "POST",
      body: JSON.stringify({
        capacitySelection: { mode: "all_eligible", confirmed: true },
        joinedAt: "2022-06-01T00:00:00.000Z",
      }),
    });
    await call(admin.token, `/api/v1/groups/${groupId}/memberships/${former.userId}`, {
      method: "POST",
      body: JSON.stringify({
        capacitySelection: { mode: "all_eligible", confirmed: true },
        joinedAt: "2022-06-01T00:00:00.000Z",
        leftAt: "2025-02-01T00:00:00.000Z",
      }),
    });
    await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: chair.userId,
        identityId: await activeIdentityIdForMember(env.DB, chair.userId, chair.memberId),
        roleId: "role-group_lead",
        startsAt: "2025-03-01T00:00:00.000Z",
      }),
    });
    await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: former.userId,
        identityId: await activeIdentityIdForMember(env.DB, former.userId, former.memberId),
        roleId: "role-group_lead",
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
      }),
    });

    const response = await call(null, "/api/v1/groups/public-directory-board/directory");
    expect(response.status).toBe(200);
    const directory = groupDirectoryResponseSchema.parse(await response.json());
    expect(directory.leadership).toMatchObject([
      {
        roleId: "role-group_lead",
        title: "Chair",
        startsAt: "2025-03-01T00:00:00.000Z",
        endsAt: null,
        person: { name: "Chris Bailey", organizationName: "Entrust", jobTitle: "Director" },
      },
    ]);
    expect(directory.pastLeadership).toMatchObject([
      {
        title: "Chair",
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
        person: { name: "Kirk Hall", organizationName: "Former Entrust" },
      },
    ]);
    expect(directory.roster?.current.map((seat) => [seat.person.name, seat.title])).toEqual([
      ["Chris Bailey", "Chair"],
      ["Mads Henriksveen", "Member"],
    ]);
    expect(directory.roster?.past).toMatchObject([
      {
        person: { name: "Kirk Hall" },
        title: "Member",
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
      },
    ]);
    const body = JSON.stringify(directory);
    expect(body).not.toContain("@example.test");

    await env.DB.prepare("UPDATE groups SET public_roster = 0 WHERE id = ?").bind(groupId).run();
    const unpublished = groupDirectoryResponseSchema.parse(
      await (await call(null, "/api/v1/groups/public-directory-board/directory")).json(),
    );
    expect(unpublished.roster).toBeNull();
    expect(unpublished.leadership).toHaveLength(1);
  });

  it("serves the consortium chair and vice chair from the All Members group directory", async () => {
    const admin = await seedAdmin();
    const [allMembers] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM groups WHERE slug = 'all-members'");
    // The seeded All Members group survives resetDb, so restore its visibility afterwards.
    await env.DB.prepare("UPDATE groups SET visibility = 'public' WHERE id = ?").bind(allMembers.id).run();
    try {
      const chair = await seedRepresentative(["Paul", "van Brouwershaven"], "Digitorus");
      const viceChair = await seedRepresentative(["Albert", "de Ruiter"], "Logius");
      for (const person of [chair, viceChair])
        await ensureGroupMembershipCapacity(env.DB, allMembers.id, person.userId);
      for (const [person, roleId, startsAt] of [
        [chair, "role-group_lead", "2021-01-01T00:00:00.000Z"],
        [viceChair, "role-group_deputy_lead", "2022-06-01T00:00:00.000Z"],
      ] as const) {
        const response = await call(admin.token, `/api/v1/groups/${allMembers.id}/leadership`, {
          method: "POST",
          body: JSON.stringify({
            userId: person.userId,
            identityId: await activeIdentityIdForMember(env.DB, person.userId, person.memberId),
            roleId,
            startsAt,
          }),
        });
        expect(response.status).toBe(201);
      }

      const directory = groupDirectoryResponseSchema.parse(
        await (await call(null, "/api/v1/groups/all-members/directory")).json(),
      );
      expect(directory.roster).toBeNull();
      expect(
        directory.leadership.map((assignment) => [assignment.person.name, assignment.title, assignment.startsAt]),
      ).toEqual([
        ["Paul van Brouwershaven", "Chair", "2021-01-01T00:00:00.000Z"],
        ["Albert de Ruiter", "Vice Chair", "2022-06-01T00:00:00.000Z"],
      ]);
      expect((await call(null, "/api/v1/leadership/consortium-chairs")).status).toBe(404);
      expect((await call(admin.token, "/api/v1/leadership/positions?body=board")).status).toBe(404);
    } finally {
      await env.DB.prepare("UPDATE groups SET visibility = 'authenticated' WHERE id = ?").bind(allMembers.id).run();
    }
  });
});
