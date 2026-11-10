import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { promoteDayWaitlistIfCapacity } from "../functions/_lib/services/registrations/day-waitlist";
import { runWaitlistPromotionCycle } from "../functions/_lib/services/registrations/waitlist-promotions";
import { registrationPopulationFilter } from "../functions/_lib/services/registrations/registration-population-filter";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { resetDb } from "./helpers/reset-db";

const HOLDERS = 300;
const WAITING = 200;
const NOW = "2026-01-01T00:00:00.000Z";
/** Reads per person per day: the seat count and the queue, never one multiplied by the other. */
const ROWS_PER_PERSON = 12;
const CYCLE = { appBaseUrl: "https://app.test", claimWindowHours: 24, limit: 10 };

function numbered(count: number, select: string): string {
  return `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count}) ${select}`;
}

/** One shared queue per day, shaped like an oversubscribed conference. */
async function seedDay(
  eventId: string,
  day: { id: string; capacity: number; holders?: number },
  waiting = WAITING,
): Promise<void> {
  const holders = day.holders ?? HOLDERS;
  const stamp = `'${NOW}'`;
  const prefix = day.id;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 10, ${stamp}, ${stamp})`,
    ).bind(day.id, eventId, `2026-12-0${prefix.slice(-1)}`, day.id, day.capacity),
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       ${numbered(
         holders + waiting,
         `SELECT 'user-' || i, 'user' || i || '@example.test', 'user' || i || '@example.test', 'U', i, ${stamp}, ${stamp} FROM n`,
       )}`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO registrations (id, event_id, user_id, status, source_type, manage_link_secret, created_at, updated_at)
       ${numbered(
         holders + waiting,
         `SELECT 'registration-' || i, '${eventId}', 'user-' || i, 'registered', 'direct', 'secret-' || i, ${stamp}, ${stamp} FROM n`,
       )}`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO event_participants (id, event_id, user_id, role, status, source_type, source_ref, created_at, updated_at)
       ${numbered(
         holders + waiting,
         `SELECT 'participant-' || i, '${eventId}', 'user-' || i, 'attendee', 'active', 'system', 'seed', ${stamp}, ${stamp} FROM n`,
       )}`,
    ),
    env.DB.prepare(
      `INSERT INTO registration_day_attendance (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
       ${numbered(
         holders + waiting,
         `SELECT '${prefix}-attendance-' || i, 'registration-' || i, '${day.id}', 'in_person', ${stamp}, ${stamp} FROM n`,
       )}`,
    ),
    env.DB.prepare(
      `INSERT INTO event_day_waitlist_entries (id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position, created_at, updated_at)
       ${numbered(
         waiting,
         `SELECT '${prefix}-waiting-' || i, '${eventId}', '${day.id}', 'registration-' || (${holders} + i), 'user-' || (${holders} + i), 'general', 'waiting', i, ${stamp}, ${stamp} FROM n`,
       )}`,
    ),
  ]);
}

function rowsReadByCapacityQueries(profile: ReturnType<typeof profileD1Flow>): number {
  return profile
    .summary()
    .queries.filter((query) => query.sql.includes("open_waitlist_option"))
    .reduce((total, query) => total + (query.rowsRead ?? 0), 0);
}

