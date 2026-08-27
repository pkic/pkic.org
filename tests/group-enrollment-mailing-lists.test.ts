import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGroup,
  joinGroup,
  leaveGroup,
  reconcileAutomaticGroupEnrollmentForUser,
  replaceGroupCategoryRules,
  setAutomaticEnrollmentOptOut,
  updateGroup,
} from "../functions/_lib/services/groups";
import { createMailingList, deleteMailingList } from "../functions/_lib/services/mailing-list-management/commands";
import {
  listEffectiveGroupMailingListSubscriptions,
  setMailingListPreference,
} from "../functions/_lib/services/mailing-list-subscriptions";
import { grantResourceToGroup, revokeResourceGroupGrant } from "../functions/_lib/services/resource-grants";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const ALL_MEMBERS_GROUP_ID = "20000000-0000-4000-8000-000000000001";

async function insertAdmin(): Promise<UserBackedAuthAdmin> {
  const id = await insertUser(env.DB, `group-platform-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { identityType: "user", id, email: "group-platform-admin@example.test", role: "admin" };
}

async function addOrganizationCapacity(userId: string, category: string): Promise<string> {
  const organizationId = await insertOrganization(env.DB, `Group Platform ${crypto.randomUUID()}`);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, category);
  await addRepresentative(env.DB, memberId, userId);
  return memberId;
}

async function activeMemberIds(groupId: string, userId: string): Promise<string[]> {
  return (
    await queryAll<{ member_id: string }>(
      env.DB,
      `SELECT member_id FROM group_memberships
        WHERE group_id = ? AND user_id = ? AND left_at IS NULL
        ORDER BY member_id`,
      [groupId, userId],
    )
  ).map((row) => row.member_id);
}

async function desiredAction(userId: string, email: string): Promise<string | null> {
  const rows = await queryAll<{ desired_action: string }>(
    env.DB,
    `SELECT desired_action FROM google_groups_membership_desired_state
      WHERE user_id = ? AND google_group_email = ?`,
    [userId, email],
  );
  return rows[0]?.desired_action ?? null;
}

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  const testListPredicate =
    "email LIKE 'primary-%@lists.example.test' OR email LIKE 'optional-%@lists.example.test' OR " +
    "email LIKE 'shared-capability-%@lists.example.test'";
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM mailing_list_group_grants
        WHERE mailing_list_id IN (SELECT id FROM mailing_lists WHERE ${testListPredicate})`,
    ),
    env.DB.prepare(
      `UPDATE mailing_lists
          SET group_id = '${ALL_MEMBERS_GROUP_ID}', is_primary_discussion = 0,
              active = 0, archived_at = datetime('now')
        WHERE ${testListPredicate}`,
    ),
  ]);
});

