import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupJoinSchema } from "../assets/shared/schemas/groups";
import type { AuthAdmin } from "../functions/_lib/types";
import {
  assignLocalGroupLeadership,
  canManageGroup,
  createGroup,
  getVisibleGroup,
  joinGroup,
  leaveGroup,
  listEligibleGroupCapacities,
  listGroups,
  revokeLocalGroupLeadership,
  updateGroup,
} from "../functions/_lib/services/groups";
import { queryAll } from "./helpers/context";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
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
    const subset = await joinGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "selected", memberIds: [memberBId] },
      source: "self_service",
      allowManaged: false,
    });
    expect(subset.memberships.map((membership) => membership.memberId)).toEqual([memberBId]);
  });

  it("never offers individual IPR capacity while an organization representation is active", async () => {
    const admin = await insertActor("individual-rule-admin@example.test", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "IPR Capacity Test Group",
      eligibilityMode: "open",
    });
    const { userId, memberId: individualMemberId } = await insertIndividualMember(
      env.DB,
      "H6",
      "individual-and-org@example.test",
    );
    const organizationMemberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "IPR Organization"),
      "A",
    );
    await addRepresentative(env.DB, organizationMemberId, userId);

    const eligible = await listEligibleGroupCapacities(env.DB, group.id, userId, { allowManaged: false });
    expect(eligible.map((capacity) => capacity.memberId)).toEqual([organizationMemberId]);
    expect(eligible.some((capacity) => capacity.memberId === individualMemberId)).toBe(false);
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
});

describe("group route contracts", () => {
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
