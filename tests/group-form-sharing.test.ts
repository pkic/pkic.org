import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createManagedForm,
  createManagedFormPlacement,
  createGroupFormDefinition,
  submitGroupFormResponse,
  updateGroupFormDefinition,
  updateGroupFormPlacement,
} from "../functions/_lib/services/forms";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { grantResourceToGroup, revokeResourceGroupGrant } from "../functions/_lib/services/resource-grants";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertOrgRepresentative, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

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
  const leader = await userActor("group-form-leader");
  await env.DB.prepare(
    `INSERT INTO user_roles
       (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
     VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), leader.id, grantee.id)
    .run();
  return {
    admin,
    owner,
    grantee,
    outsider,
    memberId: member.userId,
    memberToken: await createMemberSession(env.DB, member.userId, `group-form-member-${crypto.randomUUID()}`),
    leader,
    leaderToken: await createAdminSession(env.DB, leader.id, `group-form-leader-${crypto.randomUUID()}`),
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
  it("lets effective group leadership create and edit an owned form without accepting owner overrides", async () => {
    const fixture = await createFixture();
    const leader = await userActor("owner-form-leader");
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
       VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), leader.id, fixture.owner.id)
      .run();
    const token = await createAdminSession(env.DB, leader.id, `owner-form-leader-${crypto.randomUUID()}`);
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
