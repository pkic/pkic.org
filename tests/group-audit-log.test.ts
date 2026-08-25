import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { scopedAuditLogListQuerySchema } from "../assets/shared/schemas/audit-log";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { writeAuditLog } from "../functions/_lib/services/audit";
import { buildExactScopedAuditLogPageQuery } from "../functions/_lib/services/audit-log-read";
import { createGroup, updateGroup } from "../functions/_lib/services/groups";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function userActor(label: string, role = "user"): Promise<UserBackedAuthAdmin> {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

function authenticatedRequest(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(resetDb);

describe("group-scoped audit log", () => {
  it("reuses exact filters and inherited management without leaking another group", async () => {
    const admin = await userActor("group-audit-admin", "admin");
    const parent = await createGroup(env.DB, admin, {
      typeKey: "community",
      name: `Audit parent ${crypto.randomUUID()}`,
    });
    const child = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      parentGroupId: parent.id,
      name: `Audit child ${crypto.randomUUID()}`,
    });
    const other = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Audit other ${crypto.randomUUID()}`,
    });
    const leader = await userActor("group-audit-leader");
    const outsider = await userActor("group-audit-outsider");
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
       VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), leader.id, parent.id)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
       VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), outsider.id, other.id)
      .run();
    const leaderToken = await createAdminSession(env.DB, leader.id, `group-audit-leader-${crypto.randomUUID()}`);
    const outsiderToken = await createAdminSession(env.DB, outsider.id, `group-audit-outsider-${crypto.randomUUID()}`);

    await writeAuditLog(
      env.DB,
      "admin",
      admin.id,
      "form_response_viewed",
      "form_submission",
      "submission-target",
      { reason: "needle-target" },
      { type: "group", id: child.id },
    );
    await writeAuditLog(
      env.DB,
      "admin",
      admin.id,
      "form_response_viewed",
      "form_submission",
      "submission-other",
      { reason: "needle-other" },
      { type: "group", id: other.id },
    );

    const query = new URLSearchParams({
      q: "needle",
      entityType: "form_submission",
      actorType: "admin",
      action: "form_response_viewed",
      entityId: "submission-target",
      sort: "-action",
      limit: "1",
      offset: "0",
    });
    const response = await authenticatedRequest(
      leaderToken,
      `/api/v1/groups/${child.slug}/audit-log?${query.toString()}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      auditLog: [{ entity_id: "submission-target", details: { reason: { from: null, to: "needle-target" } } }],
      page: { limit: 1, offset: 0, total: 1, hasMore: false },
    });

    const denied = await authenticatedRequest(outsiderToken, `/api/v1/groups/${child.id}/audit-log`);
    expect(denied.status).toBe(403);
    const anonymous = await callApi(env, `/api/v1/groups/${child.id}/audit-log`);
    expect(anonymous.status).toBe(401);
    const missing = await authenticatedRequest(leaderToken, "/api/v1/groups/does-not-exist/audit-log");
    expect(missing.status).toBe(404);
  });

  it("uses the exact-scope index and respects local-only governance", async () => {
    const admin = await userActor("group-audit-plan-admin", "admin");
    const parent = await createGroup(env.DB, admin, {
      typeKey: "community",
      name: `Audit plan parent ${crypto.randomUUID()}`,
    });
    const localOnlyChild = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      parentGroupId: parent.id,
      name: `Audit local only ${crypto.randomUUID()}`,
    });
    const parentLeader = await userActor("group-audit-parent-leader");
    const localLeader = await userActor("group-audit-local-leader");
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
       VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), parentLeader.id, parent.id)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
       VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), localLeader.id, localOnlyChild.id)
      .run();
    await updateGroup(env.DB, admin, localOnlyChild.id, { governanceInheritanceMode: "local_only" });
    const parentLeaderToken = await createAdminSession(
      env.DB,
      parentLeader.id,
      `group-audit-parent-leader-${crypto.randomUUID()}`,
    );

    await writeAuditLog(
      env.DB,
      "admin",
      admin.id,
      "group_policy_updated",
      "group",
      localOnlyChild.id,
      { reason: "needle-plan" },
      { type: "group", id: localOnlyChild.id },
    );
    const parsedQuery = scopedAuditLogListQuerySchema.parse({
      q: "needle",
      action: "group_policy_updated",
      limit: 20,
    });
    const pageQuery = buildExactScopedAuditLogPageQuery("group", localOnlyChild.id, parsedQuery);
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
    expect(plan).toContain("idx_audit_log_scope");

    const denied = await authenticatedRequest(parentLeaderToken, `/api/v1/groups/${localOnlyChild.id}/audit-log`);
    expect(denied.status).toBe(403);
  });
});
