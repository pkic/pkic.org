import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { userCatalogListQuerySchema, userCatalogListResponseSchema } from "../assets/shared/schemas/user-catalog";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { createGroup, updateGroup } from "../functions/_lib/services/groups";
import { buildUserCatalogPageQuery, listGroupUserCatalog } from "../functions/_lib/services/user-catalog";
import type { AuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function actor(email: string, role = "user"): Promise<AuthAdmin> {
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function grantLeadership(groupId: string, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_roles
       (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
     VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
  )
    .bind(id, userId, groupId)
    .run();
  return id;
}

beforeEach(resetDb);

describe("group user catalog", () => {
  it("returns a data-minimized, server-searched page only to the selected group's managers", async () => {
    const root = await actor(`catalog-root-${crypto.randomUUID()}@example.test`, "admin");
    const manager = await actor(`catalog-manager-${crypto.randomUUID()}@example.test`);
    const outsider = await actor(`catalog-outsider-${crypto.randomUUID()}@example.test`);
    const group = await createGroup(env.DB, root, {
      typeKey: "working_group",
      name: `Catalog ${crypto.randomUUID()}`,
    });
    const unrelated = await createGroup(env.DB, root, {
      typeKey: "working_group",
      name: `Unrelated ${crypto.randomUUID()}`,
    });
    await grantLeadership(group.id, manager.id);
    await grantLeadership(unrelated.id, outsider.id);

    const targetId = await insertUser(env.DB, `catalog-primary-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare(
      `UPDATE users
          SET first_name = 'Ada', last_name = 'Lovelace', organization_name = 'Analytical Engines'
        WHERE id = ?`,
    )
      .bind(targetId)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_emails
         (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
       VALUES (?, ?, ?, ?, datetime('now'), 'test', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), targetId, "catalog-alias@example.test", "catalog-alias@example.test")
      .run();
    const inactiveId = await insertUser(env.DB, `catalog-inactive-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(inactiveId).run();

    const managerToken = await createAdminSession(env.DB, manager.id, `manager-${crypto.randomUUID()}`);
    const outsiderToken = await createAdminSession(env.DB, outsider.id, `outsider-${crypto.randomUUID()}`);
    const response = await callApi(
      env,
      `/api/v1/groups/${group.slug}/user-catalog?q=catalog-alias&sort=email&limit=1`,
      {
        headers: { authorization: `Bearer ${managerToken}` },
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const payload = userCatalogListResponseSchema.parse(await response.json());
    expect(payload.users).toEqual([
      {
        id: targetId,
        email: expect.stringContaining("catalog-primary-"),
        first_name: "Ada",
        last_name: "Lovelace",
        organization_name: "Analytical Engines",
      },
    ]);
    expect(Object.keys(payload.users[0]).sort()).toEqual([
      "email",
      "first_name",
      "id",
      "last_name",
      "organization_name",
    ]);
    expect(payload.page).toMatchObject({ limit: 1, offset: 0, total: 1, hasMore: false });

    expect(
      (
        await callApi(env, `/api/v1/groups/${group.id}/user-catalog?q=catalog`, {
          headers: { authorization: `Bearer ${outsiderToken}` },
        })
      ).status,
    ).toBe(403);
    expect((await callApi(env, `/api/v1/groups/${group.id}/user-catalog?q=catalog`)).status).toBe(401);
    expect(
      (
        await callApi(env, `/api/v1/groups/${group.id}/user-catalog?sort=role`, {
          headers: { authorization: `Bearer ${managerToken}` },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await callApi(env, `/api/v1/groups/${group.id}/user-catalog?limit=9&q=catalog`, {
          headers: { authorization: `Bearer ${managerToken}` },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await callApi(env, `/api/v1/groups/${group.id}/user-catalog`, {
          headers: { authorization: `Bearer ${managerToken}` },
        })
      ).status,
    ).toBe(400);
    const inactiveResponse = await callApi(env, `/api/v1/groups/${group.id}/user-catalog?q=catalog-inactive`, {
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(((await inactiveResponse.json()) as { users: unknown[] }).users).toEqual([]);
  });

  it("honors inherited leadership and fails closed when that authority is revoked before the page batch", async () => {
    const root = await actor(`catalog-parent-root-${crypto.randomUUID()}@example.test`, "admin");
    const leader = await actor(`catalog-parent-leader-${crypto.randomUUID()}@example.test`);
    const parent = await createGroup(env.DB, root, {
      typeKey: "working_group",
      name: `Catalog parent ${crypto.randomUUID()}`,
    });
    const child = await createGroup(env.DB, root, {
      typeKey: "working_group",
      name: `Catalog child ${crypto.randomUUID()}`,
      parentGroupId: parent.id,
    });
    const localOnlyChild = await createGroup(env.DB, root, {
      typeKey: "working_group",
      name: `Catalog local child ${crypto.randomUUID()}`,
      parentGroupId: parent.id,
    });
    const roleId = await grantLeadership(parent.id, leader.id);
    await grantLeadership(localOnlyChild.id, root.id);
    await updateGroup(env.DB, root, localOnlyChild.id, { governanceInheritanceMode: "local_only" });

    const inherited = await listGroupUserCatalog(
      env.DB,
      leader,
      child.id,
      userCatalogListQuerySchema.parse({ q: "catalog-parent" }),
    );
    expect(inherited.users.some((user) => user.id === leader.id)).toBe(true);
    await expect(
      listGroupUserCatalog(
        env.DB,
        leader,
        localOnlyChild.id,
        userCatalogListQuerySchema.parse({ q: "catalog-parent" }),
      ),
    ).rejects.toMatchObject({ status: 403, code: "GROUP_MANAGEMENT_REQUIRED" });

    await expect(
      listGroupUserCatalog(
        mutateBeforeNextBatch(env.DB, () =>
          env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(roleId).run(),
        ),
        leader,
        child.id,
        userCatalogListQuerySchema.parse({ q: "catalog-parent" }),
      ),
    ).rejects.toMatchObject({ status: 403, code: "GROUP_MANAGEMENT_REQUIRED" });
  });

  it("builds deterministic bounded D1 page and count queries", async () => {
    const query = buildUserCatalogPageQuery(
      userCatalogListQuerySchema.parse({ q: "example.test", sort: "last_name", limit: 8, offset: 0 }),
    );
    const sql = buildOffsetPageSql(query);
    expect(sql.pageSql).toContain("ORDER BY last_name ASC, u.id ASC");
    expect(sql.pageSql).toContain("LIMIT ? OFFSET ?");
    expect(sql.countSql).not.toContain("ORDER BY");
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql.pageSql}`)
      .bind(...sql.bindings, query.limit, query.offset)
      .all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail).join("\n")).toContain("idx_user_emails_user");
  });
});
