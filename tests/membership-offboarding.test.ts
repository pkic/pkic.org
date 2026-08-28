import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { updateAdminUser } from "../functions/_lib/services/admin-user-update";
import { removeAdminMember } from "../functions/_lib/services/organization-management/representative-provisioning";
import { buildUserAccessOffboardingStatements } from "../functions/_lib/services/membership/offboarding";
import { reconcileMailingListSubscriptionsForUser } from "../functions/_lib/services/mailing-list-subscriptions";
import type { AuthAdmin } from "../functions/_lib/types";

async function insertGroup(name: string, email: string): Promise<string> {
  const id = crypto.randomUUID();
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 6)}`;
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO groups
         (id, type_key, name, slug, visibility, eligibility_mode, created_at, updated_at)
       VALUES (?, 'working_group', ?, ?, 'public', 'open', ?, ?)`,
    ).bind(id, name, slug, at, at),
    env.DB.prepare(
      `INSERT INTO mailing_lists
         (id, email, label, purpose, group_id, is_primary_discussion,
          subscription_default, posting_policy, moderation_policy, created_at, updated_at)
       VALUES (?, ?, ?, 'group', ?, 1, 'group_members', 'subscribers', 'moderated', ?, ?)`,
    ).bind(crypto.randomUUID(), email, `${name} discussion`, id, at, at),
  ]);
  return id;
}

