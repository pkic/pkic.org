import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { scopedAuditLogListQuerySchema } from "../assets/shared/schemas/audit-log";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { writeAuditLog } from "../functions/_lib/services/audit";
import { buildExactScopedAuditLogPageQuery } from "../functions/_lib/services/audit-log-read";
import { createGroup, updateGroup } from "../functions/_lib/services/groups";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { insertUser } from "./helpers/membership";
import { seedPersona } from "./personas/seed";
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
    // Two chairs, each of a different group: the one under test, and one who
    // must see nothing of it.
    const leader = await seedPersona(env.DB, "groupLead", { groupId: parent.id });
    const outsider = await seedPersona(env.DB, "groupLead", { groupId: other.id });
    const leaderToken = leader.token!;
    const outsiderToken = outsider.token!;

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

  it("resolves every user-backed actor type to a display name, not a bare user id", async () => {
    const admin = await userActor("group-audit-actor-admin", "admin");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Audit actors ${crypto.randomUUID()}`,
    });
    const leader = await seedPersona(env.DB, "groupLead", { groupId: group.id });
    // A non-staff participant with a full name, as a real member would have.
    const participant = await seedPersona(env.DB, "groupParticipant", { groupId: group.id });
    await env.DB.prepare("UPDATE users SET first_name = 'Mira', last_name = 'Okafor' WHERE id = ?")
      .bind(participant.userId)
      .run();
    // A user-typed actor without a last name falls back to the first name.
    const proposerId = await insertUser(env.DB, `proposer-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET first_name = 'Solo', last_name = NULL WHERE id = ?").bind(proposerId).run();
    // A user without any name falls back to the email.
    const emailOnlyId = await insertUser(env.DB, `email-only-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET first_name = NULL, last_name = NULL WHERE id = ?").bind(emailOnlyId).run();
    const emailOnly = (await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(emailOnlyId).first<{
      email: string;
    }>())!.email;

    const scope = { type: "group", id: group.id };
    await writeAuditLog(
      env.DB,
      "member",
      participant.userId,
      "group_form_response_submitted",
      "form_submission",
      "s1",
      {},
      scope,
    );
    await writeAuditLog(env.DB, "user", proposerId, "group_join_requested", "group_membership", "m1", {}, scope);
    await writeAuditLog(env.DB, "member", emailOnlyId, "group_left", "group_membership", "m2", {}, scope);
    await writeAuditLog(env.DB, "system", null, "group_membership_expired", "group_membership", "m3", {}, scope);

    const response = await authenticatedRequest(
      leader.token!,
      `/api/v1/groups/${group.id}/audit-log?sort=actor&limit=20`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      auditLog: Array<{ action: string; actor_type: string; actor_id: string | null; actor_display: string | null }>;
    };
    // Group creation and the persona joins wrote their own scoped entries;
    // none of them may reach the table's bare-id fallback either.
    for (const entry of body.auditLog) {
      if (entry.actor_id) expect(entry.actor_display, `${entry.action} by ${entry.actor_type}`).toBeTruthy();
    }
    const seededActions = new Set([
      "group_form_response_submitted",
      "group_join_requested",
      "group_left",
      "group_membership_expired",
    ]);
    expect(
      body.auditLog
        .filter((entry) => seededActions.has(entry.action))
        .map(({ actor_type, actor_id, actor_display }) => ({ actor_type, actor_id, actor_display })),
    ).toEqual([
      { actor_type: "system", actor_id: null, actor_display: null },
      { actor_type: "member", actor_id: emailOnlyId, actor_display: emailOnly },
      { actor_type: "member", actor_id: participant.userId, actor_display: "Mira Okafor" },
      { actor_type: "user", actor_id: proposerId, actor_display: "Solo" },
    ]);

    // The actor name is searchable for non-staff actors as well.
    const searched = await authenticatedRequest(leader.token!, `/api/v1/groups/${group.id}/audit-log?q=okafor`);
    expect(await searched.json()).toMatchObject({
      auditLog: [{ actor_id: participant.userId, actor_display: "Mira Okafor" }],
      page: { total: 1 },
    });
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
    // The parent's chair, and a chair local to the child. Local-only
    // governance must stop the former reaching the latter's group.
    const parentLeader = await seedPersona(env.DB, "groupLead", { groupId: parent.id });
    await seedPersona(env.DB, "groupLead", { groupId: localOnlyChild.id });
    await updateGroup(env.DB, admin, localOnlyChild.id, { governanceInheritanceMode: "local_only" });
    const parentLeaderToken = parentLeader.token!;

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
