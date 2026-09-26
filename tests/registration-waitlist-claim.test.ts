import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

const signingSecret = "test-signing-secret";

interface ClaimFixture {
  registrationId: string;
  token: string;
}

async function seedClaimFixture(
  dayDates: string[],
  offeredDates: string[],
  expiredDates: string[] = [],
): Promise<ClaimFixture> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const dayIdsByDate = new Map(dayDates.map((dayDate) => [dayDate, crypto.randomUUID()]));

  await env.DB.batch([
    ...dayDates.map((dayDate, index) =>
      env.DB.prepare(
        `INSERT INTO event_days (
             id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
      ).bind(dayIdsByDate.get(dayDate), eventId, dayDate, `Day ${index + 1}`, index + 1),
    ),
    env.DB.prepare(
      `INSERT INTO users (
           id, email, normalized_email, first_name, last_name, created_at, updated_at
         ) VALUES (?, 'claim@example.test', 'claim@example.test', 'Before', 'Claim', datetime('now'), datetime('now'))`,
    ).bind(userId),
    env.DB.prepare(
      `INSERT INTO registrations (
           id, event_id, user_id, status, attendance_type, source_type, manage_link_secret,
           confirmed_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'registered', 'in_person', 'direct', ?, datetime('now'), datetime('now'), datetime('now'))`,
    ).bind(registrationId, eventId, userId, crypto.randomUUID()),
  ]);

  await env.DB.batch([
    ...dayDates.map((dayDate) =>
      env.DB.prepare(
        `INSERT INTO registration_day_attendance (
             id, registration_id, event_day_id, attendance_type, created_at, updated_at
           ) VALUES (?, ?, ?, 'in_person', datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), registrationId, dayIdsByDate.get(dayDate)),
    ),
    ...offeredDates.map((dayDate, index) =>
      env.DB.prepare(
        `INSERT INTO event_day_waitlist_entries (
             id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position,
             offer_expires_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'general', 'offered', ?, ?, datetime('now'), datetime('now'))`,
      ).bind(
        crypto.randomUUID(),
        eventId,
        dayIdsByDate.get(dayDate),
        registrationId,
        userId,
        index + 1,
        expiredDates.includes(dayDate)
          ? new Date(Date.now() - 60_000).toISOString()
          : new Date(Date.now() + 60 * 60_000).toISOString(),
      ),
    ),
  ]);

  return {
    registrationId,
    token: await issueDatabaseCapability({
      db: env.DB,
      signingSecret,
      purpose: "registration_manage",
      resourceId: registrationId,
    }),
  };
}

function callMountedClaim(
  token: string,
  dayDates: string[],
  firstName = "After",
  additionalDayAttendance: Array<{ dayDate: string; attendanceType: string }> = [],
): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/registrations/access/${token}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "update",
        firstName,
        dayAttendance: [
          ...dayDates.map((dayDate) => ({ dayDate, attendanceType: "in_person" })),
          ...additionalDayAttendance,
        ],
        claimDayWaitlistOffers: dayDates,
      }),
    }),
    env,
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
  );
}

function callMountedClaimWithSelection(token: string, claimDayDate: string, attendanceType: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/registrations/access/${token}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "update",
        firstName: "After",
        dayAttendance: [{ dayDate: claimDayDate, attendanceType }],
        claimDayWaitlistOffers: [claimDayDate],
      }),
    }),
    env,
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
  );
}

function callMountedScalarAttendanceUpdate(token: string, attendanceType: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/registrations/access/${token}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", attendanceType }),
    }),
    env,
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
  );
}

async function expectClaimConflict(response: Response): Promise<void> {
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "DAY_WAITLIST_OFFER_UNAVAILABLE" },
  });
}

async function aggregateEffects(registrationId: string): Promise<{
  firstName: string;
  outbox: number;
  audits: number;
}> {
  const [row] = await queryAll<{ first_name: string; outbox: number; audits: number }>(
    env.DB,
    `SELECT u.first_name,
            (SELECT COUNT(*) FROM email_outbox o WHERE o.recipient_user_id = r.user_id) AS outbox,
            (SELECT COUNT(*) FROM audit_log a WHERE a.entity_id = r.id) AS audits
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     WHERE r.id = ?`,
    [registrationId],
  );
  return { firstName: row.first_name, outbox: Number(row.outbox), audits: Number(row.audits) };
}

