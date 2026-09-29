import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { currentUserFormsListResponseSchema } from "../assets/shared/schemas/member-forms";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { createManagedFormPlacement } from "../functions/_lib/services/forms";
import { buildMemberFormPlacementsPageQuery } from "../functions/_lib/services/forms/member-read-model";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function adminActor(): Promise<UserBackedAuthAdmin> {
  const id = await insertUser(env.DB, `current-forms-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { identityType: "user", id, email: "current-forms-admin@example.test", role: "admin" };
}

async function createSurveyForm(title: string): Promise<string> {
  const formId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO forms
       (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
     VALUES (?, ?, 'global', NULL, 'survey', 'active', ?, NULL, datetime('now'), datetime('now'))`,
  )
    .bind(formId, `current-forms-${crypto.randomUUID()}`, title)
    .run();
  return formId;
}

async function createPlacement(
  admin: UserBackedAuthAdmin,
  formId: string,
  ownerGroupId: string,
  overrides: { active?: boolean; opensAt?: string | null; closesAt?: string | null } = {},
): Promise<string> {
  const placement = await createManagedFormPlacement(env.DB, admin.id, formId, {
    ownerGroupId,
    contextType: "group",
    contextRef: ownerGroupId,
    audience: "group_member",
    active: overrides.active ?? true,
    opensAt: overrides.opensAt ?? null,
    closesAt: overrides.closesAt ?? null,
  });
  return placement.id;
}

async function insertSubmission(formId: string, placementId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO form_submissions (id, form_id, placement_id, submitted_by_user_id, context_type, status, submitted_at)
     VALUES (?, ?, ?, ?, 'survey', 'submitted', datetime('now'))`,
  )
    .bind(crypto.randomUUID(), formId, placementId, userId)
    .run();
}

function getAs(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(resetDb);

describe("GET /api/v1/users/current/forms", () => {
  it("unions owner-group membership and submit grants, excluding placements that are not currently open", async () => {
    const admin = await adminActor();
    const ownerGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Forms Owner ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });
    const outsiderGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Forms Outsider ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });
    const granteeGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Forms Grantee ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });
    const sharedOwnerGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Forms Shared Owner ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });

    const userId = await insertUser(env.DB, `current-forms-member-${crypto.randomUUID()}@example.test`);
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Current Forms Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    for (const groupId of [ownerGroup.id, granteeGroup.id]) {
      await joinGroup(env.DB, groupId, {
        actorUserId: userId,
        targetUserId: userId,
        selection: { mode: "all_eligible", confirmed: true },
        source: "self_service",
        allowManaged: false,
      });
    }
    const token = await createMemberSession(env.DB, userId, `current-forms-${crypto.randomUUID()}`);

    // Reachable: caller belongs directly to the owner group; closes later.
    const openFormId = await createSurveyForm("Reachable through my group");
    const openPlacementId = await createPlacement(admin, openFormId, ownerGroup.id, {
      closesAt: "2028-01-01T00:00:00.000Z",
    });
    // Reachable, sorts earlier: shared with a group the caller belongs to via a submit grant.
    const sharedFormId = await createSurveyForm("Shared via a submit grant");
    const sharedPlacementId = await createPlacement(admin, sharedFormId, sharedOwnerGroup.id, {
      closesAt: "2027-01-01T00:00:00.000Z",
    });
    await grantResourceToGroup(env.DB, admin, sharedOwnerGroup.id, "formPlacement", sharedPlacementId, {
      granteeGroupId: granteeGroup.id,
      capability: "submit",
    });
    // Not reachable: caller has no membership or grant into this group at all.
    const outsiderFormId = await createSurveyForm("Not reachable");
    const outsiderPlacementId = await createPlacement(admin, outsiderFormId, outsiderGroup.id);
    // Excluded: reachable but the placement itself is inactive.
    const inactiveFormId = await createSurveyForm("Inactive placement");
    const inactivePlacementId = await createPlacement(admin, inactiveFormId, ownerGroup.id, { active: false });
    // Excluded: reachable but already closed.
    const closedFormId = await createSurveyForm("Already closed");
    const closedPlacementId = await createPlacement(admin, closedFormId, ownerGroup.id, {
      closesAt: "2020-01-01T00:00:00.000Z",
    });
    void outsiderPlacementId;
    void inactivePlacementId;
    void closedPlacementId;

    const response = await getAs(token, "/api/v1/users/current/forms?limit=20&offset=0");
    expect(response.status, await response.clone().text()).toBe(200);
    const page = currentUserFormsListResponseSchema.parse(await response.json());
    const placementIds = page.forms.map((form) => form.placementId);
    expect(placementIds).toContain(openPlacementId);
    expect(placementIds).toContain(sharedPlacementId);
    expect(placementIds).not.toContain(outsiderPlacementId);
    expect(placementIds).not.toContain(inactivePlacementId);
    expect(placementIds).not.toContain(closedPlacementId);
    expect(page.page.total).toBe(2);
    // Sorted by closing time ascending.
    expect(placementIds).toEqual([sharedPlacementId, openPlacementId]);
    const openForm = page.forms.find((form) => form.placementId === openPlacementId)!;
    expect(openForm).toMatchObject({
      formId: openFormId,
      ownerGroupId: ownerGroup.id,
      ownerGroupName: ownerGroup.name,
      acceptingResponses: true,
      hasSubmitted: false,
    });

    // hasSubmitted flips once a submission row exists for this user and placement.
    await insertSubmission(openFormId, openPlacementId, userId);
    const afterSubmission = currentUserFormsListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/forms?limit=20&offset=0")).json(),
    );
    expect(afterSubmission.forms.find((form) => form.placementId === openPlacementId)).toMatchObject({
      hasSubmitted: true,
    });
    // A different user's submission never flips this caller's row.
    const otherUserId = await insertUser(env.DB, `current-forms-other-${crypto.randomUUID()}@example.test`);
    await insertSubmission(sharedFormId, sharedPlacementId, otherUserId);
    const stillFalse = currentUserFormsListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/forms?limit=20&offset=0")).json(),
    );
    expect(stillFalse.forms.find((form) => form.placementId === sharedPlacementId)).toMatchObject({
      hasSubmitted: false,
    });

    // Pagination is bounded.
    const firstPage = currentUserFormsListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/forms?limit=1&offset=0")).json(),
    );
    expect(firstPage.forms).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ limit: 1, offset: 0, total: 2, hasMore: true });
  });

  it("rejects an unauthenticated caller and a session with no active membership", async () => {
    expect((await callApi(env, "/api/v1/users/current/forms")).status).toBe(401);

    const staffOnlyUserId = await insertUser(env.DB, `current-forms-staff-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(staffOnlyUserId).run();
    const staffToken = await createMemberSession(env.DB, staffOnlyUserId, `current-forms-staff-${crypto.randomUUID()}`);
    expect((await getAs(staffToken, "/api/v1/users/current/forms")).status).toBe(403);
  });

  it("uses indexed plans for the cross-group placement union", async () => {
    const pageQuery = buildMemberFormPlacementsPageQuery(crypto.randomUUID(), { limit: 20, offset: 0 });
    const { pageSql, bindings } = buildOffsetPageSql(pageQuery);
    const plan = await queryAll<{ detail: string }>(env.DB, `EXPLAIN QUERY PLAN ${pageSql}`, [
      ...bindings,
      pageQuery.limit,
      pageQuery.offset,
    ]);
    const details = plan.map((row) => row.detail).join("\n");
    expect(details).toMatch(/idx_form_placements_owner_active|idx_form_placement_group_grants_group/);
  });
});