async function joinGroupCapacity(groupId: string, userId: string, memberId: string): Promise<string> {
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO group_memberships
       (id, group_id, user_id, member_id, source, joined_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'staff', ?, ?, ?)`,
  )
    .bind(id, groupId, userId, memberId, at, at, at)
    .run();
  return id;
}

async function establishDesiredSubscriptions(userId: string): Promise<number> {
  await reconcileMailingListSubscriptionsForUser(env.DB, userId);
  const [{ total }] = await queryAll<{ total: number }>(
    env.DB,
    `SELECT COUNT(*) AS total
       FROM google_groups_membership_desired_state
      WHERE user_id = ? AND desired_action = 'add_to_list'`,
    userId,
  );
  await env.DB.prepare("DELETE FROM google_groups_sync_queue WHERE user_id = ?").bind(userId).run();
  return total;
}

describe("membership access offboarding", () => {
  beforeEach(resetDb);

  it("atomically deactivates a user, closes every group capacity, and reconciles projected subscriptions", async () => {
    const actorId = await insertUser(env.DB, "offboarding-admin@example.test");
    const userId = await insertUser(env.DB, "offboarding-user@example.test");
    const actor: AuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "offboarding-admin@example.test",
      role: "admin",
    };
    const groupId = await insertGroup("Offboarding Group", "offboarding-group@lists.pkic.org");
    const organizationId = await insertOrganization(env.DB, "Offboarding Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);
    await joinGroupCapacity(groupId, userId, memberId);
    const desiredSubscriptionCount = await establishDesiredSubscriptions(userId);

    await updateAdminUser(env.DB, actor, userId, { active: false });

    expect(await queryAll(env.DB, "SELECT active FROM users WHERE id = ?", userId)).toEqual([{ active: 0 }]);
    expect(
      await queryAll(env.DB, "SELECT left_at IS NOT NULL AS closed FROM group_memberships WHERE user_id = ?", userId),
    ).toEqual([{ closed: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT left_at IS NOT NULL AS closed FROM organization_representatives WHERE member_id = ? AND user_id = ?",
        [memberId, userId],
      ),
    ).toEqual([{ closed: 1 }]);
    const removals = await queryAll<{ google_group_email: string; idempotency_key: string }>(
      env.DB,
      `SELECT google_group_email, idempotency_key
         FROM google_groups_sync_queue
        WHERE user_id = ? AND action = 'remove_from_list'
        ORDER BY google_group_email`,
      userId,
    );
    expect(removals).toHaveLength(desiredSubscriptionCount);
    expect(removals.map((row) => row.google_group_email)).toContain("offboarding-group@lists.pkic.org");
    expect(new Set(removals.map((row) => row.idempotency_key)).size).toBe(removals.length);
    expect(removals.every((row) => row.idempotency_key.startsWith(`mailing-list-reconcile:${userId}:`))).toBe(true);
  });

  it("rolls back access closure and subscription reconciliation when the audit cannot commit", async () => {
    const actorId = await insertUser(env.DB, "rollback-admin@example.test");
    const userId = await insertUser(env.DB, "rollback-user@example.test");
    const actor: AuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "rollback-admin@example.test",
      role: "admin",
    };
    const groupId = await insertGroup("Rollback Group", "rollback-group@lists.pkic.org");
    const organizationId = await insertOrganization(env.DB, "Rollback Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);
    await joinGroupCapacity(groupId, userId, memberId);
    await establishDesiredSubscriptions(userId);
    await env.DB.prepare(
      `CREATE TRIGGER reject_offboarding_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'user_updated'
       BEGIN
         SELECT RAISE(ABORT, 'forced offboarding audit failure');
       END`,
    ).run();

    try {
      await expect(updateAdminUser(env.DB, actor, userId, { active: false })).rejects.toThrow(
        "forced offboarding audit failure",
      );
      expect(await queryAll(env.DB, "SELECT active FROM users WHERE id = ?", userId)).toEqual([{ active: 1 }]);
      expect(await queryAll(env.DB, "SELECT left_at FROM group_memberships WHERE user_id = ?", userId)).toEqual([
        { left_at: null },
      ]);
      expect(
        await queryAll(env.DB, "SELECT left_at FROM organization_representatives WHERE member_id = ? AND user_id = ?", [
          memberId,
          userId,
        ]),
      ).toEqual([{ left_at: null }]);
      expect(await queryAll(env.DB, "SELECT id FROM google_groups_sync_queue WHERE user_id = ?", userId)).toHaveLength(
        0,
      );
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_offboarding_audit").run();
    }
  });

  it("closes a capacity inserted after offboarding was planned but before it commits", async () => {
    const userId = await insertUser(env.DB, "late-capacity-user@example.test");
    const groupId = await insertGroup("Late Capacity Group", "late-capacity@lists.pkic.org");
    const organizationId = await insertOrganization(env.DB, "Late Capacity Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);
    const at = new Date().toISOString();
    const staleOffboardingPlan = await buildUserAccessOffboardingStatements(env.DB, {
      userId,
      causeKey: `user:${userId}:interleaved-deactivate`,
      at,
    });
    await joinGroupCapacity(groupId, userId, memberId);
    await establishDesiredSubscriptions(userId);

    await env.DB.batch([
      env.DB.prepare("UPDATE users SET active = 0, updated_at = ? WHERE id = ?").bind(at, userId),
      ...staleOffboardingPlan,
    ]);

    expect(
      await queryAll<{ closed: number }>(
        env.DB,
        "SELECT left_at IS NOT NULL AS closed FROM group_memberships WHERE group_id = ? AND user_id = ?",
        [groupId, userId],
      ),
    ).toEqual([{ closed: 1 }]);
    expect(
      await queryAll<{ desired_action: string }>(
        env.DB,
        `SELECT desired_action FROM google_groups_membership_desired_state
          WHERE user_id = ? AND google_group_email = ?`,
        [userId, "late-capacity@lists.pkic.org"],
      ),
    ).toEqual([{ desired_action: "remove_from_list" }]);
  });

  it("removing one representative closes only that Member capacity and preserves other access", async () => {
    const actorId = await insertUser(env.DB, "representative-admin@example.test");
    const userId = await insertUser(env.DB, "multi-representative@example.test");
    const orgA = await insertOrganization(env.DB, "Representative Org A");
    const orgB = await insertOrganization(env.DB, "Representative Org B");
    const memberA = await seedOrganizationAggregate(env.DB, orgA, "A");
    const memberB = await seedOrganizationAggregate(env.DB, orgB, "B");
    const representativeA = await addRepresentative(env.DB, memberA, userId);
    await addRepresentative(env.DB, memberB, userId);
    const groupA = await insertGroup("Representative A Group", "representative-a@lists.pkic.org");
    const groupB = await insertGroup("Representative B Group", "representative-b@lists.pkic.org");
    await joinGroupCapacity(groupA, userId, memberA);
    await joinGroupCapacity(groupB, userId, memberB);
    await establishDesiredSubscriptions(userId);

    await removeAdminMember(env.DB, actorId, representativeA);

    expect(
      await queryAll<{ member_id: string; closed: number }>(
        env.DB,
        `SELECT member_id, left_at IS NOT NULL AS closed
           FROM group_memberships
          WHERE user_id = ? AND group_id IN (?, ?)
          ORDER BY member_id`,
        [userId, groupA, groupB],
      ),
    ).toEqual(
      [
        { member_id: memberA, closed: 1 },
        { member_id: memberB, closed: 0 },
      ].sort((a, b) => a.member_id.localeCompare(b.member_id)),
    );
    expect(
      await queryAll<{ google_group_email: string }>(
        env.DB,
        `SELECT google_group_email FROM google_groups_sync_queue
          WHERE user_id = ? AND action = 'remove_from_list'
          ORDER BY google_group_email`,
        userId,
      ),
    ).toEqual([{ google_group_email: "representative-a@lists.pkic.org" }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM organization_representatives WHERE member_id = ? AND user_id = ? AND left_at IS NULL",
        [memberB, userId],
      ),
    ).toHaveLength(1);
  });
});
