import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { MAX_PAGE_LIMIT } from "../assets/shared/schemas/pagination";
import { buildOffsetPageSql, type OffsetPageQuery } from "../functions/_lib/db/pagination";
import { buildOrganizationsPageQuery } from "../functions/_lib/services/organization-management/read-model";
import { buildUsersPageQuery } from "../functions/_lib/services/user-management-list";
import {
  buildEventRegistrationStatsQuery,
  buildManagedEventsPageQuery,
} from "../functions/_lib/services/events/catalog";
import { buildGroupsPageQuery } from "../functions/_lib/services/groups/read-model";
import { buildUserOrganizationsPageQuery } from "../functions/_lib/services/user-organizations";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate, addRepresentative } from "./helpers/membership";

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
    const { eventId } = await seedEventAndAdmin(env.DB);
    const eventIds = [eventId, ...Array.from({ length: MAX_PAGE_LIMIT - 1 }, (_, index) => `event-${index}`)];
    const pageQuery = buildManagedEventsPageQuery(
      { userId: "admin-user", canReadAll: true },
      { limit: MAX_PAGE_LIMIT, offset: 0 },
    );
    expect(pageQuery.limit).toBe(200);
    await explainOffsetPage(pageQuery);

    const statsQuery = buildEventRegistrationStatsQuery(eventIds);
    expect(statsQuery.sql).toContain("e.id IN (SELECT value FROM json_each(?))");
    expect(occurrences(statsQuery.sql, /\?/g)).toBe(1);
    expect(statsQuery.bindings).toHaveLength(1);
    expect(JSON.parse(statsQuery.bindings[0])).toEqual(eventIds);

    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${statsQuery.sql}`)
      .bind(...statsQuery.bindings)
      .all();
    expect(plan.results.length).toBeGreaterThan(0);
    expect(plan.results.map((row) => String((row as { detail?: unknown }).detail)).join("\n")).toContain(
      "idx_invites_event_status",
    );
    await expect(
      env.DB.prepare(statsQuery.sql)
        .bind(...statsQuery.bindings)
        .all(),
    ).resolves.toMatchObject({
      results: [
        {
          event_id: eventId,
          total_registrations: 0,
          confirmed_registrations: 0,
          pending_invites: 0,
        },
      ],
    });
  });

  it("counts organizations without roster or primary-contact projections", async () => {
    const { pageSql, countSql, bindings, countBindings } = await explainOffsetPage(
      buildOrganizationsPageQuery({ limit: 25, offset: 50, q: "Consortium", sort: "-identity_count" }),
    );

    expect(pageSql).toMatch(/identities|primary_contact|active_identity_count/i);
    expect(countSql).toMatch(/^SELECT COUNT\(\*\) AS total\s+FROM organizations o/i);
    expect(countSql).not.toMatch(/identities|primary_contact|members\s+m|active_identity_count/i);
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings.slice(1));
  });

  it("counts users from canonical filters without membership or participation projections", async () => {
    const { pageSql, countSql, bindings, countBindings } = await explainOffsetPage(
      buildUsersPageQuery({
        role: "user",
        type: "contact_only",
        q: "contact@example.test",
        sort: "email",
        limit: 20,
        offset: 40,
      }),
    );

    expect(pageSql).toMatch(/organization_names|has_event_participation|active_identity_count/i);
    expect(countSql).toMatch(/^SELECT COUNT\(\*\) AS total\s+FROM users u/i);
    expect(countSql).not.toMatch(
      /organization_names|group_concat|has_event_participation|active_identity_count|LEFT JOIN members|member_category_assignments/i,
    );
    expect(countSql).toMatch(/NOT \(EXISTS[\s\S]+identities[\s\S]+event_participant_role_sources/i);
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

  it("counts a user's organizations through the active identity index", async () => {
    const userId = await insertUser(env.DB, "query-plan-user@example.test");
    const organizationId = await insertOrganization(env.DB, "Query Plan Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);

    const { pageSql, countSql, bindings, countBindings, pagePlan } = await explainOffsetPage(
      buildUserOrganizationsPageQuery(userId, { q: "Query", sort: "name", limit: 10, offset: 0 }),
    );

    expect(pageSql).toMatch(/member_category_assignments/i);
    expect(countSql).toMatch(/^SELECT COUNT\(\*\) AS total\s+FROM identities identity/i);
    expect(countSql).not.toMatch(/member_category_assignments/i);
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings);
    const projectionPlan = pagePlan.results.map((row) => String((row as { detail?: unknown }).detail)).join("\n");
    expect(projectionPlan).toContain("idx_identities_user_lifecycle");
  });
});
