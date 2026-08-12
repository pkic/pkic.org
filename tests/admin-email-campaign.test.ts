import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { getEventBySlug } from "../functions/_lib/services/events";
import { listCampaignRecipients } from "../functions/_lib/services/admin-email-campaign";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";

function countingDatabase(db: DatabaseLike, counts: { dayAttendance: number; dayWaitlist: number }): DatabaseLike {
  function wrapStatement(statement: StatementLike, query: string): StatementLike {
    const normalizedQuery = query.toLowerCase();
    const queryType = normalizedQuery.includes("select rda.registration_id")
      ? "dayAttendance"
      : normalizedQuery.includes("select w.registration_id")
        ? "dayWaitlist"
        : null;

    function countExecution(): void {
      if (queryType) counts[queryType] += 1;
    }

    return {
      bind(...values: unknown[]) {
        return wrapStatement(statement.bind(...values), query);
      },
      async all<T>() {
        countExecution();
        return statement.all<T>();
      },
      async first<T>(columnName?: string) {
        countExecution();
        return statement.first<T>(columnName);
      },
      async run<T>() {
        countExecution();
        return statement.run<T>();
      },
    };
  }

  return {
    prepare(query: string) {
      return wrapStatement(db.prepare(query), query);
    },
    batch(statements) {
      return db.batch(statements);
    },
  };
}

describe("admin email campaign recipients", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loads attendee details for a large event without per-recipient query batches", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const users = Array.from({ length: 101 }, (_, index) => ({
      id: `campaign-user-${index}`,
      email: `campaign-user-${index}@example.test`,
      manageTokenHash: `campaign-manage-token-${index}`,
      registrationId: `campaign-registration-${index}`,
    }));

    await env.DB.batch(
      users.map((user) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(user.id, user.email, user.email, "Campaign", `User ${user.id.split("-").pop()}`),
      ),
    );
    await env.DB.batch(
      users.map((user) =>
        env.DB.prepare(
          `INSERT INTO registrations (
               id, event_id, user_id, status, attendance_type, source_type,
               manage_token_hash, created_at, updated_at
             ) VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
        ).bind(user.registrationId, eventId, user.id, user.manageTokenHash),
      ),
    );

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const enrichmentQueryCounts = { dayAttendance: 0, dayWaitlist: 0 };
    const recipients = await listCampaignRecipients(
      countingDatabase(env.DB, enrichmentQueryCounts),
      event,
      "https://app.test",
      {
        audience: "attendees",
        attendeeStatus: "registered",
        dayWaitlistStatus: "all",
      },
    );

    expect(recipients).toHaveLength(users.length);
    expect(recipients[0].templateData.dayWaitlist).toEqual([]);
    expect(enrichmentQueryCounts.dayAttendance).toBe(1);
    expect(enrichmentQueryCounts.dayWaitlist).toBe(1);
  });
});