describe("automatic group enrollment", () => {
  it("enrolls every represented organization as a separate IPR capacity", async () => {
    const userId = await insertUser(env.DB, `multi-capacity-${crypto.randomUUID()}@example.test`);
    const organizationA = await addOrganizationCapacity(userId, "A");
    const organizationB = await addOrganizationCapacity(userId, "B");

    await reconcileAutomaticGroupEnrollmentForUser(env.DB, userId);

    expect(await activeMemberIds(ALL_MEMBERS_GROUP_ID, userId)).toEqual([organizationA, organizationB].sort());
    expect(await desiredAction(userId, "pkic@lists.pkic.org")).toBe("add_to_list");
    expect(await desiredAction(userId, "consultation@lists.pkic.org")).toBe("add_to_list");
  });

  it("persists opt-out through eligibility loss and re-entry until explicitly cleared", async () => {
    const admin = await insertAdmin();
    const group = await createGroup(env.DB, admin, {
      typeKey: "community",
      name: `Automatic category group ${crypto.randomUUID()}`,
      eligibilityMode: "category",
      automaticEnrollmentMode: "category",
      allowAutomaticOptOut: true,
    });
    await replaceGroupCategoryRules(env.DB, admin, group.id, {
      rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: true }],
    });
    const userId = await insertUser(env.DB, `opt-out-${crypto.randomUUID()}@example.test`);
    const memberId = await addOrganizationCapacity(userId, "A");
    await reconcileAutomaticGroupEnrollmentForUser(env.DB, userId);
    expect(await activeMemberIds(group.id, userId)).toEqual([memberId]);

    await setAutomaticEnrollmentOptOut(env.DB, userId, group.id, true);
    expect(await activeMemberIds(group.id, userId)).toEqual([]);
    await env.DB.prepare("UPDATE member_category_assignments SET category_code = 'B' WHERE member_id = ?")
      .bind(memberId)
      .run();
    await reconcileAutomaticGroupEnrollmentForUser(env.DB, userId);
    await env.DB.prepare("UPDATE member_category_assignments SET category_code = 'A' WHERE member_id = ?")
      .bind(memberId)
      .run();
    await reconcileAutomaticGroupEnrollmentForUser(env.DB, userId);
    expect(await activeMemberIds(group.id, userId)).toEqual([]);

    await setAutomaticEnrollmentOptOut(env.DB, userId, group.id, false);
    expect(await activeMemberIds(group.id, userId)).toEqual([memberId]);
  });

  it("reconciles category rule changes in D1 without silently restoring explicit membership", async () => {
    const admin = await insertAdmin();
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Rule reconciliation ${crypto.randomUUID()}`,
      eligibilityMode: "category",
    });
    await replaceGroupCategoryRules(env.DB, admin, group.id, {
      rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: false }],
    });
    const userId = await insertUser(env.DB, `rule-change-${crypto.randomUUID()}@example.test`);
    const memberId = await addOrganizationCapacity(userId, "A");
    await joinGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });

    await replaceGroupCategoryRules(env.DB, admin, group.id, {
      rules: [{ membershipCategory: "B", permitsJoin: true, automaticEnrollment: false }],
    });
    expect(await activeMemberIds(group.id, userId)).toEqual([]);
    await replaceGroupCategoryRules(env.DB, admin, group.id, {
      rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: false }],
    });
    expect(await activeMemberIds(group.id, userId)).toEqual([]);
    expect(memberId).toBeTruthy();
  });

  it("keeps automatic-enrollment groups outside the structural hierarchy", async () => {
    const admin = await insertAdmin();
    const parent = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Structural parent ${crypto.randomUUID()}`,
    });
    await expect(
      createGroup(env.DB, admin, {
        typeKey: "community",
        parentGroupId: parent.id,
        name: `Invalid automatic child ${crypto.randomUUID()}`,
        automaticEnrollmentMode: "category",
      }),
    ).rejects.toMatchObject({ code: "GROUP_AUTOMATIC_ENROLLMENT_HIERARCHY" });

    const child = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      parentGroupId: parent.id,
      name: `Structural child ${crypto.randomUUID()}`,
    });
    expect(child.parentGroup?.id).toBe(parent.id);
    await expect(updateGroup(env.DB, admin, parent.id, { automaticEnrollmentMode: "category" })).rejects.toMatchObject({
      code: "GROUP_AUTOMATIC_ENROLLMENT_HIERARCHY",
    });
  });
});

