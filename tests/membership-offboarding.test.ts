import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { updateAdminUser } from "../functions/_lib/services/admin-user-update";
import { removeAdminMember } from "../functions/_lib/services/admin-organizations/representatives";
import {
  addWorkingGroupMember,
  buildAddWorkingGroupMemberStatements,
  type WorkingGroupRow,
} from "../functions/_lib/services/working-groups";
import { buildUserAccessOffboardingStatements } from "../functions/_lib/services/membership/offboarding";
import type { AuthAdmin } from "../functions/_lib/types";

async function insertWorkingGroup(name: string, email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO working_groups
       (id, name, slug, description, mailing_list_email, active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 6)}`, email)
    .run();
  return id;
}

async function joinWorkingGroup(workingGroupId: string, userId: string, memberId: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO working_group_members
       (id, working_group_id, user_id, member_id, joined_at, left_at)
     VALUES (?, ?, ?, ?, datetime('now'), NULL)`,
  )
    .bind(id, workingGroupId, userId, memberId)
    .run();
  return id;
}

describe("membership access offboarding", () => {
  beforeEach(resetDb);

  it("atomically deactivates a user, closes every active WG seat, and enqueues one deterministic removal per managed list", async () => {
    const actorId = await insertUser(env.DB, "offboarding-admin@example.test");
    const userId = await insertUser(env.DB, "offboarding-user@example.test");
    const actor: AuthAdmin = { id: actorId, email: "offboarding-admin@example.test", role: "admin" };
    const workingGroupId = await insertWorkingGroup("Offboarding WG", "offboarding-wg@lists.pkic.org");
    const organizationId = await insertOrganization(env.DB, "Offboarding Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);
    await joinWorkingGroup(workingGroupId, userId, null);

    const [{ active_lists: activeListCount }] = await queryAll<{ active_lists: number }>(
      env.DB,
      "SELECT COUNT(DISTINCT email) AS active_lists FROM mailing_lists WHERE active = 1",
    );
    await updateAdminUser(env.DB, actor, userId, { active: false });

    expect(await queryAll(env.DB, "SELECT active FROM users WHERE id = ?", userId)).toEqual([{ active: 0 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT left_at IS NOT NULL AS closed FROM working_group_members WHERE user_id = ?",
        userId,
      ),
    ).toEqual([{ closed: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT left_at IS NOT NULL AS closed FROM organization_representatives WHERE member_id = ? AND user_id = ?",
        [memberId, userId],
      ),
    ).toEqual([{ closed: 1 }]);
    const removals = await queryAll<{ google_group_email: string; idempotency_key: string; member_email: string }>(
      env.DB,
      `SELECT google_group_email, idempotency_key, member_email
         FROM google_groups_sync_queue
        WHERE user_id = ? AND action = 'remove_from_list'
        ORDER BY google_group_email`,
      userId,
    );
    expect(removals).toHaveLength(activeListCount + 1);
    expect(removals.map((row) => row.google_group_email)).toContain("offboarding-wg@lists.pkic.org");
    expect(new Set(removals.map((row) => row.idempotency_key)).size).toBe(removals.length);
    expect(removals.every((row) => row.idempotency_key.startsWith(`user:${userId}:deactivate:`))).toBe(true);
    expect(removals.every((row) => row.member_email === "offboarding-user@example.test")).toBe(true);
  });

  it("rolls back access closure and queueing when the deactivation audit cannot commit", async () => {
    const actorId = await insertUser(env.DB, "rollback-admin@example.test");
    const userId = await insertUser(env.DB, "rollback-user@example.test");
    const actor: AuthAdmin = { id: actorId, email: "rollback-admin@example.test", role: "admin" };
    const workingGroupId = await insertWorkingGroup("Rollback WG", "rollback-wg@lists.pkic.org");
    const organizationId = await insertOrganization(env.DB, "Rollback Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);
    await joinWorkingGroup(workingGroupId, userId, null);
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
      expect(await queryAll(env.DB, "SELECT left_at FROM working_group_members WHERE user_id = ?", userId)).toEqual([
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

  it("does not enqueue an add when a concurrently inserted WG seat makes the guarded insert a no-op", async () => {
    const userId = await insertUser(env.DB, "ignored-seat-add@example.test");
    const workingGroupId = await insertWorkingGroup("Ignored insert WG", "ignored-insert@lists.pkic.org");
    const workingGroup: WorkingGroupRow = {
      id: workingGroupId,
      slug: "ignored-insert-wg",
      name: "Ignored insert WG",
      mailing_list_email: "ignored-insert@lists.pkic.org",
      active: 1,
    };
    const staleAddPlan = await buildAddWorkingGroupMemberStatements(env.DB, workingGroup, userId);
    await joinWorkingGroup(workingGroupId, userId, null);

    await env.DB.batch(staleAddPlan);

    expect(
      await queryAll(env.DB, "SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ?", [
        workingGroupId,
        userId,
      ]),
    ).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM google_groups_sync_queue WHERE user_id = ? AND google_group_email = ?",
        userId,
        workingGroup.mailing_list_email,
      ),
    ).toHaveLength(0);
  });

  it("rejects a stale WG add plan after deactivation commits", async () => {
    const actorId = await insertUser(env.DB, "stale-add-admin@example.test");
    const userId = await insertUser(env.DB, "stale-add-user@example.test");
    const actor: AuthAdmin = { id: actorId, email: "stale-add-admin@example.test", role: "admin" };
    const workingGroupId = await insertWorkingGroup("Stale add WG", "stale-add@lists.pkic.org");
    const workingGroup: WorkingGroupRow = {
      id: workingGroupId,
      slug: "stale-add-wg",
      name: "Stale add WG",
      mailing_list_email: "stale-add@lists.pkic.org",
      active: 1,
    };
    const staleAddPlan = await buildAddWorkingGroupMemberStatements(env.DB, workingGroup, userId);

    await updateAdminUser(env.DB, actor, userId, { active: false });
    await env.DB.batch(staleAddPlan);

    expect(
      await queryAll(env.DB, "SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ?", [
        workingGroupId,
        userId,
      ]),
    ).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        `SELECT id FROM google_groups_sync_queue
          WHERE user_id = ? AND google_group_email = ? AND action = 'add_to_list'`,
        userId,
        workingGroup.mailing_list_email,
      ),
    ).toHaveLength(0);
  });

  it("closes and removes a WG seat inserted after offboarding was planned but before it commits", async () => {
    const userId = await insertUser(env.DB, "late-seat-user@example.test");
    const workingGroupId = await insertWorkingGroup("Late seat WG", "late-seat@lists.pkic.org");
    const workingGroup: WorkingGroupRow = {
      id: workingGroupId,
      slug: "late-seat-wg",
      name: "Late seat WG",
      mailing_list_email: "late-seat@lists.pkic.org",
      active: 1,
    };
    const at = new Date().toISOString();
    const staleOffboardingPlan = await buildUserAccessOffboardingStatements(env.DB, {
      userId,
      causeKey: `user:${userId}:interleaved-deactivate`,
      at,
    });
    await addWorkingGroupMember(env.DB, workingGroup, userId);

    await env.DB.batch([
      env.DB.prepare("UPDATE users SET active = 0, updated_at = ? WHERE id = ?").bind(at, userId),
      ...staleOffboardingPlan,
    ]);

    expect(
      await queryAll<{ closed: number }>(
        env.DB,
        "SELECT left_at IS NOT NULL AS closed FROM working_group_members WHERE working_group_id = ? AND user_id = ?",
        workingGroupId,
        userId,
      ),
    ).toEqual([{ closed: 1 }]);
    expect(
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM google_groups_sync_queue WHERE user_id = ? AND google_group_email = ? ORDER BY rowid",
        userId,
        workingGroup.mailing_list_email,
      ),
    ).toEqual([{ action: "add_to_list" }, { action: "remove_from_list" }]);
    expect(
      await queryAll<{ desired_action: string }>(
        env.DB,
        `SELECT desired_action FROM google_groups_membership_desired_state
          WHERE user_id = ? AND google_group_email = ?`,
        userId,
        workingGroup.mailing_list_email,
      ),
    ).toEqual([{ desired_action: "remove_from_list" }]);
  });

  it("removing one representative closes only seats justified by that membership and preserves other access", async () => {
    const actorId = await insertUser(env.DB, "representative-admin@example.test");
    const userId = await insertUser(env.DB, "multi-representative@example.test");
    const orgA = await insertOrganization(env.DB, "Representative Org A");
    const orgB = await insertOrganization(env.DB, "Representative Org B");
    const memberA = await seedOrganizationAggregate(env.DB, orgA, "A");
    const memberB = await seedOrganizationAggregate(env.DB, orgB, "B");
    const representativeA = await addRepresentative(env.DB, memberA, userId);
    await addRepresentative(env.DB, memberB, userId);
    const wgA = await insertWorkingGroup("Representative A WG", "representative-a@lists.pkic.org");
    const wgB = await insertWorkingGroup("Representative B WG", "representative-b@lists.pkic.org");
    await joinWorkingGroup(wgA, userId, memberA);
    await joinWorkingGroup(wgB, userId, memberB);

    await removeAdminMember(env.DB, actorId, representativeA);

    expect(
      await queryAll<{ member_id: string; closed: number }>(
        env.DB,
        "SELECT member_id, left_at IS NOT NULL AS closed FROM working_group_members WHERE user_id = ? ORDER BY member_id",
        userId,
      ),
    ).toEqual(
      [
        { member_id: memberA, closed: 1 },
        { member_id: memberB, closed: 0 },
      ].sort((a, b) => a.member_id.localeCompare(b.member_id)),
    );
    expect(
      await queryAll(env.DB, "SELECT google_group_email FROM google_groups_sync_queue WHERE user_id = ?", userId),
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