describe("waitlist promotion query cost", () => {
  let eventId: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
  });

  it("counts seats once per full option instead of once per waiting person", async () => {
    await seedDay(eventId, { id: "day-1", capacity: HOLDERS });
    await seedDay(eventId, { id: "day-2", capacity: HOLDERS });
    const profile = profileD1Flow(env.DB, { measureRowsRead: true });

    const result = await runWaitlistPromotionCycle(profile.db, CYCLE);

    expect(result).toMatchObject({ eventsScanned: 0, dayRegistrationOffers: 0 });
    expect(rowsReadByCapacityQueries(profile)).toBeLessThan(ROWS_PER_PERSON * (HOLDERS + WAITING) * 2);
  });

  it("offers a freed seat to the first person in the queue at the same bounded cost", async () => {
    await seedDay(eventId, { id: "day-1", capacity: HOLDERS + 1 });
    const profile = profileD1Flow(env.DB, { measureRowsRead: true });

    const result = await runWaitlistPromotionCycle(profile.db, CYCLE);

    expect(result).toMatchObject({ eventsScanned: 1, dayRegistrationOffers: 1 });
    await expect(
      queryAll(env.DB, "SELECT registration_id FROM event_day_waitlist_entries WHERE status = 'offered'"),
    ).resolves.toEqual([{ registration_id: `registration-${HOLDERS + 1}` }]);
    // Selection, the offer pass, and the pass that finds the option full again.
    expect(rowsReadByCapacityQueries(profile)).toBeLessThan(ROWS_PER_PERSON * (HOLDERS + WAITING) * 3);
  });

  it("promotes only the option with a free seat when another option on the day is full", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, attendance_options_json, sort_order, created_at, updated_at)
         VALUES ('day-1', ?, '2026-12-01', 'Day 1', 1, ?, 10, '${NOW}', '${NOW}')`,
      ).bind(
        eventId,
        JSON.stringify([
          { value: "in_person", label: "In person", accessMode: "physical", capacity: 1 },
          { value: "virtual", label: "Virtual", accessMode: "remote", capacity: 1 },
        ]),
      ),
      ...[
        ["holder", "in_person", false],
        ["full-option", "in_person", true],
        ["open-option", "virtual", true],
      ].flatMap(([name, attendanceType, waiting]) => [
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
           VALUES ('user-${name}', '${name}@example.test', '${name}@example.test', '${NOW}', '${NOW}')`,
        ),
        env.DB.prepare(
          `INSERT INTO registrations (id, event_id, user_id, status, source_type, manage_link_secret, created_at, updated_at)
           VALUES ('registration-${name}', ?, 'user-${name}', 'registered', 'direct', 'secret-${name}', '${NOW}', '${NOW}')`,
        ).bind(eventId),
        env.DB.prepare(
          `INSERT INTO registration_day_attendance (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
           VALUES ('attendance-${name}', 'registration-${name}', 'day-1', ?, '${NOW}', '${NOW}')`,
        ).bind(attendanceType),
        ...(waiting
          ? [
              env.DB.prepare(
                `INSERT INTO event_day_waitlist_entries (id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position, created_at, updated_at)
                 VALUES ('waiting-${name}', ?, 'day-1', 'registration-${name}', 'user-${name}', 'general', 'waiting', 1, '${NOW}', '${NOW}')`,
              ).bind(eventId),
            ]
          : []),
      ]),
    ]);

    const promoted = await promoteDayWaitlistIfCapacity(env.DB, {
      eventId,
      eventDayId: "day-1",
      claimWindowHours: 24,
    });

    expect(promoted).toMatchObject({
      registration_id: "registration-open-option",
      capacitySnapshot: { seatsReservedBeforeDecision: 0, limit: 1 },
    });
  });

  it.each([
    ["the active queue", { waitlisted: "true" }, undefined],
    ["one queue status", {}, "waiting"],
  ] as const)("counts registrations in %s without scanning it per registration", async (_name, params, status) => {
    await seedDay(eventId, { id: "day-1", capacity: HOLDERS });
    const population = registrationPopulationFilter(eventId, params, status);
    const profile = profileD1Flow(env.DB, { measureRowsRead: true });

    const rows = await queryAll<{ total: number }>(
      profile.db,
      `SELECT COUNT(*) AS total ${population.fromSql}`,
      population.bindings,
    );

    expect(rows).toEqual([{ total: WAITING }]);
    expect(profile.summary().queries[0]?.rowsRead).toBeLessThan(ROWS_PER_PERSON * (HOLDERS + WAITING));
  });

  it("leaves people with a capacity-exempt role out of the physical queue", async () => {
    await seedDay(eventId, { id: "day-1", capacity: 2, holders: 1 }, 1);
    await env.DB.prepare(
      `INSERT INTO event_participants (id, event_id, user_id, role, status, source_type, source_ref, created_at, updated_at)
       VALUES ('role-1', ?, 'user-2', 'speaker', 'active', 'system', 'seed', '${NOW}', '${NOW}')`,
    )
      .bind(eventId)
      .run();

    await expect(runWaitlistPromotionCycle(env.DB, CYCLE)).resolves.toMatchObject({ eventsScanned: 0 });
  });
});
