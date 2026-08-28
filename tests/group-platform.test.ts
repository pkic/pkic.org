import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  groupMembershipsListQuerySchema,
  groupCategoryRulesResponseSchema,
  groupJoinSchema,
  groupPortalContextResponseSchema,
  groupsListResponseSchema,
} from "../assets/shared/schemas/groups";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import type { AuthAdmin, Env } from "../functions/_lib/types";
import {
  assignLocalGroupLeadership,
  buildGroupMembershipsPageQuery,
  buildGroupsPageQuery,
  canManageGroup,
  createGroup,
  getVisibleGroup,
  groupManagementAuthorizationEvidence,
  groupManagementCandidateAuthorizationEvidence,
  groupJoinEligibilityEvidence,
  joinGroup,
  leaveGroup,
  listEligibleGroupCapacities,
  listGroups,
  replaceGroupCategoryRules,
  revokeLocalGroupLeadership,
  updateGroup,
} from "../functions/_lib/services/groups";
import { queryAll } from "./helpers/context";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function insertActor(email: string, role = "user"): Promise<AuthAdmin> {
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function grantGroupLeadership(groupId: string, userId: string, roleId = "role-group_lead"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_roles
       (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
     VALUES (?, ?, ?, 'group', ?, 0, datetime('now'))`,
  )
    .bind(id, userId, roleId, groupId)
    .run();
  return id;
}

beforeEach(async () => {
  await resetDb();
});

describe("group visibility", () => {
  it("keeps participant-only groups private while exposing public and authenticated groups at the right boundary", async () => {
    const publicPage = await listGroups(env.DB, { limit: 100, offset: 0 }, { canReadAll: false });
    expect(publicPage.groups.some((group) => group.slug === "pqc" && group.visibility === "public")).toBe(true);
    expect(publicPage.groups.some((group) => group.slug === "all-members")).toBe(false);
    expect(publicPage.groups.some((group) => group.slug === "executive-council")).toBe(false);
    expect((await getVisibleGroup(env.DB, "pqc", { canReadAll: false }))?.slug).toBe("pqc");
    expect(await getVisibleGroup(env.DB, "executive-council", { canReadAll: false })).toBeNull();

    const userId = await insertUser(env.DB, "visibility@example.test");
    const authenticatedPage = await listGroups(env.DB, { limit: 100, offset: 0 }, { canReadAll: false, userId });
    expect(authenticatedPage.groups.some((group) => group.slug === "all-members")).toBe(true);
    expect(authenticatedPage.groups.some((group) => group.slug === "executive-council")).toBe(false);
    expect((await getVisibleGroup(env.DB, "all-members", { canReadAll: false, userId }))?.slug).toBe("all-members");
  });

  it("uses bounded group indexes for canonical group and membership pages", async () => {
    const groupsQuery = buildGroupsPageQuery({
      limit: 25,
      offset: 0,
      typeKey: "working_group",
      active: true,
    });
    const groupsSql = buildOffsetPageSql(groupsQuery);
    const groupPagePlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${groupsSql.pageSql}`)
      .bind(...groupsSql.bindings, groupsQuery.limit, groupsQuery.offset)
      .all<{ detail: string }>();
    const groupCountPlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${groupsSql.countSql}`)
      .bind(...groupsSql.countBindings)
      .all<{ detail: string }>();
    const groupDetails = [...groupPagePlan.results, ...groupCountPlan.results].map((row) => row.detail).join("\n");
    expect(groupDetails).toMatch(/idx_groups_type_active/);
    expect(groupDetails).toMatch(/idx_group_memberships_group_active/);
    expect(groupDetails).toMatch(/idx_groups_parent_active/);

    const membershipsQuery = buildGroupMembershipsPageQuery(
      "10000000-0000-4000-8000-000000000001",
      groupMembershipsListQuerySchema.parse({ active: true, limit: 25 }),
    );
    const membershipsSql = buildOffsetPageSql(membershipsQuery);
    const membershipPagePlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${membershipsSql.pageSql}`)
      .bind(...membershipsSql.bindings, membershipsQuery.limit, membershipsQuery.offset)
      .all<{ detail: string }>();
    const membershipCountPlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${membershipsSql.countSql}`)
      .bind(...membershipsSql.countBindings)
      .all<{ detail: string }>();
    const membershipDetails = [...membershipPagePlan.results, ...membershipCountPlan.results]
      .map((row) => row.detail)
      .join("\n");
    expect(membershipDetails).toMatch(/idx_group_memberships_group_active/);
    expect(membershipDetails).not.toMatch(/SCAN group_memberships\b/);
  });
});

describe("group capacity membership", () => {
  it("joins all represented organizations by default and supports an explicit subset", async () => {
    const admin = await insertActor("group-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Capacity Test Group",
      eligibilityMode: "open",
    });
    const userId = await insertUser(env.DB, "multi-capacity@example.test");
    const memberAId = await seedOrganizationAggregate(env.DB, await insertOrganization(env.DB, "Capacity Org A"), "A");
    const memberBId = await seedOrganizationAggregate(env.DB, await insertOrganization(env.DB, "Capacity Org B"), "B");
    await addRepresentative(env.DB, memberAId, userId);
    await addRepresentative(env.DB, memberBId, userId);

    const joined = await joinGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    expect(new Set(joined.memberships.map((membership) => membership.memberId))).toEqual(
      new Set([memberAId, memberBId]),
    );
    expect(joined.group.id).toBe(group.id);

    await leaveGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all" },
      actorType: "member",
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'group_left' AND entity_id = ?", group.id),
    ).toHaveLength(1);
    const subset = await joinGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "selected", memberIds: [memberBId] },
      source: "self_service",
      allowManaged: false,
    });
    expect(subset.memberships.map((membership) => membership.memberId)).toEqual([memberBId]);
  });

  it("offers only organization IPR capacity while an organization representation is active", async () => {
    const admin = await insertActor("individual-rule-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "IPR Capacity Test Group",
      eligibilityMode: "open",
    });
    const userId = await insertUser(env.DB, "organization-only-capacity@example.test");
    const organizationMemberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "IPR Organization"),
      "A",
    );
    await addRepresentative(env.DB, organizationMemberId, userId);

    const eligible = await listEligibleGroupCapacities(env.DB, group.id, userId, { allowManaged: false });
    expect(eligible.map((capacity) => capacity.memberId)).toEqual([organizationMemberId]);
    expect(eligible.every((capacity) => capacity.memberType === "organization")).toBe(true);
  });

  it("makes concurrent joins state- and audit-idempotent", async () => {
    const admin = await insertActor("concurrent-join-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Concurrent Join Group",
      eligibilityMode: "open",
    });
    const userId = await insertUser(env.DB, "concurrent-join@example.test");
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Concurrent Join Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    const options = {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true } as const,
      source: "self_service" as const,
      allowManaged: false,
    };

    const [firstJoin, secondJoin] = await Promise.all([
      joinGroup(env.DB, group.id, options),
      joinGroup(env.DB, group.id, options),
    ]);
    expect(firstJoin.memberships).toHaveLength(1);
    expect(secondJoin.memberships).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL",
        [group.id, userId],
      ),
    ).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        `SELECT id FROM audit_log
          WHERE action = 'group_joined' AND entity_id = ? AND scope_type = 'group' AND scope_id = ?`,
        [group.id, group.id],
      ),
    ).toHaveLength(1);
  });

  it("rolls back a join when the group becomes inactive before commit", async () => {
    const admin = await insertActor("inactive-race-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Inactive Join Race Group",
      eligibilityMode: "open",
    });
    const userId = await insertUser(env.DB, "inactive-race@example.test");
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Inactive Race Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE groups SET active = 0, updated_at = datetime('now') WHERE id = ?").bind(group.id).run(),
    );

    await expect(
      joinGroup(racingDb, group.id, {
        actorUserId: userId,
        targetUserId: userId,
        selection: { mode: "all_eligible", confirmed: true },
        source: "self_service",
        allowManaged: false,
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_JOIN_CONTEXT_CHANGED" });
    expect(
      await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ?", [group.id, userId]),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'group_joined' AND entity_id = ?", group.id),
    ).toHaveLength(0);
  });

  it("rolls back a staff join when group-management authority is revoked before commit", async () => {
    const admin = await insertActor("managed-join-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Managed Join Authorization Race",
      eligibilityMode: "open",
    });
    const manager = await insertActor("managed-join-lead@example.test");
    const leadershipId = await grantGroupLeadership(group.id, manager.id);
    const userId = await insertUser(env.DB, "managed-join-target@example.test");
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Managed Join Target Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(leadershipId).run(),
    );

    await expect(
      joinGroup(racingDb, group.id, {
        actorUserId: manager.id,
        targetUserId: userId,
        selection: { mode: "all_eligible", confirmed: true },
        source: "staff",
        allowManaged: true,
        managementActor: manager,
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_JOIN_CONTEXT_CHANGED" });
    expect(
      await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ?", [group.id, userId]),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'group_joined' AND entity_id = ?", group.id),
    ).toHaveLength(0);
  });

  it("rolls back a staff removal when group-management authority is revoked before commit", async () => {
    const admin = await insertActor("managed-leave-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Managed Leave Authorization Race",
      eligibilityMode: "open",
    });
    const manager = await insertActor("managed-leave-lead@example.test");
    const leadershipId = await grantGroupLeadership(group.id, manager.id);
    const userId = await insertUser(env.DB, "managed-leave-target@example.test");
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Managed Leave Target Organization"),
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
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(leadershipId).run(),
    );

    await expect(
      leaveGroup(racingDb, group.id, {
        actorUserId: manager.id,
        targetUserId: userId,
        selection: { mode: "all" },
        actorType: "admin",
        managementActor: manager,
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_MANAGEMENT_AUTHORIZATION_CHANGED" });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL",
        [group.id, userId],
      ),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'group_left' AND entity_id = ?", group.id),
    ).toHaveLength(0);
  });

  it("rejects a stale multi-capacity leave without ending the remaining capacity or auditing success", async () => {
    const admin = await insertActor("leave-race-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Leave Race Group",
      eligibilityMode: "open",
    });
    const userId = await insertUser(env.DB, "leave-race@example.test");
    const memberAId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Leave Race Organization A"),
      "A",
    );
    const memberBId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Leave Race Organization B"),
      "B",
    );
    await addRepresentative(env.DB, memberAId, userId);
    await addRepresentative(env.DB, memberBId, userId);
    await joinGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `UPDATE group_memberships
            SET left_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 second'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 second')
          WHERE group_id = ? AND user_id = ? AND member_id = ? AND left_at IS NULL`,
      )
        .bind(group.id, userId, memberAId)
        .run(),
    );

    await expect(
      leaveGroup(racingDb, group.id, {
        actorUserId: userId,
        targetUserId: userId,
        selection: { mode: "all" },
        actorType: "member",
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_MEMBERSHIP_CHANGED" });

    expect(
      await queryAll<{ member_id: string }>(
        env.DB,
        "SELECT member_id FROM group_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL",
        [group.id, userId],
      ),
    ).toEqual([{ member_id: memberBId }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'group_left' AND entity_id = ?", group.id),
    ).toHaveLength(0);
  });

  it("rolls back every selected capacity when a category rule changes before commit", async () => {
    const admin = await insertActor("category-race-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Category Join Race Group",
      eligibilityMode: "category",
    });
    await replaceGroupCategoryRules(env.DB, admin, group.id, {
      rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: false }],
    });
    const userId = await insertUser(env.DB, "category-race@example.test");
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Category Race Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `UPDATE group_membership_category_rules
            SET permits_join = 0, updated_at = datetime('now')
          WHERE group_id = ? AND membership_category_code = 'A'`,
      )
        .bind(group.id)
        .run(),
    );

    await expect(
      joinGroup(racingDb, group.id, {
        actorUserId: userId,
        targetUserId: userId,
        selection: { mode: "all_eligible", confirmed: true },
        source: "self_service",
        allowManaged: false,
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_JOIN_CONTEXT_CHANGED" });
    expect(
      await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ?", [group.id, userId]),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'group_joined' AND entity_id = ?", group.id),
    ).toHaveLength(0);
  });

  it("uses bounded indexes for write-time group-join eligibility", async () => {
    const admin = await insertActor("join-plan-admin@example.test", "admin");
    const parent = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Join Plan Parent",
      eligibilityMode: "open",
    });
    const child = await createGroup(env.DB, admin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Join Plan Child",
      eligibilityMode: "category",
    });
    await replaceGroupCategoryRules(env.DB, admin, child.id, {
      rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: false }],
    });
    const userId = await insertUser(env.DB, "join-plan@example.test");
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Join Plan Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    await joinGroup(env.DB, parent.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    const evidence = groupJoinEligibilityEvidence(child.id, userId, [memberId], { allowManaged: false });
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${evidence.sql}`)
      .bind(...evidence.bindings)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");

    expect(details).toMatch(
      /SEARCH parent_membership USING COVERING INDEX idx_group_memberships_(?:user|group)_active/,
    );
    expect(details).toMatch(/SEARCH rule USING INDEX sqlite_autoindex_group_membership_category_rules_1/);
    expect(details).not.toMatch(/SCAN (?:group_memberships|group_membership_category_rules)\b/);
    expect(details).not.toMatch(/USE TEMP B-TREE/);
  });

  it("keeps service identities out of membership foreign keys on the mounted management route", async () => {
    const admin = await insertActor("service-join-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Service Managed Join Group",
      eligibilityMode: "managed",
    });
    const userId = await insertUser(env.DB, "service-managed-member@example.test");
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Service Managed Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    const apiKey = "group-platform-service-key";
    const response = await callApi(
      { ...env, ADMIN_API_KEY: apiKey } as Env,
      `/api/v1/groups/${group.id}/memberships/${userId}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
      },
    );

    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await queryAll<{ created_by_user_id: string | null }>(
        env.DB,
        "SELECT created_by_user_id FROM group_memberships WHERE group_id = ? AND user_id = ?",
        [group.id, userId],
      ),
    ).toEqual([{ created_by_user_id: null }]);
  });

  it("requires explicit child membership, ends descendants only after the last parent capacity, and never restores them silently", async () => {
    const admin = await insertActor("hierarchy-admin@example.test", "admin");
    const parent = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Parent Group",
      eligibilityMode: "open",
    });
    const child = await createGroup(env.DB, admin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Child Group",
      eligibilityMode: "open",
    });
    const userId = await insertUser(env.DB, "hierarchy-member@example.test");
    const memberAId = await seedOrganizationAggregate(env.DB, await insertOrganization(env.DB, "Hierarchy Org A"), "A");
    const memberBId = await seedOrganizationAggregate(env.DB, await insertOrganization(env.DB, "Hierarchy Org B"), "B");
    await addRepresentative(env.DB, memberAId, userId);
    await addRepresentative(env.DB, memberBId, userId);

    await expect(
      joinGroup(env.DB, child.id, {
        actorUserId: userId,
        targetUserId: userId,
        selection: { mode: "all_eligible", confirmed: true },
        source: "self_service",
        allowManaged: false,
      }),
    ).rejects.toThrow(/parent group membership/i);

    await joinGroup(env.DB, parent.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    await joinGroup(env.DB, child.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });

    await leaveGroup(env.DB, parent.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "selected", memberIds: [memberAId] },
      actorType: "member",
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL",
        [child.id, userId],
      ),
    ).toHaveLength(2);

    await leaveGroup(env.DB, parent.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "selected", memberIds: [memberBId] },
      actorType: "member",
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL",
        [child.id, userId],
      ),
    ).toHaveLength(0);

    await joinGroup(env.DB, parent.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "selected", memberIds: [memberBId] },
      source: "self_service",
      allowManaged: false,
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL",
        [child.id, userId],
      ),
    ).toHaveLength(0);
  });
});

describe("group configuration concurrency", () => {
  it("rejects a stale group update without overwriting the winning change or auditing success", async () => {
    const admin = await insertActor("group-update-race-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Group Update Race",
      description: "Initial description",
    });
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      updateGroup(env.DB, admin, group.id, { description: "Winning description" }),
    );

    await expect(updateGroup(racingDb, admin, group.id, { name: "Losing name" })).rejects.toMatchObject({
      status: 409,
      code: "GROUP_CHANGED",
    });
    await expect(
      updateGroup(env.DB, admin, group.id, { expectedRevision: group.revision, name: "Stale editor name" }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_CHANGED" });
    expect(
      await queryAll<{ name: string; description: string; revision: number }>(
        env.DB,
        "SELECT name, description, revision FROM groups WHERE id = ?",
        [group.id],
      ),
    ).toEqual([{ name: "Group Update Race", description: "Winning description", revision: 1 }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'group_updated' AND entity_id = ?", group.id),
    ).toHaveLength(1);
  });

  it("rejects a stale category-rule replacement without deleting the winning rules", async () => {
    const admin = await insertActor("category-rule-race-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Category Rule Race",
      eligibilityMode: "category",
    });
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      replaceGroupCategoryRules(env.DB, admin, group.id, {
        rules: [{ membershipCategory: "B", permitsJoin: true, automaticEnrollment: false }],
      }),
    );

    await expect(
      replaceGroupCategoryRules(racingDb, admin, group.id, {
        rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: true }],
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_CHANGED" });
    await expect(
      replaceGroupCategoryRules(env.DB, admin, group.id, {
        expectedRevision: group.revision,
        rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: true }],
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_CHANGED" });
    expect(
      await queryAll<{ membership_category_code: string; permits_join: number; automatic_enrollment: number }>(
        env.DB,
        `SELECT membership_category_code, permits_join, automatic_enrollment
           FROM group_membership_category_rules WHERE group_id = ?`,
        [group.id],
      ),
    ).toEqual([{ membership_category_code: "B", permits_join: 1, automatic_enrollment: 0 }]);
    expect(
      await queryAll<{ revision: number }>(env.DB, "SELECT revision FROM groups WHERE id = ?", [group.id]),
    ).toEqual([{ revision: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'group_category_rules_replaced' AND entity_id = ?",
        group.id,
      ),
    ).toHaveLength(1);
  });
});

describe("group leadership inheritance", () => {
  it("rejects direct and recursive hierarchy cycles without recording a mutation", async () => {
    const admin = await insertActor("cycle-admin@example.test", "admin");
    const root = await createGroup(env.DB, admin, { typeKey: "working_group", name: "Cycle Root" });
    const child = await createGroup(env.DB, admin, {
      typeKey: "committee",
      parentGroupId: root.id,
      name: "Cycle Child",
    });
    const grandchild = await createGroup(env.DB, admin, {
      typeKey: "committee",
      parentGroupId: child.id,
      name: "Cycle Grandchild",
    });

    await expect(updateGroup(env.DB, admin, root.id, { parentGroupId: root.id })).rejects.toMatchObject({
      code: "GROUP_HIERARCHY_CYCLE",
    });
    await expect(updateGroup(env.DB, admin, root.id, { parentGroupId: grandchild.id })).rejects.toMatchObject({
      code: "GROUP_HIERARCHY_CYCLE",
    });
    expect(
      await queryAll<{ parent_group_id: string | null }>(env.DB, "SELECT parent_group_id FROM groups WHERE id = ?", [
        root.id,
      ]),
    ).toEqual([{ parent_group_id: null }]);
    expect(
      await queryAll(
        env.DB,
        `SELECT id FROM audit_log
          WHERE action = 'group_updated' AND entity_id = ? AND scope_type = 'group' AND scope_id = ?`,
        [root.id, root.id],
      ),
    ).toHaveLength(0);
  });

  it("inherits management by default and requires safe local leadership before severing inheritance", async () => {
    const globalAdmin = await insertActor("governance-admin@example.test", "admin");
    const parent = await createGroup(env.DB, globalAdmin, { typeKey: "working_group", name: "Governance Parent" });
    const child = await createGroup(env.DB, globalAdmin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Governance Child",
    });
    const parentLeader = await insertActor("parent-leader@example.test");
    await grantGroupLeadership(parent.id, parentLeader.id);
    expect(await canManageGroup(env.DB, parentLeader, child.id)).toBe(true);

    await expect(
      updateGroup(env.DB, parentLeader, child.id, { governanceInheritanceMode: "local_only" }),
    ).rejects.toMatchObject({ code: "GROUP_LOCAL_LEADERSHIP_REQUIRED" });

    const localLeader = await insertActor("local-leader@example.test");
    await assignLocalGroupLeadership(env.DB, parentLeader, child.id, {
      userId: localLeader.id,
      roleId: "role-group_lead",
    });
    await updateGroup(env.DB, parentLeader, child.id, { governanceInheritanceMode: "local_only" });
    expect(await canManageGroup(env.DB, parentLeader, child.id)).toBe(false);
    expect(await canManageGroup(env.DB, localLeader, child.id)).toBe(true);

    const [assignment] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM user_roles WHERE context_type = 'group' AND context_id = ? AND user_id = ? AND revoked_at IS NULL",
      [child.id, localLeader.id],
    );
    await expect(revokeLocalGroupLeadership(env.DB, localLeader, child.id, assignment!.id)).rejects.toMatchObject({
      code: "GROUP_LOCAL_LEADERSHIP_REQUIRED",
    });
  });

  it("uses one bounded evidence query for global, exact, inherited, scope-restricted, and active-user access", async () => {
    const globalAdmin = await insertActor("evidence-admin@example.test", "admin");
    const parent = await createGroup(env.DB, globalAdmin, { typeKey: "working_group", name: "Evidence Parent" });
    const child = await createGroup(env.DB, globalAdmin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Evidence Child",
    });
    const other = await createGroup(env.DB, globalAdmin, { typeKey: "working_group", name: "Evidence Other" });
    const exactManager = await insertActor("exact-manager@example.test");
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, created_at)
       VALUES (?, ?, 'groups:write', 'group', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), exactManager.id, parent.id)
      .run();
    expect(await canManageGroup(env.DB, exactManager, parent.id)).toBe(true);
    expect(await canManageGroup(env.DB, exactManager, child.id)).toBe(false);
    expect(await canManageGroup(env.DB, exactManager, other.id)).toBe(false);

    const inheritedManager = await insertActor("inherited-manager@example.test");
    await grantGroupLeadership(parent.id, inheritedManager.id);
    expect(await canManageGroup(env.DB, inheritedManager, child.id)).toBe(true);
    expect(await canManageGroup(env.DB, { ...inheritedManager, scopeRestricted: true, scopes: [] }, child.id)).toBe(
      false,
    );

    const evidence = groupManagementAuthorizationEvidence(inheritedManager, [child.id]);
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${evidence.sql}`)
      .bind(...evidence.bindings)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toMatch(/SEARCH active_actor USING INDEX sqlite_autoindex_users_1/);
    expect(details).toMatch(/SEARCH actor_role USING INDEX idx_user_roles_user/);
    expect(details).toMatch(/SEARCH direct_grant USING INDEX uq_permission_grants_active_user_permission_context/);
    expect(details).not.toMatch(/SCAN (?:users|user_roles|permission_grants|groups)\b/);
    expect(details).not.toMatch(/USE TEMP B-TREE/);

    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(inheritedManager.id).run();
    expect(await canManageGroup(env.DB, inheritedManager, child.id)).toBe(false);
    expect(
      await canManageGroup(
        env.DB,
        { identityType: "service", id: "api-key", email: "api-key", role: "admin", scopes: ["groups:write"] },
        child.id,
      ),
    ).toBe(true);
  });

  it("filters manageable group pages in D1 with the canonical effective-management policy", async () => {
    const globalAdmin = await insertActor("manageable-list-admin@example.test", "admin");
    const parent = await createGroup(env.DB, globalAdmin, { typeKey: "working_group", name: "Managed Parent" });
    const child = await createGroup(env.DB, globalAdmin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Managed Child",
    });
    const localOnly = await createGroup(env.DB, globalAdmin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Local Only Child",
    });
    const unrelated = await createGroup(env.DB, globalAdmin, {
      typeKey: "working_group",
      name: "Unrelated Group",
    });
    const parentLeader = await insertActor("manageable-list-leader@example.test");
    await grantGroupLeadership(parent.id, parentLeader.id);
    const localLeader = await insertActor("manageable-list-local-leader@example.test");
    await assignLocalGroupLeadership(env.DB, globalAdmin, localOnly.id, {
      userId: localLeader.id,
      roleId: "role-group_lead",
    });
    await updateGroup(env.DB, globalAdmin, localOnly.id, { governanceInheritanceMode: "local_only" });

    const result = await listGroups(
      env.DB,
      { manageable: true, active: true, sort: "name", limit: 25, offset: 0 },
      { requiredAuthorization: groupManagementCandidateAuthorizationEvidence(parentLeader) },
    );

    expect(result.groups.map((group) => group.id)).toEqual([child.id, parent.id]);
    expect(result.total).toBe(2);
    expect(result.groups.some((group) => group.id === localOnly.id)).toBe(false);
    expect(result.groups.some((group) => group.id === unrelated.id)).toBe(false);
  });

  it("re-evaluates inherited management inside group and leadership mutation batches", async () => {
    const globalAdmin = await insertActor("guard-admin@example.test", "admin");
    const parent = await createGroup(env.DB, globalAdmin, { typeKey: "working_group", name: "Guard Parent" });
    const child = await createGroup(env.DB, globalAdmin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Guard Child",
    });
    const parentLeader = await insertActor("guard-parent-leader@example.test");
    const leadershipId = await grantGroupLeadership(parent.id, parentLeader.id);
    const revokeManagement = () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(leadershipId).run();

    await expect(
      updateGroup(mutateBeforeNextBatch(env.DB, revokeManagement), parentLeader, child.id, {
        description: "Must not commit",
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_MANAGEMENT_CHANGED" });
    expect(
      await queryAll<{ description: string | null }>(env.DB, "SELECT description FROM groups WHERE id = ?", [child.id]),
    ).toEqual([{ description: null }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'group_updated' AND entity_id = ?", [child.id]),
    ).toHaveLength(0);

    await env.DB.prepare("UPDATE user_roles SET revoked_at = NULL WHERE id = ?").bind(leadershipId).run();
    await expect(
      replaceGroupCategoryRules(mutateBeforeNextBatch(env.DB, revokeManagement), parentLeader, child.id, {
        rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: false }],
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_MANAGEMENT_CHANGED" });
    expect(
      await queryAll(
        env.DB,
        "SELECT membership_category_code FROM group_membership_category_rules WHERE group_id = ?",
        [child.id],
      ),
    ).toHaveLength(0);

    await env.DB.prepare("UPDATE user_roles SET revoked_at = NULL WHERE id = ?").bind(leadershipId).run();
    const candidate = await insertActor("guard-candidate@example.test");
    await expect(
      assignLocalGroupLeadership(mutateBeforeNextBatch(env.DB, revokeManagement), parentLeader, child.id, {
        userId: candidate.id,
        roleId: "role-group_lead",
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_MANAGEMENT_CHANGED" });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM user_roles WHERE context_type = 'group' AND context_id = ? AND user_id = ?",
        [child.id, candidate.id],
      ),
    ).toHaveLength(0);
  });

  it("keeps service identities out of leadership attribution foreign keys", async () => {
    const globalAdmin = await insertActor("service-leadership-admin@example.test", "admin");
    const group = await createGroup(env.DB, globalAdmin, {
      typeKey: "working_group",
      name: "Service Leadership Group",
    });
    const candidate = await insertActor("service-leadership-candidate@example.test");
    const serviceActor: AuthAdmin = {
      identityType: "service",
      id: "api-key",
      email: "api-key",
      role: "admin",
      scopes: ["groups:write"],
    };

    await assignLocalGroupLeadership(env.DB, serviceActor, group.id, {
      userId: candidate.id,
      roleId: "role-group_lead",
    });
    expect(
      await queryAll<{ granted_by_user_id: string | null }>(
        env.DB,
        "SELECT granted_by_user_id FROM user_roles WHERE context_type = 'group' AND context_id = ? AND user_id = ?",
        [group.id, candidate.id],
      ),
    ).toEqual([{ granted_by_user_id: null }]);
  });

  it("requires global management before detaching a child from its parent", async () => {
    const globalAdmin = await insertActor("detach-admin@example.test", "admin");
    const parent = await createGroup(env.DB, globalAdmin, { typeKey: "working_group", name: "Detach Parent" });
    const child = await createGroup(env.DB, globalAdmin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Detach Child",
    });
    const parentLeader = await insertActor("detach-parent-leader@example.test");
    await grantGroupLeadership(parent.id, parentLeader.id);

    await expect(updateGroup(env.DB, parentLeader, child.id, { parentGroupId: null })).rejects.toMatchObject({
      status: 403,
      code: "GROUP_CREATE_REQUIRED",
    });
    await updateGroup(env.DB, globalAdmin, child.id, { parentGroupId: null });
    expect(
      await queryAll<{ parent_group_id: string | null }>(env.DB, "SELECT parent_group_id FROM groups WHERE id = ?", [
        child.id,
      ]),
    ).toEqual([{ parent_group_id: null }]);
  });
});

describe("group route contracts", () => {
  it("requires management authentication and returns only effectively manageable groups", async () => {
    const globalAdmin = await insertActor("manageable-route-admin@example.test", "admin");
    const parent = await createGroup(env.DB, globalAdmin, { typeKey: "working_group", name: "Route Parent" });
    const child = await createGroup(env.DB, globalAdmin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Route Child",
    });
    const unrelatedGroup = await createGroup(env.DB, globalAdmin, {
      typeKey: "working_group",
      name: "Route Unrelated",
    });
    const parentLeader = await insertActor("manageable-route-leader@example.test");
    await grantGroupLeadership(parent.id, parentLeader.id);

    const unauthenticated = await callApi(env as Env, "/api/v1/groups?manageable=true");
    expect(unauthenticated.status).toBe(401);

    const token = await createAdminSession(env.DB, parentLeader.id, "manageable-route-token");
    const response = await callApi(env as Env, "/api/v1/groups?manageable=true&active=true&sort=name&limit=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const firstPage = groupsListResponseSchema.parse(await response.json());
    expect(firstPage.groups.map((group) => group.id)).toEqual([child.id]);
    expect(firstPage.page).toMatchObject({ limit: 1, offset: 0, total: 2, hasMore: true });

    const managedDetail = await callApi(env as Env, `/api/v1/groups/${child.id}?manageable=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(managedDetail.status).toBe(200);

    const unrelated = await callApi(env as Env, `/api/v1/groups/${unrelatedGroup.id}?manageable=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unrelated.status).toBe(403);
  });

  it("projects selected-group navigation capabilities from live participation and governance", async () => {
    const globalAdmin = await insertActor("context-route-admin@example.test", "admin");
    const parent = await createGroup(env.DB, globalAdmin, {
      typeKey: "working_group",
      name: "Context Route Parent",
    });
    const child = await createGroup(env.DB, globalAdmin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: "Context Route Child",
      visibility: "participants",
      eligibilityMode: "open",
    });
    const parentLeader = await insertActor("context-route-leader@example.test");
    await grantGroupLeadership(parent.id, parentLeader.id);

    const leaderToken = await createAdminSession(env.DB, parentLeader.id, "context-route-leader-token");
    const leaderResponse = await callApi(env as Env, `/api/v1/groups/${child.id}/context`, {
      headers: { authorization: `Bearer ${leaderToken}` },
    });
    expect(leaderResponse.status, await leaderResponse.clone().text()).toBe(200);
    expect(groupPortalContextResponseSchema.parse(await leaderResponse.json()).capabilities).toEqual([
      "view",
      "manage",
    ]);

    const participantUserId = await insertUser(env.DB, "context-route-participant@example.test");
    const participantMemberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Context Route Participant"),
      "A",
    );
    await addRepresentative(env.DB, participantMemberId, participantUserId);
    await joinGroup(env.DB, parent.id, {
      actorUserId: participantUserId,
      targetUserId: participantUserId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    await joinGroup(env.DB, child.id, {
      actorUserId: participantUserId,
      targetUserId: participantUserId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    const participantToken = await createMemberSession(env.DB, participantUserId, "context-route-participant-token");
    const participantResponse = await callApi(env as Env, `/api/v1/groups/${child.id}/context`, {
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(participantResponse.status, await participantResponse.clone().text()).toBe(200);
    expect(groupPortalContextResponseSchema.parse(await participantResponse.json()).capabilities).toEqual([
      "view",
      "participate",
    ]);

    const outsiderUserId = await insertUser(env.DB, "context-route-outsider@example.test");
    const outsiderMemberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Context Route Outsider"),
      "B",
    );
    await addRepresentative(env.DB, outsiderMemberId, outsiderUserId);
    const outsiderToken = await createMemberSession(env.DB, outsiderUserId, "context-route-outsider-token");
    const outsiderResponse = await callApi(env as Env, `/api/v1/groups/${child.id}/context`, {
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(outsiderResponse.status).toBe(404);
  });

  it("round-trips revisions through the mounted group and category-rule mutation routes", async () => {
    const admin = await insertActor("mounted-revision-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Mounted Revision Group",
      eligibilityMode: "category",
    });
    const apiKey = "mounted-group-revision-key";
    const testEnv = { ...env, ADMIN_API_KEY: apiKey } as Env;
    const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

    const createdResponse = await callApi(testEnv, "/api/v1/groups", {
      method: "POST",
      headers,
      body: JSON.stringify({ typeKey: "working_group", name: "Mounted API-created Group", eligibilityMode: "open" }),
    });
    expect(createdResponse.status, await createdResponse.clone().text()).toBe(201);
    await expect(createdResponse.json()).resolves.toMatchObject({ group: { name: "Mounted API-created Group" } });

    const nonAdminUserId = await insertUser(env.DB, "mounted-group-non-admin@example.test");
    const nonAdminToken = await createMemberSession(env.DB, nonAdminUserId, "mounted-group-non-admin-token");
    const adminSession = await createAdminSession(env.DB, admin.id, "mounted-group-capability-admin-token");
    const sessionHeaders = { authorization: `Bearer ${adminSession}` };
    const canCreate = await callApi(testEnv, "/api/v1/groups/creation-capabilities", { headers: sessionHeaders });
    expect(canCreate.status, await canCreate.clone().text()).toBe(200);
    await expect(canCreate.json()).resolves.toEqual({ canCreate: true });
    const cannotCreate = await callApi(testEnv, "/api/v1/groups/creation-capabilities", {
      headers: { authorization: `Bearer ${nonAdminToken}` },
    });
    expect(cannotCreate.status).toBe(200);
    await expect(cannotCreate.json()).resolves.toEqual({ canCreate: false });
    const createDenied = await callApi(testEnv, "/api/v1/groups", {
      method: "POST",
      headers: { authorization: `Bearer ${nonAdminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ typeKey: "working_group", name: "Should Not Be Created" }),
    });
    expect(createDenied.status).toBe(401);

    const update = await callApi(testEnv, `/api/v1/groups/${group.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expectedRevision: group.revision, description: "Updated through the API" }),
    });
    expect(update.status, await update.clone().text()).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ group: { revision: 1 } });

    const staleUpdate = await callApi(testEnv, `/api/v1/groups/${group.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expectedRevision: group.revision, name: "Stale API update" }),
    });
    expect(staleUpdate.status).toBe(409);
    await expect(staleUpdate.json()).resolves.toMatchObject({ error: { code: "GROUP_CHANGED" } });

    const replace = await callApi(testEnv, `/api/v1/groups/${group.id}/category-rules`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: false }],
      }),
    });
    expect(replace.status, await replace.clone().text()).toBe(200);
    await expect(replace.json()).resolves.toMatchObject({ group: { revision: 2 } });

    const read = await callApi(testEnv, `/api/v1/groups/${group.id}/category-rules`, { headers: sessionHeaders });
    expect(read.status, await read.clone().text()).toBe(200);
    expect(groupCategoryRulesResponseSchema.parse(await read.json())).toMatchObject({
      groupId: group.id,
      revision: 2,
      rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: false }],
    });

    const participantUserId = await insertUser(env.DB, "category-rules-participant@example.test");
    const participantToken = await createMemberSession(env.DB, participantUserId, "category-rules-participant-token");
    const denied = await callApi(testEnv, `/api/v1/groups/${group.id}/category-rules`, {
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(denied.status).toBe(403);

    const staleReplace = await callApi(testEnv, `/api/v1/groups/${group.id}/category-rules`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ expectedRevision: 1, rules: [] }),
    });
    expect(staleReplace.status).toBe(409);
    await expect(staleReplace.json()).resolves.toMatchObject({ error: { code: "GROUP_CHANGED" } });
  });

  it("requires confirmation for all-capacity joins and rejects empty explicit selection", () => {
    expect(groupJoinSchema.safeParse({ capacitySelection: { mode: "all_eligible" } }).success).toBe(false);
    expect(groupJoinSchema.safeParse({ capacitySelection: { mode: "all_eligible", confirmed: false } }).success).toBe(
      false,
    );
    expect(groupJoinSchema.safeParse({ capacitySelection: { mode: "selected", memberIds: [] } }).success).toBe(false);
    expect(groupJoinSchema.safeParse({ capacitySelection: { mode: "all_eligible", confirmed: true } }).success).toBe(
      true,
    );
  });
});