describe("mounted registration day-waitlist claims", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects a scalar-only attendance change when day attendance is canonical", async () => {
    const fixture = await seedClaimFixture(["2026-12-01"], ["2026-12-01"]);

    const response = await callMountedScalarAttendanceUpdate(fixture.token, "virtual");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DAY_ATTENDANCE_REQUIRED" },
    });
    await expect(
      queryAll<{ attendance_type: string }>(
        env.DB,
        `SELECT rda.attendance_type FROM registration_day_attendance rda
         JOIN registrations r ON r.id = rda.registration_id
         WHERE rda.registration_id = ?`,
        [fixture.registrationId],
      ),
    ).resolves.toEqual([{ attendance_type: "in_person" }]);
    await expect(
      queryAll<{ attendance_type: string }>(env.DB, "SELECT attendance_type FROM registrations WHERE id = ?", [
        fixture.registrationId,
      ]),
    ).resolves.toEqual([{ attendance_type: "in_person" }]);
  });

  it("rejects an expired offer and rolls back unrelated profile, attendance, audit, and outbox writes", async () => {
    const fixture = await seedClaimFixture(["2026-12-01", "2026-12-02"], ["2026-12-01"], ["2026-12-01"]);

    await expectClaimConflict(
      await callMountedClaim(fixture.token, ["2026-12-01"], "After", [
        { dayDate: "2026-12-02", attendanceType: "virtual" },
      ]),
    );

    expect(await aggregateEffects(fixture.registrationId)).toEqual({ firstName: "Before", outbox: 0, audits: 0 });
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?", [
        fixture.registrationId,
      ]),
    ).resolves.toEqual([{ status: "offered" }]);
    await expect(
      queryAll<{ day_date: string; attendance_type: string }>(
        env.DB,
        `SELECT ed.day_date, rda.attendance_type
         FROM registration_day_attendance rda
         JOIN event_days ed ON ed.id = rda.event_day_id
         WHERE rda.registration_id = ?
         ORDER BY ed.day_date`,
        [fixture.registrationId],
      ),
    ).resolves.toEqual([
      { day_date: "2026-12-01", attendance_type: "in_person" },
      { day_date: "2026-12-02", attendance_type: "in_person" },
    ]);
  });

  it("rejects a missing offer without committing the surrounding update", async () => {
    const fixture = await seedClaimFixture(["2026-12-01"], []);

    await expectClaimConflict(await callMountedClaim(fixture.token, ["2026-12-01"]));

    expect(await aggregateEffects(fixture.registrationId)).toEqual({ firstName: "Before", outbox: 0, audits: 0 });
  });

  it("rejects a claim whose date is not selected for in-person attendance", async () => {
    const fixture = await seedClaimFixture(["2026-12-01"], ["2026-12-01"]);

    await expectClaimConflict(await callMountedClaimWithSelection(fixture.token, "2026-12-01", "virtual"));

    expect(await aggregateEffects(fixture.registrationId)).toEqual({ firstName: "Before", outbox: 0, audits: 0 });
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?", [
        fixture.registrationId,
      ]),
    ).resolves.toEqual([{ status: "offered" }]);
  });

  it("rolls back every date when one date in a multi-day claim is no longer offered", async () => {
    const fixture = await seedClaimFixture(["2026-12-01", "2026-12-02"], ["2026-12-01", "2026-12-02"], ["2026-12-02"]);

    await expectClaimConflict(await callMountedClaim(fixture.token, ["2026-12-01", "2026-12-02"]));

    expect(await aggregateEffects(fixture.registrationId)).toEqual({ firstName: "Before", outbox: 0, audits: 0 });
    await expect(
      queryAll<{ day_date: string; status: string }>(
        env.DB,
        `SELECT ed.day_date, w.status
         FROM event_day_waitlist_entries w
         JOIN event_days ed ON ed.id = w.event_day_id
         WHERE w.registration_id = ?
         ORDER BY ed.day_date`,
        [fixture.registrationId],
      ),
    ).resolves.toEqual([
      { day_date: "2026-12-01", status: "offered" },
      { day_date: "2026-12-02", status: "offered" },
    ]);
  });

  it("accepts every live offer and commits the profile, audit, and outbox together", async () => {
    const fixture = await seedClaimFixture(["2026-12-01", "2026-12-02"], ["2026-12-01", "2026-12-02"]);

    const response = await callMountedClaim(fixture.token, ["2026-12-01", "2026-12-02"]);

    expect(response.status).toBe(200);
    expect(await aggregateEffects(fixture.registrationId)).toEqual({ firstName: "After", outbox: 1, audits: 1 });
    await expect(
      queryAll<{ day_date: string; status: string; offer_expires_at: string | null }>(
        env.DB,
        `SELECT ed.day_date, w.status, w.offer_expires_at
         FROM event_day_waitlist_entries w
         JOIN event_days ed ON ed.id = w.event_day_id
         WHERE w.registration_id = ?
         ORDER BY ed.day_date`,
        [fixture.registrationId],
      ),
    ).resolves.toEqual([
      { day_date: "2026-12-01", status: "accepted", offer_expires_at: null },
      { day_date: "2026-12-02", status: "accepted", offer_expires_at: null },
    ]);
  });
});
