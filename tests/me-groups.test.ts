import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { selfGroupsListQuerySchema, selfGroupsListResponseSchema } from "../assets/shared/schemas/group-participation";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import { buildGroupsPageQuery, createGroup, joinGroup, listSelfGroups } from "../functions/_lib/services/groups";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function adminActor(): Promise<UserBackedAuthAdmin> {
  const id = await insertUser(env.DB, `self-groups-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { identityType: "user", id, email: "self-groups-admin@example.test", role: "admin" };
}

function getAs(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(resetDb);

describe("generic self-service group catalog", () => {
  it("keeps eligibility and paging in D1 and returns all represented Member capacities", async () => {
    const admin = await adminActor();
    const alpha = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Portal Alpha",
      visibility: "public",
      eligibilityMode: "open",
    });
    await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Portal Parent",
      visibility: "public",
      eligibilityMode: "open",
    });
    await createGroup(env.DB, admin, {
      typeKey: "committee",
      name: "Portal Committee",
      visibility: "public",
      eligibilityMode: "open",
    });
    const userId = await insertUser(env.DB, `self-groups-${crypto.randomUUID()}@example.test`);
    const memberAId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Self Group Organization A"),
      "A",
    );
    const memberBId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Self Group Organization B"),
      "B",
    );
    await addRepresentative(env.DB, memberAId, userId);
    await addRepresentative(env.DB, memberBId, userId);
    const token = await createMemberSession(env.DB, userId, `self-groups-${crypto.randomUUID()}`);

    const firstResponse = await getAs(
      token,
      "/api/v1/me/groups?view=catalog&typeKey=working_group&q=Portal&sort=name&limit=1&offset=0",
    );
    expect(firstResponse.status, await firstResponse.clone().text()).toBe(200);
    const firstPage = selfGroupsListResponseSchema.parse(await firstResponse.json());
    expect(firstPage.groups.map((group) => group.name)).toEqual(["Portal Alpha"]);
    expect(firstPage.page).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true });
    expect(new Set(firstPage.groups[0]!.eligibleCapacities.map((capacity) => capacity.memberId))).toEqual(
      new Set([memberAId, memberBId]),
    );
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 4);
    const boundedPage = await listSelfGroups(
      budgeted.db,
      userId,
      selfGroupsListQuerySchema.parse({ view: "catalog", typeKey: "working_group", q: "Portal", limit: 1 }),
    );
    expect(boundedPage.groups).toHaveLength(1);
    expect(budgeted.budget.usedQueries()).toBe(4);

    const secondResponse = await getAs(
      token,
      "/api/v1/me/groups?view=catalog&typeKey=working_group&q=Portal&sort=name&limit=1&offset=1",
    );
    const secondPage = selfGroupsListResponseSchema.parse(await secondResponse.json());
    expect(secondPage.groups.map((group) => group.name)).toEqual(["Portal Parent"]);
    expect(secondPage.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });

    await joinGroup(env.DB, alpha.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    await env.DB.prepare("UPDATE groups SET active = 0 WHERE id = ?").bind(alpha.id).run();
    const joinedResponse = await getAs(token, "/api/v1/me/groups?view=joined&typeKey=working_group");
    const joinedPage = selfGroupsListResponseSchema.parse(await joinedResponse.json());
    expect(joinedPage.groups).toHaveLength(1);
    expect(joinedPage.groups[0]).toMatchObject({ id: alpha.id, active: false });
    expect(new Set(joinedPage.groups[0]!.memberships.map((membership) => membership.memberId))).toEqual(
      new Set([memberAId, memberBId]),
    );

    const invalidSort = await getAs(token, "/api/v1/me/groups?sort=email");
    expect(invalidSort.status).toBe(400);
    expect((await callApi(env, "/api/v1/me/groups")).status).toBe(401);
  });

  it("requires person-level parent participation before discovering a child", async () => {
    const admin = await adminActor();
    const parent = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Participation Parent",
      visibility: "public",
      eligibilityMode: "open",
    });
    const child = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      parentGroupId: parent.id,
      name: "Participation Child",
      visibility: "public",
      eligibilityMode: "open",
    });
    const userId = await insertUser(env.DB, `child-catalog-${crypto.randomUUID()}@example.test`);
    const firstMemberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Parent Capacity Organization"),
      "A",
    );
    const secondMemberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Child Capacity Organization"),
      "B",
    );
    await addRepresentative(env.DB, firstMemberId, userId);
    await addRepresentative(env.DB, secondMemberId, userId);
    const query = selfGroupsListQuerySchema.parse({ q: "Participation", typeKey: "working_group", limit: 50 });

    expect((await listSelfGroups(env.DB, userId, query)).groups.map((group) => group.id)).not.toContain(child.id);
    await joinGroup(env.DB, parent.id, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "selected", memberIds: [firstMemberId] },
      source: "self_service",
      allowManaged: false,
    });
    const afterParentJoin = await listSelfGroups(env.DB, userId, query);
    const discoveredChild = afterParentJoin.groups.find((group) => group.id === child.id);
    expect(new Set(discoveredChild?.eligibleCapacities.map((capacity) => capacity.memberId))).toEqual(
      new Set([firstMemberId, secondMemberId]),
    );
  });

  it("uses the active-user membership index for joined catalog predicates", async () => {
    const query = selfGroupsListQuerySchema.parse({ view: "catalog", typeKey: "working_group", limit: 25 });
    const { view, ...groupQuery } = query;
    const pageQuery = buildGroupsPageQuery(groupQuery, {
      userId: "00000000-0000-4000-8000-000000000001",
      canReadAll: false,
      participationView: view,
    });
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(pageQuery);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, pageQuery.limit, pageQuery.offset)
        .all<{ detail: string }>(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all<{ detail: string }>(),
    ]);
    const plan = [...pagePlan.results, ...countPlan.results].map((row) => row.detail).join("\n");
    expect(plan).toContain("idx_group_memberships_user_active");
  });
});