describe("group mailing-list subscriptions", () => {
  it("does not disclose an owning group's mailing-list configuration to a visible nonmember", async () => {
    const admin = await insertAdmin();
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Visible mailing-list owner ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const userId = await insertUser(env.DB, `visible-nonmember-${crypto.randomUUID()}@example.test`);
    await addOrganizationCapacity(userId, "A");
    const list = await createMailingList(
      env.DB,
      {
        email: `optional-${crypto.randomUUID()}@lists.example.test`,
        label: "Member-only configuration",
        purpose: "group",
        groupId: group.id,
        subscriptionDefault: "none",
      },
      admin.id,
    );

    expect(
      (await listEffectiveGroupMailingListSubscriptions(env.DB, userId, group.id, { limit: 50, offset: 0 }))
        .subscriptions,
    ).toEqual([]);

    await joinGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    expect(
      (await listEffectiveGroupMailingListSubscriptions(env.DB, userId, group.id, { limit: 50, offset: 0 }))
        .subscriptions,
    ).toEqual([expect.objectContaining({ mailingList: expect.objectContaining({ id: list.id }) })]);
  });

  it("supports multiple lists, one primary, durable preferences, and changed-only desired state", async () => {
    const admin = await insertAdmin();
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Mailing list group ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const userId = await insertUser(env.DB, `mailing-list-member-${crypto.randomUUID()}@example.test`);
    await addOrganizationCapacity(userId, "A");
    await joinGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });

    const primaryEmail = `primary-${crypto.randomUUID()}@lists.example.test`;
    const optionalEmail = `optional-${crypto.randomUUID()}@lists.example.test`;
    const primary = await createMailingList(
      env.DB,
      {
        email: primaryEmail,
        label: "Primary discussion",
        purpose: "group",
        groupId: group.id,
        primaryDiscussion: true,
        subscriptionDefault: "group_members",
      },
      admin.id,
    );
    const optional = await createMailingList(
      env.DB,
      {
        email: optionalEmail,
        label: "Optional announcements",
        purpose: "group",
        groupId: group.id,
        subscriptionDefault: "none",
      },
      admin.id,
    );
    expect(await desiredAction(userId, primaryEmail)).toBe("add_to_list");
    expect(await desiredAction(userId, optionalEmail)).toBeNull();
    await expect(
      createMailingList(
        env.DB,
        {
          email: `duplicate-primary-${crypto.randomUUID()}@lists.example.test`,
          label: "Duplicate primary",
          purpose: "group",
          groupId: group.id,
          primaryDiscussion: true,
          subscriptionDefault: "group_members",
        },
        admin.id,
      ),
    ).rejects.toMatchObject({ code: "MAILING_LIST_PRIMARY_EXISTS" });

    await setMailingListPreference(env.DB, userId, group.id, optional.id, "subscribed");
    await setMailingListPreference(env.DB, userId, group.id, primary.id, "unsubscribed");
    expect(await desiredAction(userId, optionalEmail)).toBe("add_to_list");
    expect(await desiredAction(userId, primaryEmail)).toBe("remove_from_list");

    await leaveGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all" },
      actorType: "member",
    });
    expect(await desiredAction(userId, optionalEmail)).toBe("remove_from_list");
    await joinGroup(env.DB, group.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    expect(await desiredAction(userId, optionalEmail)).toBe("add_to_list");
    expect(await desiredAction(userId, primaryEmail)).toBe("remove_from_list");

    const page = await listEffectiveGroupMailingListSubscriptions(env.DB, userId, group.id, {
      limit: 50,
      offset: 0,
    });
    expect(page.subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mailingList: expect.objectContaining({ id: primary.id }),
          preference: "unsubscribed",
        }),
        expect.objectContaining({
          mailingList: expect.objectContaining({ id: optional.id }),
          preference: "subscribed",
        }),
      ]),
    );

    await deleteMailingList(env.DB, optional.id, admin.id);
    expect(await desiredAction(userId, optionalEmail)).toBe("remove_from_list");
  });

  it("applies shared subscription grants in D1 and reconciles revocation atomically", async () => {
    const admin = await insertAdmin();
    const owner = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Shared list owner ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const grantee = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Shared list grantee ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const userId = await insertUser(env.DB, `shared-list-member-${crypto.randomUUID()}@example.test`);
    await addOrganizationCapacity(userId, "A");
    await joinGroup(env.DB, grantee.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    const email = `shared-capability-${crypto.randomUUID()}@lists.example.test`;
    const list = await createMailingList(
      env.DB,
      {
        email,
        label: "Shared capability list",
        purpose: "group",
        groupId: owner.id,
        subscriptionDefault: "none",
      },
      admin.id,
    );

    await grantResourceToGroup(env.DB, admin, owner.id, "mailingList", list.id, {
      granteeGroupId: grantee.id,
      capability: "subscribe",
    });
    const memberToken = await createMemberSession(env.DB, userId, `shared-list-${crypto.randomUUID()}`);
    const memberRequest = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${memberToken}`);
      if (init.body) headers.set("content-type", "application/json");
      return callApi(env, path, { ...init, headers });
    };
    const mountedList = await memberRequest(`/api/v1/groups/${grantee.id}/mailing-lists?limit=50`);
    expect(mountedList.status, await mountedList.clone().text()).toBe(200);
    expect((await mountedList.json()) as { subscriptions: Array<{ mailingList: { id: string } }> }).toMatchObject({
      subscriptions: expect.arrayContaining([
        expect.objectContaining({ mailingList: expect.objectContaining({ id: list.id }) }),
      ]),
    });
    const sharedPage = await listEffectiveGroupMailingListSubscriptions(env.DB, userId, grantee.id, {
      limit: 50,
      offset: 0,
    });
    expect(sharedPage.subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mailingList: expect.objectContaining({ id: list.id }),
          eligible: true,
        }),
      ]),
    );
    const wrongContext = await memberRequest(`/api/v1/groups/${owner.id}/mailing-lists/${list.id}/subscription`, {
      method: "PUT",
      body: JSON.stringify({ preference: "subscribed" }),
    });
    expect(wrongContext.status).toBe(404);
    const subscribed = await memberRequest(`/api/v1/groups/${grantee.id}/mailing-lists/${list.id}/subscription`, {
      method: "PUT",
      body: JSON.stringify({ preference: "subscribed" }),
    });
    expect(subscribed.status, await subscribed.clone().text()).toBe(200);
    expect(await desiredAction(userId, email)).toBe("add_to_list");

    await revokeResourceGroupGrant(env.DB, admin, owner.id, "mailingList", list.id, {
      granteeGroupId: grantee.id,
      capability: "subscribe",
    });
    expect(await desiredAction(userId, email)).toBe("remove_from_list");
    const revokedPage = await listEffectiveGroupMailingListSubscriptions(env.DB, userId, grantee.id, {
      limit: 50,
      offset: 0,
    });
    expect(revokedPage.subscriptions.some((subscription) => subscription.mailingList.id === list.id)).toBe(false);

    await grantResourceToGroup(env.DB, admin, owner.id, "mailingList", list.id, {
      granteeGroupId: grantee.id,
      capability: "view",
    });
    const viewOnlyPage = await listEffectiveGroupMailingListSubscriptions(env.DB, userId, grantee.id, {
      limit: 50,
      offset: 0,
    });
    expect(viewOnlyPage.subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mailingList: expect.objectContaining({ id: list.id }),
          eligible: false,
        }),
      ]),
    );
    await expect(setMailingListPreference(env.DB, userId, grantee.id, list.id, "subscribed")).rejects.toMatchObject({
      code: "MAILING_LIST_SUBSCRIPTION_INELIGIBLE",
    });
  });

  it("rolls back a subscription preference when the shared capability is revoked before commit", async () => {
    const admin = await insertAdmin();
    const owner = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Race list owner ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const grantee = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Race list grantee ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const userId = await insertUser(env.DB, `race-list-member-${crypto.randomUUID()}@example.test`);
    await addOrganizationCapacity(userId, "A");
    await joinGroup(env.DB, grantee.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    const list = await createMailingList(
      env.DB,
      {
        email: `shared-capability-${crypto.randomUUID()}@lists.example.test`,
        label: "Racing shared list",
        purpose: "group",
        groupId: owner.id,
        subscriptionDefault: "none",
      },
      admin.id,
    );
    await grantResourceToGroup(env.DB, admin, owner.id, "mailingList", list.id, {
      granteeGroupId: grantee.id,
      capability: "subscribe",
    });
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `DELETE FROM mailing_list_group_grants
            WHERE mailing_list_id = ? AND group_id = ? AND capability = 'subscribe'`,
      )
        .bind(list.id, grantee.id)
        .run(),
    );

    await expect(setMailingListPreference(racingDb, userId, grantee.id, list.id, "subscribed")).rejects.toMatchObject({
      status: 409,
      code: "MAILING_LIST_AUTHORIZATION_CHANGED",
    });
    expect(
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM mailing_list_subscription_preferences WHERE mailing_list_id = ? AND user_id = ?",
        [list.id, userId],
      ),
    ).toEqual([{ total: 0 }]);
    expect(await desiredAction(userId, list.email)).toBeNull();
  });
});
