import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  groupMailingListManagementQuerySchema,
  mailingListResponseSchema,
} from "../assets/shared/schemas/mailing-lists";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import {
  archiveGroupMailingList,
  createGroupMailingList,
  updateGroupMailingList,
} from "../functions/_lib/services/mailing-list-management/commands";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import { createGroup, updateGroup } from "../functions/_lib/services/groups";
import {
  assignLocalGroupLeadership,
  groupManagementCandidateAuthorizationEvidence,
} from "../functions/_lib/services/groups";
import {
  buildMailingListsPageQuery,
  listGroupManagedMailingLists,
} from "../functions/_lib/services/mailing-list-management/read-model";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import {
  activeIdentityIdForMember,
  ensureGroupMembershipCapacity,
  grantGroupLeadershipCapacity,
} from "./helpers/group-leadership";
import { seedPersona } from "./personas/seed";

async function actor(email: string, role = "user"): Promise<UserBackedAuthAdmin> {
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function token(userId: string, raw = crypto.randomUUID()): Promise<string> {
  return createAdminSession(env.DB, userId, raw);
}

async function grantLeadership(
  groupId: string,
  leader: UserBackedAuthAdmin,
  leadershipId = crypto.randomUUID(),
): Promise<string> {
  const leadership = await grantGroupLeadershipCapacity(env.DB, groupId, leader.id, { roleAssignmentId: leadershipId });
  leader.memberId = leadership.memberId;
  return leadershipId;
}

function jsonRequest(path: string, method: string, body: unknown, authToken: string): Promise<Response> {
  return callApi(env, path, {
    method,
    headers: { authorization: `Bearer ${authToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("group mailing-list management routes", () => {
  it("allows a local leader to create, update, and archive only group-owned lists", async () => {
    const globalAdmin = await actor(`mailing-list-local-bootstrap-${crypto.randomUUID()}@example.test`, "admin");
    const group = await createGroup(env.DB, globalAdmin, {
      typeKey: "working_group",
      name: `Local mailing list group ${crypto.randomUUID()}`,
      visibility: "public",
    });
    // A real chair of group: mailing-list management is a chair
    // capability, so the test only means something if the caller holds it.
    const leaderPersona = await seedPersona(env.DB, "groupLead", { groupId: group.id });
    const leader: UserBackedAuthAdmin = {
      identityType: "user",
      id: leaderPersona.userId,
      email: leaderPersona.email,
      role: "user",
      memberId: leaderPersona.capacities[0]!.memberId,
    };
    const leaderToken = leaderPersona.token!;
    const created = await jsonRequest(
      `/api/v1/groups/${group.id}/mailing-lists`,
      "POST",
      {
        email: `local-${crypto.randomUUID()}@lists.example.test`,
        label: "Local discussion",
        purpose: "group",
        primaryDiscussion: true,
        subscriptionDefault: "group_members",
      },
      leaderToken,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const createdBody = mailingListResponseSchema.parse(await created.json());
    const managedPage = await callApi(
      env,
      `/api/v1/groups/${group.id}/mailing-lists/management?q=local&sort=label&limit=1`,
      {
        headers: { authorization: `Bearer ${leaderToken}` },
      },
    );
    expect(managedPage.status, await managedPage.clone().text()).toBe(200);
    expect((await managedPage.json()) as { mailingLists: Array<{ id: string }> }).toMatchObject({
      mailingLists: [{ id: createdBody.mailingList.id }],
    });
    const pageQuery = buildMailingListsPageQuery(
      groupMailingListManagementQuerySchema.parse({ q: "local", active: true }),
      {
        groupId: group.id,
        requiredAuthorization: groupManagementCandidateAuthorizationEvidence(leader, "mailing_lists.group_id"),
      },
    );
    const pageSql = buildOffsetPageSql(pageQuery);
    const plans = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql.pageSql}`)
        .bind(...pageSql.bindings, pageQuery.limit, pageQuery.offset)
        .all<{ detail: string }>(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql.countSql}`)
        .bind(...pageSql.countBindings)
        .all<{ detail: string }>(),
    ]);
    const plan = plans.flatMap((result) => result.results.map((row) => row.detail)).join("\n");
    expect(plan).toContain("idx_mailing_lists_group_active");
    expect(plan).not.toMatch(/SCAN mailing_lists\b/);

    const updated = await jsonRequest(
      `/api/v1/groups/${group.id}/mailing-lists/${createdBody.mailingList.id}`,
      "PATCH",
      { label: "Renamed discussion" },
      leaderToken,
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
    expect(mailingListResponseSchema.parse(await updated.json()).mailingList.label).toBe("Renamed discussion");

    const archived = await callApi(env, `/api/v1/groups/${group.id}/mailing-lists/${createdBody.mailingList.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${leaderToken}` },
    });
    expect(archived.status, await archived.clone().text()).toBe(200);
    expect(
      await queryAll<{ active: number; group_id: string }>(
        env.DB,
        "SELECT active, group_id FROM mailing_lists WHERE id = ?",
        [createdBody.mailingList.id],
      ),
    ).toEqual([{ active: 0, group_id: group.id }]);
  });

  it("allows inherited leadership but denies it after local-only governance", async () => {
    const globalAdmin = await actor(`mailing-list-inherited-bootstrap-${crypto.randomUUID()}@example.test`, "admin");
    const parent = await createGroup(env.DB, globalAdmin, {
      typeKey: "working_group",
      name: `Mailing list parent ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const child = await createGroup(env.DB, globalAdmin, {
      typeKey: "committee",
      parentGroupId: parent.id,
      name: `Mailing list child ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const leader = await actor(`mailing-list-inherited-leader-${crypto.randomUUID()}@example.test`);
    await grantLeadership(parent.id, leader);
    const leaderToken = await token(leader.id);
    const created = await jsonRequest(
      `/api/v1/groups/${child.id}/mailing-lists`,
      "POST",
      {
        email: `inherited-${crypto.randomUUID()}@lists.example.test`,
        label: "Inherited list",
        purpose: "group",
      },
      leaderToken,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const managedPage = await callApi(env, `/api/v1/groups/${child.id}/mailing-lists/management`, {
      headers: { authorization: `Bearer ${leaderToken}` },
    });
    expect(managedPage.status, await managedPage.clone().text()).toBe(200);

    const localLeader = await actor(`mailing-list-local-only-leader-${crypto.randomUUID()}@example.test`);
    localLeader.memberId = await ensureGroupMembershipCapacity(env.DB, child.id, localLeader.id);
    await assignLocalGroupLeadership(env.DB, globalAdmin, child.id, {
      userId: localLeader.id,
      identityId: await activeIdentityIdForMember(env.DB, localLeader.id, localLeader.memberId!),
      roleId: "role-group_lead",
    });
    await updateGroup(env.DB, globalAdmin, child.id, { governanceInheritanceMode: "local_only" });
    const denied = await jsonRequest(
      `/api/v1/groups/${child.id}/mailing-lists`,
      "POST",
      {
        email: `denied-${crypto.randomUUID()}@lists.example.test`,
        label: "Denied list",
        purpose: "group",
      },
      leaderToken,
    );
    expect(denied.status, await denied.clone().text()).toBe(403);
    const deniedPage = await callApi(env, `/api/v1/groups/${child.id}/mailing-lists/management`, {
      headers: { authorization: `Bearer ${leaderToken}` },
    });
    expect(deniedPage.status, await deniedPage.clone().text()).toBe(403);
  });

  it("allows a global staff manager but denies a participant-only session", async () => {
    const staff = await actor(`mailing-list-staff-${crypto.randomUUID()}@example.test`, "admin");
    const group = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Staff managed list group ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const staffToken = await token(staff.id);
    const created = await jsonRequest(
      `/api/v1/groups/${group.id}/mailing-lists`,
      "POST",
      {
        email: `staff-${crypto.randomUUID()}@lists.example.test`,
        label: "Staff list",
        purpose: "group",
      },
      staffToken,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const managedPage = await callApi(env, `/api/v1/groups/${group.id}/mailing-lists/management?active=true`, {
      headers: { authorization: `Bearer ${staffToken}` },
    });
    expect(managedPage.status, await managedPage.clone().text()).toBe(200);
    expect((await managedPage.json()) as { mailingLists: Array<{ active: boolean }> }).toMatchObject({
      mailingLists: [expect.objectContaining({ active: true })],
    });

    const participant = await insertUser(env.DB, `mailing-list-participant-${crypto.randomUUID()}@example.test`);
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, `Mailing list participant ${crypto.randomUUID()}`),
      "A",
    );
    const identityId = await addRepresentative(env.DB, memberId, participant);
    await env.DB.prepare(
      `INSERT INTO group_memberships
         (id, group_id, user_id, identity_id, member_id, source, joined_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'staff', datetime('now'), datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), group.id, participant, identityId, memberId)
      .run();
    const memberToken = await createMemberSession(env.DB, participant, crypto.randomUUID());
    const denied = await jsonRequest(
      `/api/v1/groups/${group.id}/mailing-lists`,
      "POST",
      {
        email: `participant-${crypto.randomUUID()}@lists.example.test`,
        label: "Participant list",
        purpose: "group",
      },
      memberToken,
    );
    expect(denied.status, await denied.clone().text()).toBe(403);
  });

  it("does not allow a manager to mutate a list through the wrong group path", async () => {
    const staff = await actor(`mailing-list-owner-${crypto.randomUUID()}@example.test`, "admin");
    const owner = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Mailing list owner ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const other = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Mailing list other ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const staffToken = await token(staff.id);
    const created = await jsonRequest(
      `/api/v1/groups/${owner.id}/mailing-lists`,
      "POST",
      {
        email: `owned-${crypto.randomUUID()}@lists.example.test`,
        label: "Owned list",
        purpose: "group",
      },
      staffToken,
    );
    const listId = mailingListResponseSchema.parse(await created.json()).mailingList.id;
    const wrongPath = await jsonRequest(
      `/api/v1/groups/${other.id}/mailing-lists/${listId}`,
      "PATCH",
      { label: "Must not move" },
      staffToken,
    );
    expect(wrongPath.status, await wrongPath.clone().text()).toBe(404);
    expect(await queryAll<{ label: string }>(env.DB, "SELECT label FROM mailing_lists WHERE id = ?", [listId])).toEqual(
      [{ label: "Owned list" }],
    );
  });

  it("uses the shared manage grant for a grantee group's list page and mutations", async () => {
    const staff = await actor(`mailing-list-shared-owner-${crypto.randomUUID()}@example.test`, "admin");
    const owner = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Shared mailing-list owner ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const grantee = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Shared mailing-list grantee ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const leader = await actor(`mailing-list-shared-leader-${crypto.randomUUID()}@example.test`);
    await grantLeadership(grantee.id, leader);
    const list = await createGroupMailingList(env.DB, staff, owner.id, {
      email: `shared-${crypto.randomUUID()}@lists.example.test`,
      label: "Shared discussion",
      purpose: "group",
    });
    await grantResourceToGroup(env.DB, staff, owner.id, "mailingList", list.id, {
      granteeGroupId: grantee.id,
      capability: "manage",
    });

    const leaderToken = await token(leader.id);
    const page = await callApi(env, `/api/v1/groups/${grantee.id}/mailing-lists/management?limit=20`, {
      headers: { authorization: `Bearer ${leaderToken}` },
    });
    expect(page.status, await page.clone().text()).toBe(200);
    expect((await page.json()) as { mailingLists: Array<{ id: string }> }).toMatchObject({
      mailingLists: [{ id: list.id }],
    });

    const updated = await jsonRequest(
      `/api/v1/groups/${grantee.id}/mailing-lists/${list.id}`,
      "PATCH",
      { label: "Shared discussion updated" },
      leaderToken,
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
    expect(mailingListResponseSchema.parse(await updated.json()).mailingList.label).toBe("Shared discussion updated");

    await expect(
      updateGroupMailingList(
        mutateBeforeNextBatch(env.DB, () =>
          env.DB.prepare(
            "DELETE FROM mailing_list_group_grants WHERE mailing_list_id = ? AND group_id = ? AND capability = 'manage'",
          )
            .bind(list.id, grantee.id)
            .run(),
        ),
        leader,
        grantee.id,
        list.id,
        { label: "Must not race through" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "MAILING_LIST_AUTHORIZATION_CHANGED" });
    const revoked = await jsonRequest(
      `/api/v1/groups/${grantee.id}/mailing-lists/${list.id}`,
      "PATCH",
      { label: "Must not update" },
      leaderToken,
    );
    expect(revoked.status).toBe(404);
    expect(
      await queryAll<{ label: string }>(env.DB, "SELECT label FROM mailing_lists WHERE id = ?", [list.id]),
    ).toEqual([{ label: "Shared discussion updated" }]);
  });

  it("rejects invalid group-list input at the shared request schema", async () => {
    const staff = await actor(`mailing-list-validation-${crypto.randomUUID()}@example.test`, "admin");
    const group = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Mailing list validation ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const response = await jsonRequest(
      `/api/v1/groups/${group.id}/mailing-lists`,
      "POST",
      {
        email: "not-an-email",
        label: "Invalid",
        purpose: "group",
      },
      await token(staff.id),
    );
    expect(response.status).toBe(400);
  });

  it("rolls back a group-list update when management is revoked before commit", async () => {
    const staff = await actor(`mailing-list-race-bootstrap-${crypto.randomUUID()}@example.test`, "admin");
    const group = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Mailing list race ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const leader = await actor(`mailing-list-race-leader-${crypto.randomUUID()}@example.test`);
    const leadershipId = crypto.randomUUID();
    await grantLeadership(group.id, leader, leadershipId);
    const created = await createGroupMailingList(env.DB, leader, group.id, {
      email: `race-${crypto.randomUUID()}@lists.example.test`,
      label: "Before race",
      purpose: "group",
    });
    const revoke = () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(leadershipId).run();
    await expect(
      updateGroupMailingList(mutateBeforeNextBatch(env.DB, revoke), leader, group.id, created.id, {
        label: "Must not commit",
      }),
    ).rejects.toMatchObject({ status: 409, code: "MAILING_LIST_AUTHORIZATION_CHANGED" });
    expect(
      await queryAll<{ label: string }>(env.DB, "SELECT label FROM mailing_lists WHERE id = ?", [created.id]),
    ).toEqual([{ label: "Before race" }]);
  });

  it("fails a management page when leadership is revoked after preflight", async () => {
    const staff = await actor(`mailing-list-read-race-admin-${crypto.randomUUID()}@example.test`, "admin");
    const group = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Mailing list read race ${crypto.randomUUID()}`,
    });
    const leader = await actor(`mailing-list-read-race-leader-${crypto.randomUUID()}@example.test`);
    const leadershipId = crypto.randomUUID();
    await grantLeadership(group.id, leader, leadershipId);
    await createGroupMailingList(env.DB, leader, group.id, {
      email: `read-race-${crypto.randomUUID()}@lists.example.test`,
      label: "Read race",
      purpose: "group",
    });

    await expect(
      listGroupManagedMailingLists(
        mutateBeforeNextBatch(env.DB, () =>
          env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(leadershipId).run(),
        ),
        leader,
        group.id,
        groupMailingListManagementQuerySchema.parse({}),
      ),
    ).rejects.toMatchObject({ status: 403, code: "GROUP_MANAGEMENT_REQUIRED" });
  });

  it("rejects a group-route request that attempts to change ownership", async () => {
    const staff = await actor(`mailing-list-command-${crypto.randomUUID()}@example.test`, "admin");
    const group = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Mailing list command ${crypto.randomUUID()}`,
    });
    const other = await createGroup(env.DB, staff, {
      typeKey: "working_group",
      name: `Mailing list command other ${crypto.randomUUID()}`,
    });
    const created = await createGroupMailingList(env.DB, staff, group.id, {
      email: `command-${crypto.randomUUID()}@lists.example.test`,
      label: "Command list",
      purpose: "group",
    });
    const response = await jsonRequest(
      `/api/v1/groups/${group.id}/mailing-lists/${created.id}`,
      "PATCH",
      { groupId: other.id },
      await token(staff.id),
    );
    expect(response.status).toBe(400);
    expect(
      await queryAll<{ group_id: string }>(env.DB, "SELECT group_id FROM mailing_lists WHERE id = ?", [created.id]),
    ).toEqual([{ group_id: group.id }]);
    await archiveGroupMailingList(env.DB, staff, group.id, created.id);
  });
});
