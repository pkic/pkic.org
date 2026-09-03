import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  groupFormSubmissionStatsQuerySchema,
  groupFormSubmissionsQuerySchema,
} from "../assets/shared/schemas/group-forms";
import {
  buildGroupFormPlacementsPageQuery,
  createManagedForm,
  createManagedFormPlacement,
  createGroupFormDefinition,
  getGroupFormDefinition,
  getGroupFormResponseStatistics,
  listGroupFormResponses,
  submitGroupFormResponse,
  updateGroupFormDefinition,
  updateGroupFormPlacement,
} from "../functions/_lib/services/forms";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { grantResourceToGroup, revokeResourceGroupGrant } from "../functions/_lib/services/resource-grants";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { mutateAfterNextStatement, mutateBeforeNextBatch } from "./helpers/database-races";
import { insertOrgRepresentative, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { seedPersona } from "./personas/seed";

interface Fixture {
  admin: UserBackedAuthAdmin;
  owner: Awaited<ReturnType<typeof createGroup>>;
  grantee: Awaited<ReturnType<typeof createGroup>>;
  outsider: Awaited<ReturnType<typeof createGroup>>;
  memberId: string;
  memberToken: string;
  leader: UserBackedAuthAdmin;
  leaderToken: string;
  placementId: string;
}

async function userActor(label: string, role = "user"): Promise<UserBackedAuthAdmin> {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function createPlacedForm(
  admin: UserBackedAuthAdmin,
  ownerGroupId: string,
  purpose: "survey" | "event_registration" = "survey",
): Promise<string> {
  const suffix = crypto.randomUUID();
  const form = await createManagedForm(
    env.DB,
    admin.id,
    { type: "global", ref: null },
    {
      key: `group-form-${suffix}`,
      purpose,
      title: purpose === "survey" ? "Shared group survey" : "Protected registration form",
      status: "active",
      fields: [{ key: "topic", label: "Topic", fieldType: "text", required: true, sortOrder: 0 }],
    },
  );
  const placement = await createManagedFormPlacement(env.DB, admin.id, form.id, {
    ownerGroupId,
    contextType: "group",
    contextRef: ownerGroupId,
    audience: "group_member",
    active: true,
  });
  return placement.id;
}

async function createFixture(): Promise<Fixture> {
  const admin = await userActor("group-form-admin", "admin");
  const owner = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Form owner ${crypto.randomUUID()}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const grantee = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Form grantee ${crypto.randomUUID()}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const outsider = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Form outsider ${crypto.randomUUID()}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const member = await insertOrgRepresentative(env.DB, { category: "A" });
  await joinGroup(env.DB, grantee.id, {
    actorUserId: member.userId,
    targetUserId: member.userId,
    selection: { mode: "all_eligible", confirmed: true },
    source: "self_service",
    allowManaged: false,
  });
  // The grantee group's chair: the sharing assertions turn on what a real
  // chair may reach through a grant, not on what an administrator can do.
  const leaderPersona = await seedPersona(env.DB, "groupLead", { groupId: grantee.id });
  const leader: UserBackedAuthAdmin = {
    identityType: "user",
    id: leaderPersona.userId,
    email: leaderPersona.email,
    role: "user",
    memberId: leaderPersona.capacities[0]!.memberId,
  };
  return {
    admin,
    owner,
    grantee,
    outsider,
    memberId: member.userId,
    memberToken: await createMemberSession(env.DB, member.userId, `group-form-member-${crypto.randomUUID()}`),
    leader,
    leaderToken: leaderPersona.token!,
    placementId: await createPlacedForm(admin, owner.id),
  };
}

function authenticatedRequest(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return callApi(env, path, { ...init, headers });
}

beforeEach(resetDb);

describe("group form sharing", () => {
  it("uses indexed owner, grant, and live-membership paths for the production page and count queries", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view_definition",
    });
    const query = buildGroupFormPlacementsPageQuery({ userId: fixture.memberId }, fixture.grantee.id, {
      active: "true",
      q: "shared",
      sort: "title",
      limit: 20,
      offset: 0,
    });
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, query.limit, query.offset)
        .all<{ detail: string }>(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all<{ detail: string }>(),
    ]);

    for (const plan of [pagePlan, countPlan]) {
      const details = plan.results.map((row) => row.detail).join("\n");
      expect(details).toContain("idx_form_placements_owner_active");
      expect(details).toContain("idx_form_placement_group_grants_group");
      expect(details).toContain("idx_group_memberships_user_active");
      expect(details).not.toMatch(/(?:^|\n)SCAN form_placements(?:$|\s)/);
      expect(details).not.toMatch(/(?:^|\n)SCAN form_placement_group_grants(?:$|\s)/);
      expect(details).not.toMatch(/(?:^|\n)SCAN group_memberships(?:$|\s)/);
    }
  });

  it("lets effective group leadership create and edit an owned form without accepting owner overrides", async () => {
    const fixture = await createFixture();
    // The owning group's own chair, whose authority comes from leading it
    // rather than from any grant.
    const leader = await seedPersona(env.DB, "groupLead", { groupId: fixture.owner.id });
    const token = leader.token!;
    const key = `owned-survey-${crypto.randomUUID()}`;
    const created = await authenticatedRequest(token, `/api/v1/groups/${fixture.owner.id}/forms`, {
      method: "POST",
      body: JSON.stringify({
        key,
        purpose: "survey",
        title: "Architecture survey",
        status: "active",
        ownerGroupId: fixture.outsider.id,
        fields: [{ key: "topic", label: "Topic", fieldType: "text", required: true, sortOrder: 0 }],
      }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const createdBody = (await created.json()) as { placement: { id: string; ownerGroupId: string } };
    expect(createdBody.placement.ownerGroupId).toBe(fixture.owner.id);
    expect(
      await queryAll<{ scope_type: string; scope_ref: string; owner_group_id: string }>(
        env.DB,
        `SELECT form.scope_type, form.scope_ref, placement.owner_group_id
           FROM forms form
           JOIN form_placements placement ON placement.form_id = form.id
          WHERE form.key = ?`,
        [key],
      ),
    ).toEqual([{ scope_type: "community", scope_ref: fixture.owner.id, owner_group_id: fixture.owner.id }]);

    const updated = await authenticatedRequest(
      token,
      `/api/v1/groups/${fixture.owner.id}/forms/${createdBody.placement.id}/definition`,
      {
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated architecture survey",
          fields: [{ key: "priority", label: "Priority", fieldType: "number", required: false, sortOrder: 0 }],
        }),
      },
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
    expect(await updated.json()).toMatchObject({
      form: { key, title: "Updated architecture survey" },
      placement: { ownerGroupId: fixture.owner.id },
      fields: [{ key: "priority", fieldType: "number" }],
    });
  });

  it("keeps a shared form definition owner-controlled even when the grantee may manage its placement", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "manage",
    });

    const response = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}/definition`,
      { method: "PATCH", body: JSON.stringify({ title: "Unauthorized catalogue edit" }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "FORM_DEFINITION_OWNER_REQUIRED" },
    });
  });

  it("rolls back group form creation when leadership is revoked before commit", async () => {
    const fixture = await createFixture();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `UPDATE user_roles SET revoked_at = datetime('now')
          WHERE user_id = ? AND role_id = 'role-group_lead' AND context_type = 'group' AND context_id = ?`,
      )
        .bind(fixture.leader.id, fixture.grantee.id)
        .run(),
    );
    const key = `racing-form-${crypto.randomUUID()}`;
    await expect(
      createGroupFormDefinition(racingDb, fixture.leader, fixture.grantee.id, {
        key,
        purpose: "survey",
        title: "Racing survey",
        status: "active",
        fields: [],
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_FORM_AUTHORIZATION_CHANGED" });
    expect(await queryAll<{ id: string }>(env.DB, "SELECT id FROM forms WHERE key = ?", [key])).toEqual([]);
  });

  it("rolls back definition edits when the owning placement changes before commit", async () => {
    const fixture = await createFixture();
    const key = `ownership-race-${crypto.randomUUID()}`;
    const created = await createGroupFormDefinition(env.DB, fixture.admin, fixture.owner.id, {
      key,
      purpose: "survey",
      title: "Ownership-bound survey",
      status: "active",
      fields: [],
    });
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE form_placements SET owner_group_id = ? WHERE id = ?")
        .bind(fixture.outsider.id, created.placement.id)
        .run(),
    );

    await expect(
      updateGroupFormDefinition(racingDb, fixture.admin, fixture.owner.id, created.placement.id, {
        title: "Stale ownership edit",
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_FORM_AUTHORIZATION_CHANGED" });
    expect(await queryAll<{ title: string }>(env.DB, "SELECT title FROM forms WHERE key = ?", [key])).toEqual([
      { title: "Ownership-bound survey" },
    ]);
  });

  it("uses a context-bound submit grant for discovery, definition, and atomic responses", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "submit",
    });

    const list = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.grantee.id}/forms?q=shared&sort=title&limit=20`,
    );
    expect(list.status, await list.clone().text()).toBe(200);
    expect(await list.json()).toMatchObject({
      forms: [
        {
          placement: { id: fixture.placementId },
          capabilities: ["view_definition", "submit"],
          acceptingResponses: true,
        },
      ],
      page: { total: 1, hasMore: false },
    });

    const wrongContext = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.owner.id}/forms/${fixture.placementId}`,
    );
    expect(wrongContext.status).toBe(404);

    const definition = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}`,
    );
    expect(definition.status, await definition.clone().text()).toBe(200);
    expect(await definition.json()).toMatchObject({
      placement: { id: fixture.placementId },
      fields: [{ key: "topic", required: true }],
    });

    const invalid = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}/submissions`,
      { method: "POST", body: JSON.stringify({ answers: { unknown: "value" } }) },
    );
    expect(invalid.status).toBe(422);

    const submitted = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}/submissions`,
      { method: "POST", body: JSON.stringify({ answers: { topic: "Architecture" } }) },
    );
    expect(submitted.status, await submitted.clone().text()).toBe(201);
    const { submissionId } = (await submitted.json()) as { submissionId: string };
    expect(
      await queryAll<{ scope_id: string; actor_id: string }>(
        env.DB,
        `SELECT scope_id, actor_id FROM audit_log
          WHERE action = 'group_form_response_submitted' AND entity_id = ?`,
        [submissionId],
      ),
    ).toEqual([{ scope_id: fixture.grantee.id, actor_id: fixture.memberId }]);
    // The chair reads the group's audit trail; a non-staff submitter must
    // show up by name, never as a bare user id.
    const auditTrail = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.grantee.id}/audit-log?action=group_form_response_submitted&entityId=${submissionId}`,
    );
    expect(auditTrail.status, await auditTrail.clone().text()).toBe(200);
    expect(await auditTrail.json()).toMatchObject({
      auditLog: [{ actor_type: "member", actor_id: fixture.memberId, actor_display: "Test" }],
      page: { total: 1 },
    });

    await revokeResourceGroupGrant(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "submit",
    });
    const revokedList = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.grantee.id}/forms?limit=20`,
    );
    expect((await revokedList.json()) as { forms: unknown[] }).toMatchObject({ forms: [] });

    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view_definition",
    });
    const deniedSubmit = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}/submissions`,
      { method: "POST", body: JSON.stringify({ answers: { topic: "Denied" } }) },
    );
    expect(deniedSubmit.status).toBe(403);
  });

  it("returns no form fields when live group definition authority changes after the summary read", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view_definition",
    });

    const revokedGrantDb = mutateAfterNextStatement(env.DB, () =>
      env.DB.prepare(
        `DELETE FROM form_placement_group_grants
          WHERE placement_id = ? AND group_id = ? AND capability = 'view_definition'`,
      )
        .bind(fixture.placementId, fixture.grantee.id)
        .run(),
    );
    await expect(
      getGroupFormDefinition(revokedGrantDb, { userId: fixture.memberId }, fixture.grantee.id, fixture.placementId),
    ).rejects.toMatchObject({ status: 404, code: "FORM_NOT_FOUND" });

    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "manage",
    });
    const revokedLeaderDb = mutateAfterNextStatement(env.DB, () =>
      env.DB.prepare(
        `UPDATE user_roles SET revoked_at = datetime('now')
          WHERE user_id = ? AND role_id = 'role-group_lead' AND context_type = 'group' AND context_id = ?`,
      )
        .bind(fixture.leader.id, fixture.grantee.id)
        .run(),
    );
    await expect(
      getGroupFormDefinition(
        revokedLeaderDb,
        { userId: fixture.leader.id, admin: fixture.leader },
        fixture.grantee.id,
        fixture.placementId,
      ),
    ).rejects.toMatchObject({ status: 404, code: "FORM_NOT_FOUND" });

    await env.DB.prepare("UPDATE user_roles SET revoked_at = NULL WHERE user_id = ? AND context_id = ?")
      .bind(fixture.leader.id, fixture.grantee.id)
      .run();
    const revokedMembershipDb = mutateAfterNextStatement(env.DB, () =>
      env.DB.prepare(
        `UPDATE group_memberships
            SET left_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE user_id = ? AND group_id = ? AND left_at IS NULL`,
      )
        .bind(fixture.memberId, fixture.grantee.id)
        .run(),
    );
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view_definition",
    });
    await expect(
      getGroupFormDefinition(
        revokedMembershipDb,
        { userId: fixture.memberId },
        fixture.grantee.id,
        fixture.placementId,
      ),
    ).rejects.toMatchObject({ status: 404, code: "FORM_NOT_FOUND" });
  });

  it("keeps response reporting and placement management separate and owner-immutable", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "submit",
    });
    const submitted = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}/submissions`,
      { method: "POST", body: JSON.stringify({ answers: { topic: "D1" } }) },
    );
    expect(submitted.status).toBe(201);

    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view_responses",
    });
    const responses = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}/submissions?q=D1&limit=20`,
    );
    expect(responses.status, await responses.clone().text()).toBe(200);
    expect(await responses.json()).toMatchObject({
      placement: { id: fixture.placementId },
      submissions: [{ answers: { topic: "D1" } }],
      page: { total: 1 },
    });
    const statistics = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}/submissions/stats?q=D1`,
    );
    expect(statistics.status, await statistics.clone().text()).toBe(200);
    expect(await statistics.json()).toMatchObject({ total: 1, stats: [{ fieldKey: "topic", totalAnswers: 1 }] });

    const reportingCannotManage = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}`,
      { method: "PATCH", body: JSON.stringify({ active: false }) },
    );
    expect(reportingCannotManage.status).toBe(403);

    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "manage",
    });
    const ownershipTransfer = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}`,
      { method: "PATCH", body: JSON.stringify({ ownerGroupId: fixture.outsider.id }) },
    );
    expect(ownershipTransfer.status).toBe(400);
    const updated = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}`,
      { method: "PATCH", body: JSON.stringify({ active: false }) },
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
    expect(await updated.json()).toMatchObject({
      placement: { id: fixture.placementId, ownerGroupId: fixture.owner.id, active: false },
    });
    expect(
      await queryAll<{ scope_id: string }>(
        env.DB,
        `SELECT scope_id FROM audit_log
          WHERE action = 'form_placement_updated' AND entity_id = ? ORDER BY created_at DESC LIMIT 1`,
        [fixture.placementId],
      ),
    ).toEqual([{ scope_id: fixture.grantee.id }]);

    const wrongContext = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.owner.id}/forms/${fixture.placementId}/submissions?limit=20`,
    );
    expect(wrongContext.status).toBe(403);
  });

  it("returns no response data when reporting authority changes after preflight", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "submit",
    });
    await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${fixture.placementId}/submissions`,
      { method: "POST", body: JSON.stringify({ answers: { topic: "Protected response" } }) },
    );
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view_responses",
    });

    const revokedGrantDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `DELETE FROM form_placement_group_grants
          WHERE placement_id = ? AND group_id = ? AND capability = 'view_responses'`,
      )
        .bind(fixture.placementId, fixture.grantee.id)
        .run(),
    );
    await expect(
      listGroupFormResponses(
        revokedGrantDb,
        fixture.leader,
        fixture.grantee.id,
        fixture.placementId,
        groupFormSubmissionsQuerySchema.parse({ limit: 20 }),
      ),
    ).rejects.toMatchObject({ status: 403, code: "RESOURCE_CAPABILITY_REQUIRED" });

    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "view_responses",
    });
    const revokedLeaderDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `UPDATE user_roles SET revoked_at = datetime('now')
          WHERE user_id = ? AND role_id = 'role-group_lead' AND context_type = 'group' AND context_id = ?`,
      )
        .bind(fixture.leader.id, fixture.grantee.id)
        .run(),
    );
    await expect(
      getGroupFormResponseStatistics(
        revokedLeaderDb,
        fixture.leader,
        fixture.grantee.id,
        fixture.placementId,
        groupFormSubmissionStatsQuerySchema.parse({ q: "Protected" }),
      ),
    ).rejects.toMatchObject({ status: 403, code: "RESOURCE_CAPABILITY_REQUIRED" });
  });

  it("rolls back a response when its group grant is revoked before the D1 batch commits", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "submit",
    });
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `DELETE FROM form_placement_group_grants
            WHERE placement_id = ? AND group_id = ? AND capability = 'submit'`,
      )
        .bind(fixture.placementId, fixture.grantee.id)
        .run(),
    );

    await expect(
      submitGroupFormResponse(racingDb, { userId: fixture.memberId }, fixture.grantee.id, fixture.placementId, {
        answers: { topic: "Stale access" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "FORM_SUBMISSION_AUTHORIZATION_CHANGED" });
    expect(
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM form_submissions WHERE placement_id = ?",
        [fixture.placementId],
      ),
    ).toEqual([{ total: 0 }]);
  });

  it("rolls back a placement update when group leadership is revoked before commit", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", fixture.placementId, {
      granteeGroupId: fixture.grantee.id,
      capability: "manage",
    });
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `UPDATE user_roles SET revoked_at = datetime('now')
            WHERE user_id = ? AND role_id = 'role-group_lead' AND context_type = 'group' AND context_id = ?`,
      )
        .bind(fixture.leader.id, fixture.grantee.id)
        .run(),
    );

    await expect(
      updateGroupFormPlacement(racingDb, fixture.leader, fixture.grantee.id, fixture.placementId, { active: false }),
    ).rejects.toMatchObject({ status: 409, code: "FORM_PLACEMENT_AUTHORIZATION_CHANGED" });
    expect(
      await queryAll<{ active: number }>(env.DB, "SELECT active FROM form_placements WHERE id = ?", [
        fixture.placementId,
      ]),
    ).toEqual([{ active: 1 }]);
  });

  it("does not let the generic endpoint bypass registration workflows", async () => {
    const fixture = await createFixture();
    const registrationPlacement = await createPlacedForm(fixture.admin, fixture.owner.id, "event_registration");
    await grantResourceToGroup(env.DB, fixture.admin, fixture.owner.id, "formPlacement", registrationPlacement, {
      granteeGroupId: fixture.grantee.id,
      capability: "submit",
    });
    const bypass = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.grantee.id}/forms/${registrationPlacement}/submissions`,
      { method: "POST", body: JSON.stringify({ answers: { topic: "Bypass" } }) },
    );
    expect(bypass.status).toBe(403);
    expect((await bypass.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "FORM_WORKFLOW_REQUIRED" },
    });
  });
});
