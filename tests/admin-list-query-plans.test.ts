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
import { buildOrganizationGroupsPageQuery } from "../functions/_lib/services/organization-activity/group-participation";
import { buildOrganizationEventsPageQuery } from "../functions/_lib/services/organization-activity/event-participation";
import { buildOrganizationProposalsPageQuery } from "../functions/_lib/services/organization-activity/proposal-submissions";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
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
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    const eventIds = [eventId, ...Array.from({ length: MAX_PAGE_LIMIT - 1 }, (_, index) => `event-${index}`)];
    const pageQuery = buildManagedEventsPageQuery({ userId: admin.id, admin }, { limit: MAX_PAGE_LIMIT, offset: 0 });
    expect(pageQuery.limit).toBe(200);
    await explainOffsetPage(pageQuery);

    const statsQuery = buildEventRegistrationStatsQuery(eventIds);
    expect(statsQuery.sql).toContain("e.id IN (SELECT value FROM json_each(?))");
    expect(occurrences(statsQuery.sql, /\?/g)).toBe(1);
    expect(statsQuery.bindings).toHaveLength(1);
    expect(JSON.parse(String(statsQuery.bindings[0]))).toEqual(eventIds);

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
    expect(countSql).toMatch(/NOT \(u\.id IN[\s\S]+identities[\s\S]+event_participant_role_sources/i);
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings);
  });

  describe("rows read at directory scale", () => {
    const PEOPLE = 200;
    const STAMP = "2026-01-01T00:00:00.000Z";
    /** One pass over the views, never one pass per person or per organization. */
    const ROWS_PER_PERSON = 40;
    const numbered = (select: string) =>
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${PEOPLE}) ${select}`;

    beforeEach(async () => {
      const { eventId } = await seedEventAndAdmin(env.DB);
      // Person 2's domain matches person 1's, so organizations 1 and 2 are related. Odd people are members.
      const domain = "'domain' || CASE WHEN i = 2 THEN 1 ELSE i END || '.test'";
      await env.DB.batch([
        env.DB.prepare(
          numbered(`INSERT INTO users (id, email, normalized_email, active, created_at, updated_at)
            SELECT 'user-' || i, 'user' || i || '@' || ${domain}, 'user' || i || '@' || ${domain}, 1, '${STAMP}', '${STAMP}' FROM n`),
        ),
        env.DB.prepare(
          numbered(`INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
            SELECT 'org-' || i, 'Org ' || i, 'org ' || i, '${STAMP}', '${STAMP}' FROM n`),
        ),
        env.DB.prepare(
          numbered(`INSERT INTO identities (id, user_id, organization_id, source, verified_email_domain, invited_at, started_at, created_at, updated_at)
            SELECT 'identity-' || i, 'user-' || i, 'org-' || i, 'verified_email', ${domain}, '${STAMP}', '${STAMP}', '${STAMP}', '${STAMP}' FROM n`),
        ),
        env.DB.prepare(
          numbered(`INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
            SELECT 'member-' || i, 'organization', 'org-' || i, 'active', '${STAMP}', '${STAMP}' FROM n WHERE i % 2 = 1`),
        ),
        env.DB.prepare(
          numbered(`INSERT INTO member_category_assignments (member_id, category_code, created_at, updated_at)
            SELECT 'member-' || i, 'A', '${STAMP}', '${STAMP}' FROM n WHERE i % 2 = 1`),
        ),
        env.DB.prepare(
          numbered(`INSERT INTO event_participants (id, event_id, user_id, role, status, source_type, source_ref, created_at, updated_at)
            SELECT 'participant-' || i, '${eventId}', 'user-' || i, 'attendee', 'active', 'system', 'seed', '${STAMP}', '${STAMP}' FROM n`),
        ),
      ]);
    });

    async function rowsRead(query: OffsetPageQuery): Promise<{ count: number; rowsRead: number }> {
      const { countSql, countBindings } = buildOffsetPageSql(query);
      const profile = profileD1Flow(env.DB, { measureRowsRead: true });
      const [row] = await queryAll<{ total: number }>(profile.db, countSql, countBindings);
      return { count: row!.total, rowsRead: profile.summary().queries[0]!.rowsRead! };
    }

    it("runs the membership and participation views once for a filtered people count", async () => {
      await expect(
        rowsRead(buildUsersPageQuery({ type: "event_attendee", limit: 25, offset: 0 } as never)),
      ).resolves.toMatchObject({
        count: 100,
        rowsRead: expect.toSatisfy((rows: number) => rows < ROWS_PER_PERSON * PEOPLE),
      });
    });

    it("finds related organizations in one pass over every organization's domains", async () => {
      await env.DB.batch([
        env.DB.prepare(
          numbered(`INSERT INTO users (id, email, normalized_email, active, created_at, updated_at)
            SELECT 'staff-' || i, 'staff' || i || '@domain1.test', 'staff' || i || '@domain1.test', 1, '${STAMP}', '${STAMP}' FROM n`),
        ),
        env.DB.prepare(
          numbered(`INSERT INTO identities (id, user_id, organization_id, source, verified_email_domain, invited_at, started_at, created_at, updated_at)
            SELECT 'staff-identity-' || i, 'staff-' || i, 'org-1', 'verified_email', 'domain1.test', '${STAMP}', '${STAMP}', '${STAMP}', '${STAMP}' FROM n`),
        ),
      ]);

      await expect(
        rowsRead(buildOrganizationsPageQuery({ relatedToOrganizationId: "org-1", limit: 25, offset: 0 } as never)),
      ).resolves.toMatchObject({
        count: 1,
        rowsRead: expect.toSatisfy((rows: number) => rows < ROWS_PER_PERSON * PEOPLE),
      });
    });
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
    // A category is required for membership capacity, including the count.
    expect(countSql).toMatch(/JOIN member_category_assignments/i);
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings);
    const projectionPlan = pagePlan.results.map((row) => String((row as { detail?: unknown }).detail)).join("\n");
    expect(projectionPlan).toContain("idx_identities_user_lifecycle");
    expect(projectionPlan).not.toMatch(/SCAN identity\b|CO-ROUTINE identity_member_capacities/);
  });
  it("counts an organization's group participation without its aggregate projection", async () => {
    const { pageSql, countSql, bindings, countBindings, pagePlan } = await explainOffsetPage(
      buildOrganizationGroupsPageQuery("organization-1", {
        q: "cryptography",
        sort: "-representativeCount",
        limit: 25,
        offset: 50,
      }),
    );

    expect(pageSql).toMatch(/representative_count|first_joined_at|latest_joined_at/i);
    expect(countSql).toMatch(/^SELECT COUNT\(DISTINCT g\.id\) AS total\s+FROM identities representative/i);
    expect(countSql).not.toMatch(
      /MIN\(|MAX\(|representative_count|first_joined_at|latest_joined_at|group_types|GROUP BY/i,
    );
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings);

    // Driven from the organization's few identities, never from every active
    // capacity in the system.
    const projectionPlan = pagePlan.results.map((row) => String((row as { detail?: unknown }).detail)).join("\n");
    expect(projectionPlan).toContain("idx_identities_organization_lifecycle");
    expect(projectionPlan).toContain("idx_group_memberships_user_active");
    expect(projectionPlan).not.toMatch(/SCAN (gm|g)\b/);
  });

  it("counts an organization's event participation without the role or registration projections", async () => {
    const { pageSql, countSql, bindings, countBindings, pagePlan } = await explainOffsetPage(
      buildOrganizationEventsPageQuery("organization-1", {
        q: "summit",
        when: "upcoming",
        sort: "-startsAt",
        limit: 25,
        offset: 50,
      }),
    );

    expect(pageSql).toMatch(/group_concat\(DISTINCT activity\.participant_role\)/i);
    expect(countSql).toMatch(/SELECT COUNT\(DISTINCT e\.id\) AS total\s+FROM events e/i);
    expect(countSql).not.toMatch(/group_concat|registration_count|participant_roles|CASE WHEN|GROUP BY/i);
    // The upcoming/past predicate is shared, so the filter cannot drift
    // between the rows shown and the total claimed.
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings);

    const projectionPlan = pagePlan.results.map((row) => String((row as { detail?: unknown }).detail)).join("\n");
    expect(projectionPlan).toContain("idx_identities_organization_lifecycle");
  });

  it("counts an organization's proposals without the proposer join the projection needs", async () => {
    const { pageSql, countSql, bindings, countBindings, pagePlan } = await explainOffsetPage(
      buildOrganizationProposalsPageQuery("organization-1", {
        q: "quantum",
        status: "active",
        sort: "-submittedAt",
        limit: 25,
        offset: 50,
      }),
    );

    expect(pageSql).toMatch(/JOIN users proposer|proposer_email/i);
    expect(countSql).toMatch(/SELECT COUNT\(\*\) AS total\s+FROM session_proposals proposal/i);
    expect(countSql).not.toMatch(/JOIN users proposer|proposer_email|proposer_first_name/i);
    // `status=active` expands to the shared inactive-status list; both
    // statements must bind the identical vocabulary.
    expect(occurrences(pageSql, /INSTR\(/g)).toBe(occurrences(countSql, /INSTR\(/g));
    expect(countBindings).toEqual(bindings);

    const projectionPlan = pagePlan.results.map((row) => String((row as { detail?: unknown }).detail)).join("\n");
    expect(projectionPlan).toContain("idx_identities_organization_lifecycle");
  });
});
