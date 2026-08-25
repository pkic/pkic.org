import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { MAX_PAGE_LIMIT } from "../assets/shared/schemas/pagination";
import { buildOffsetPageSql, type OffsetPageQuery } from "../functions/_lib/db/pagination";
import { buildAdminOrganizationsPageQuery } from "../functions/_lib/services/admin-organizations/queries";
import { buildAdminUsersPageQuery } from "../functions/_lib/services/admin-users-list";
import { buildAdminEventsPageQuery, buildAdminEventStatsQuery } from "../functions/_lib/services/events/admin-list";
import { buildGroupsPageQuery } from "../functions/_lib/services/groups/read-model";
import { resetDb } from "./helpers/reset-db";

async function explainOffsetPage(query: OffsetPageQuery) {
  const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
  const [pagePlan, countPlan] = await Promise.all([
    env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
      .bind(...bindings, query.limit, query.offset)
      .all(),
    env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
      .bind(...countBindings)
      .all(),
  ]);
  expect(pagePlan.results.length).toBeGreaterThan(0);
  expect(countPlan.results.length).toBeGreaterThan(0);
  return { pageSql, countSql, bindings, countBindings, pagePlan, countPlan };
}

function occurrences(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

describe("admin list D1 query plans", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("aggregates a maximum-size event page through one JSON binding", async () => {
    const eventIds = Array.from({ length: MAX_PAGE_LIMIT }, (_, index) => `event-${index}`);
    const pageQuery = buildAdminEventsPageQuery({ limit: MAX_PAGE_LIMIT, offset: 0 });
    expect(pageQuery.limit).toBe(200);
    await explainOffsetPage(pageQuery);

    const statsQuery = buildAdminEventStatsQuery(eventIds);
    expect(statsQuery.sql).toContain("e.id IN (SELECT value FROM json_each(?))");
    expect(occurrences(statsQuery.sql, /\?/g)).toBe(1);
    expect(statsQuery.bindings).toHaveLength(1);
    expect(JSON.parse(statsQuery.bindings[0])).toEqual(eventIds);

    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${statsQuery.sql}`)
      .bind(...statsQuery.bindings)
      .all();
    expect(plan.results.length).toBeGreaterThan(0);
    await expect(
      env.DB.prepare(statsQuery.sql)
        .bind(...statsQuery.bindings)
        .all(),
    ).resolves.toMatchObject({
      results: [],
    });
  });

  it("counts organizations without roster or primary-contact projections", async () => {
    const { pageSql, countSql, bindings, countBindings } = await explainOffsetPage(
      buildAdminOrganizationsPageQuery({ limit: 25, offset: 50, q: "Consortium", sort: "-member_count" }),
    );

    expect(pageSql).toMatch(/organization_representatives|primary_contact|member_count/i);
    expect(countSql).toMatch(/^SELECT COUNT\(\*\) AS total\s+FROM organizations o/i);
    expect(countSql).not.toMatch(/organization_representatives|primary_contact|members\s+m|member_count/i);
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings.slice(1));
  });

  it("counts users from canonical filters without membership or participation projections", async () => {
    const { pageSql, countSql, bindings, countBindings } = await explainOffsetPage(
      buildAdminUsersPageQuery({
        role: "user",
        type: "contact_only",
        q: "contact@example.test",
        sort: "email",
        limit: 20,
        offset: 40,
      }),
    );

    expect(pageSql).toMatch(/event_participation_count|COUNT\(DISTINCT ep\.event_id\)|ORDER BY r2\.joined_at/i);
    expect(countSql).toMatch(/^SELECT COUNT\(\*\) AS total\s+FROM users u/i);
    expect(countSql).not.toMatch(
      /event_participation_count|COUNT\(DISTINCT ep\.event_id\)|ORDER BY r2\.joined_at|LEFT JOIN members|member_category_assignments/i,
    );
    expect(countSql).toMatch(/NOT \(EXISTS[\s\S]+organization_representatives[\s\S]+event_participant_role_sources/i);
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings);
  });

  it("counts canonical groups without participation, child, or leadership projections", async () => {
    const { pageSql, countSql, bindings, countBindings, pagePlan } = await explainOffsetPage(
      buildGroupsPageQuery({
        active: true,
        q: "cryptography",
        sort: "-participant_count",
        limit: 15,
        offset: 30,
      }),
    );

    expect(pageSql).toMatch(/group_memberships|membership_capacity_count|participant_count|child_count/i);
    expect(countSql).toMatch(/^SELECT COUNT\(\*\) AS total\s+FROM groups g/i);
    expect(countSql).not.toMatch(/group_memberships|membership_capacity_count|participant_count|child_count/i);
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings);
    const projectionPlan = pagePlan.results.map((row) => String((row as { detail?: unknown }).detail)).join("\n");
    expect(projectionPlan).toContain("idx_group_memberships_group_active");
    expect(projectionPlan).toContain("idx_groups_parent_active");
  });
});
