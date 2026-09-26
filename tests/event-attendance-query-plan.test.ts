import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { buildEventAttendanceRegistrationsPageQuery } from "../functions/_lib/services/registrations/event-attendance-registrations";
import { buildEventRegistrationsPageQuery } from "../functions/_lib/services/registrations/event-registrations";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

describe("event attendance registration D1 query plans", () => {
  it("uses qualified shared sorting and the event/status index in both list projections", async () => {
    const sorts = ["display_name", "-status", "attendance_type", "-created_at"] as const;
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
        expect(countSql).not.toMatch(/display_name|ORDER BY|LIMIT|OFFSET/i);
        expect(countBindings).toEqual(bindings);
      }
    }
  });
});
