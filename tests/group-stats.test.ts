import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupStatsQuerySchema, groupStatsResponseSchema } from "../assets/shared/schemas/group-statistics";
import { writeAuditLog } from "../functions/_lib/services/audit";
import { buildGroupStatsQuerySet, createGroup, getGroupStatistics } from "../functions/_lib/services/groups";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertOrgRepresentative, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function adminActor(email: string, role = "admin"): Promise<UserBackedAuthAdmin> {
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

beforeEach(resetDb);

describe("group statistics", () => {
  it("computes distinct people separately from membership capacities and scopes historical rows in D1", async () => {
    const admin = await adminActor(`group-stats-admin-${crypto.randomUUID()}@example.test`);
    const group = await createGroup(env.DB, admin, { typeKey: "working_group", name: `Stats ${crypto.randomUUID()}` });
    const active = await insertOrgRepresentative(env.DB, { email: `stats-active-${crypto.randomUUID()}@example.test` });
    const ended = await insertOrgRepresentative(env.DB, { email: `stats-ended-${crypto.randomUUID()}@example.test` });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO group_memberships
           (id, group_id, user_id, identity_id, member_id, source, joined_at, left_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'migration', ?, NULL, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        group.id,
        active.userId,
        active.identityId,
        active.memberId,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
      env.DB.prepare(
        `INSERT INTO group_memberships
           (id, group_id, user_id, identity_id, member_id, source, joined_at, left_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'migration', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        group.id,
        ended.userId,
        ended.identityId,
        ended.memberId,
        "2026-01-01T00:00:00.000Z",
        "2026-02-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "2026-02-01T00:00:00.000Z",
      ),
    ]);
    const historical = groupStatsQuerySchema.parse({
      scope: "historical",
      from: "2026-01-15T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z",
    });
    const stats = await getGroupStatistics(env.DB, admin, group.id, historical);
    expect(stats.participation).toEqual({ people: { count: 2 }, capacities: { count: 2 } });
    expect(stats.window).toEqual({ from: historical.from, to: historical.to });
    expect(groupStatsResponseSchema.parse(stats)).toEqual(stats);
  });

  it("exposes the mounted route only to exact group managers and validates the UTC window", async () => {
    const admin = await adminActor(`group-stats-route-admin-${crypto.randomUUID()}@example.test`);
    const outsider = await adminActor(`group-stats-route-outsider-${crypto.randomUUID()}@example.test`, "user");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Route stats ${crypto.randomUUID()}`,
    });
    const otherGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Other stats ${crypto.randomUUID()}`,
    });
    const { memberId: outsiderMemberId } = await grantGroupLeadershipCapacity(env.DB, otherGroup.id, outsider.id);
    outsider.memberId = outsiderMemberId;
    const adminToken = await createAdminSession(env.DB, admin.id, `group-stats-admin-${crypto.randomUUID()}`);
    const outsiderToken = await createAdminSession(
      env.DB,
      outsider.id,
      `group-stats-outsider-${crypto.randomUUID()}`,
      undefined,
      outsiderMemberId,
    );
    await writeAuditLog(
      env.DB,
      "admin",
      admin.id,
      "group_stats_test_activity",
      "group",
      group.id,
      { test: true },
      { type: "group", id: group.id },
    );
    await writeAuditLog(
      env.DB,
      "admin",
      "api-key",
      "group_stats_service_activity",
      "group",
      group.id,
      { test: true },
      { type: "group", id: group.id },
    );

    const response = await callApi(env, `/api/v1/groups/${group.slug}/stats`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const payload = await response.json();
    expect(groupStatsResponseSchema.parse(payload)).toMatchObject({
      group: { id: group.id },
      scope: "current",
      participation: { people: { count: 0 }, capacities: { count: 0 } },
      activity: { people: { actorCount: 1, actionCount: 2 }, capacities: { joinedCount: 0, leftCount: 0 } },
    });

    expect(
      (
        await callApi(env, `/api/v1/groups/${group.id}/stats`, {
          headers: { authorization: `Bearer ${outsiderToken}` },
        })
      ).status,
    ).toBe(403);
    expect((await callApi(env, `/api/v1/groups/${group.id}/stats`)).status).toBe(401);
    expect(
      (
        await callApi(env, `/api/v1/groups/${group.id}/stats?timezone=Europe%2FAmsterdam`, {
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await callApi(
          env,
          `/api/v1/groups/${group.id}/stats?from=2026-02-01T00%3A00%3A00.000Z&to=2026-01-01T00%3A00%3A00.000Z`,
          {
            headers: { authorization: `Bearer ${adminToken}` },
          },
        )
      ).status,
    ).toBe(400);
  });

  it("fails closed when group management is revoked between preflight and the aggregate batch", async () => {
    const admin = await adminActor(`group-stats-race-admin-${crypto.randomUUID()}@example.test`);
    const leader = await adminActor(`group-stats-race-leader-${crypto.randomUUID()}@example.test`, "user");
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Stats race ${crypto.randomUUID()}`,
    });
    const { roleAssignmentId: roleId, memberId } = await grantGroupLeadershipCapacity(env.DB, group.id, leader.id);
    leader.memberId = memberId;

    await expect(
      getGroupStatistics(
        mutateBeforeNextBatch(env.DB, () =>
          env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(roleId).run(),
        ),
        leader,
        group.id,
        groupStatsQuerySchema.parse({}),
      ),
    ).rejects.toMatchObject({ status: 403, code: "GROUP_MANAGEMENT_REQUIRED" });
  });

  it("uses the group and scope indexes for every aggregate", async () => {
    const query = groupStatsQuerySchema.parse({
      scope: "historical",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });
    const queries = buildGroupStatsQuerySet("10000000-0000-4000-8000-000000000001", query, "2026-02-01T00:00:00.000Z");
    const plans = await Promise.all(
      Object.values(queries).map((statement) =>
        env.DB.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
          .bind(...statement.bindings)
          .all<{ detail: string }>(),
      ),
    );
    const details = plans.flatMap((plan) => plan.results.map((row) => row.detail)).join("\n");
    expect(details).toContain("idx_audit_log_scope");
    expect(details).toMatch(/idx_group_memberships_(group_active|joined_window|left_window)/);
    expect(details).not.toMatch(/SCAN (group_memberships|audit_log)\b/);
  });
});
