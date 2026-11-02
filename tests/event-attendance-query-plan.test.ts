import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildOffsetPageSql, queryPage } from "../functions/_lib/db/pagination";
import { buildEventAttendanceRegistrationsPageQuery } from "../functions/_lib/services/registrations/event-attendance-registrations";
import { buildEventRegistrationsPageQuery } from "../functions/_lib/services/registrations/event-registrations";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertOrgRepresentative } from "./helpers/membership";

beforeEach(resetDb);

describe("event attendance registration D1 query plans", () => {
  it("uses qualified shared sorting and the event/status index in both list projections", async () => {
    const sorts = ["display_name", "-status", "-created_at"] as const;
    for (const build of [buildEventAttendanceRegistrationsPageQuery, buildEventRegistrationsPageQuery]) {
      for (const sort of sorts) {
        const query = build("event-id", {
          status: "registered",
          q: "attendee@example.test",
          sort,
          limit: 25,
          offset: 50,
        });
        const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
        const [pagePlan, countPlan] = await Promise.all([
          env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
            .bind(...bindings, query.limit, query.offset)
            .all<{ detail: string }>(),
          env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
            .bind(...countBindings)
            .all<{ detail: string }>(),
        ]);
        for (const plan of [pagePlan, countPlan]) {
          const details = plan.results.map((row) => row.detail).join("\n");
          expect(details).toMatch(/idx_registrations_event_status(?:_created)?/);
          expect(details).not.toContain("SCAN r");
        }
        expect(countSql).not.toMatch(/AS display_name/i);
        expect(countBindings).toEqual(bindings);
      }
    }
  });

  it.each([
    { projection: "attendance", build: buildEventAttendanceRegistrationsPageQuery, search: "Example Research Lab" },
    { projection: "full registration", build: buildEventRegistrationsPageQuery, search: "search-match-" },
  ])("counts every search match independently of the requested $projection page", async ({ build, search }) => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const organizationId = await insertOrganization(env.DB, "Example Research Lab");
    for (let index = 0; index < 4; index++) {
      const { userId } = await insertOrgRepresentative(env.DB, {
        organizationId,
        email: `search-match-${index}@example.test`,
      });
      await env.DB.prepare(
        `INSERT INTO registrations
          (id, event_id, user_id, status, source_type, manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'test', ?, ?, ?)`,
      )
        .bind(
          `search-match-${index}`,
          eventId,
          userId,
          index === 3 ? "cancelled" : "registered",
          `secret-${index}`,
          `2026-10-21T00:00:0${index}.000Z`,
          `2026-10-21T00:00:0${index}.000Z`,
        )
        .run();
    }
    const query = build(eventId, {
      status: "registered",
      q: search,
      sort: "created_at",
      limit: 1,
      offset: 1,
    });
    const page = await queryPage<{ id: string }>(env.DB, query);
    expect(page.rows.map((row) => row.id)).toEqual(["search-match-1"]);
    expect(page.total).toBe(3);
    const beyondLast = await queryPage<{ id: string }>(env.DB, { ...query, offset: 3 });
    expect(beyondLast.rows).toEqual([]);
    expect(beyondLast.total).toBe(3);
  });
});
