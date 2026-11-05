import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  createRegistration,
  confirmRegistrationByToken,
  updateRegistrationById,
  updateRegistrationByManageToken,
} from "../functions/_lib/services/registrations";
import {
  buildRegistrationDayWaitlistSync,
  promoteDayWaitlistIfCapacity,
} from "../functions/_lib/services/registrations/day-waitlist";
import { prepareLapsedDayOfferRequeue } from "../functions/_lib/services/registrations/day-waitlist-policy";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

async function lapsedOfferFixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const days = ["2026-12-01", "2026-12-02"];
  await env.DB.batch([
    ...days.map((date, index) =>
      env.DB.prepare(
        `INSERT INTO event_days (id,event_id,day_date,label,in_person_capacity,sort_order,created_at,updated_at)
       VALUES (?,?,?,'Day',1,?,datetime('now'),datetime('now'))`,
      ).bind(`lapsed-day-${index}`, eventId, date, index),
    ),
    ...["lapsed-holder", "lapsed-waiter"].map((id) =>
      env.DB.prepare(
        `INSERT INTO users (id,email,normalized_email,created_at,updated_at) VALUES (?,?,?,datetime('now'),datetime('now'))`,
      ).bind(id, `${id}@example.test`, `${id}@example.test`),
    ),
  ]);
  const event = await getEventBySlug(env.DB, "pqc-2026");
  const selections = days.map((dayDate) => ({ dayDate, attendanceType: "in_person" }));
  let waiterId = "";
  for (const userId of ["lapsed-holder", "lapsed-waiter"]) {
    const result = await createRegistration(env.DB, {
      event,
      userId,
      dayAttendance: selections,
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: result.confirmationToken!,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    if (userId === "lapsed-waiter") waiterId = result.registration.id;
  }
  const now = new Date().toISOString();
  const expired = new Date(Date.now() - 3600000).toISOString();
  await env.DB.prepare(
    `UPDATE event_day_waitlist_entries SET status='offered',priority_lane='continuity',offer_expires_at=? WHERE registration_id=? AND event_day_id='lapsed-day-0'`,
  )
    .bind(expired, waiterId)
    .run();
  return { eventId, waiterId, selections, now, expired };
}

describe("day waitlist queue fairness", () => {
  beforeEach(resetDb);

  it.each([false, true])(
    "keeps lapsed multi-day offers in the general lane after sync (already requeued: %s)",
    async (alreadyRequeued) => {
      const { eventId, waiterId, selections, now } = await lapsedOfferFixture();
      if (alreadyRequeued) await env.DB.batch([prepareLapsedDayOfferRequeue(env.DB, { eventId, now })]);
      for (let attempt = 0; attempt < 2; attempt++) {
        const plan = await buildRegistrationDayWaitlistSync(env.DB, {
          registrationId: waiterId,
          eventId,
          userId: "lapsed-waiter",
          selections,
          capacityExemptReason: null,
        });
        await env.DB.batch([...plan.guardStatements, ...plan.statements]);
        const rows = await queryAll<{ event_day_id: string; priority_lane: string; reason_code: string | null }>(
          env.DB,
          "SELECT event_day_id,priority_lane,reason_code FROM event_day_waitlist_entries WHERE registration_id=? ORDER BY event_day_id",
          [waiterId],
        );
        expect(rows[0]).toMatchObject({
          event_day_id: "lapsed-day-0",
          priority_lane: "general",
          reason_code: "offer_lapsed",
        });
        expect(rows[1]).toMatchObject({ event_day_id: "lapsed-day-1", priority_lane: "continuity" });
      }
    },
  );

  it("grows queue positions linearly across repeated lapsed offers", async () => {
    const { eventId, waiterId, now, expired } = await lapsedOfferFixture();
    const [before] = await queryAll<{ tail: number }>(
      env.DB,
      "SELECT MAX(position) AS tail FROM event_day_waitlist_entries WHERE event_day_id='lapsed-day-0'",
    );
    for (let attempt = 0; attempt < 32; attempt++)
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE event_day_waitlist_entries SET status='offered',offer_expires_at=? WHERE registration_id=? AND event_day_id='lapsed-day-0'",
        ).bind(expired, waiterId),
        prepareLapsedDayOfferRequeue(env.DB, { eventId, now }),
      ]);
    const [after] = await queryAll<{ position: number }>(
      env.DB,
      "SELECT position FROM event_day_waitlist_entries WHERE registration_id=? AND event_day_id='lapsed-day-0'",
      [waiterId],
    );
    expect(after.position).toBe(before.tail + 32);
    expect(Number.isSafeInteger(after.position)).toBe(true);
  });

  it("counts a role-exempt attendee toward physical capacity for an ordinary registration", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
         VALUES ('physical-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      ...["organizer", "attendee"].map((id) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(id, `${id}@example.test`, `${id}@example.test`),
      ),
      env.DB.prepare(
        `INSERT INTO event_participants
         (id, event_id, user_id, role, status, source_type, created_at, updated_at)
         VALUES ('organizer-participant', ?, 'organizer', 'organizer', 'active', 'test', datetime('now'), datetime('now'))`,
      ).bind(eventId),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const common = {
      event,
      attendanceType: "in_person" as const,
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" as const }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    };

    const organizer = await createRegistration(env.DB, { ...common, userId: "organizer" });
    expect(organizer.registration).not.toHaveProperty("capacity_exempt_in_person");
    const attendee = await createRegistration(env.DB, { ...common, userId: "attendee" });

    expect(
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
        [attendee.registration.id],
      ),
    ).toEqual([{ status: "waiting" }]);
    const [audit] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE entity_id = ? AND action = 'registration_capacity_decision'",
      [attendee.registration.id],
    );
    expect(JSON.parse(audit.details_json)).toMatchObject({
      decisions: {
        to: [
          {
            dayDate: "2026-12-01",
            outcome: "waitlisted",
            reason: "capacity_full",
            seatsReservedBeforeDecision: 1,
            attendeesWaitingBeforeDecision: 0,
            limit: 1,
          },
        ],
      },
    });
  });

  it("counts an admin-admitted day toward physical capacity for an ordinary registration", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
         VALUES ('admitted-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      ...["admitted", "attendee"].map((id) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(id, `${id}@example.test`, `${id}@example.test`),
      ),
      env.DB.prepare(
        `INSERT INTO registrations
         (id, event_id, user_id, status, source_type, manage_link_secret, created_at, updated_at)
         VALUES ('admitted-registration', ?, 'admitted', 'registered', 'direct', 'secret', datetime('now'), datetime('now'))`,
      ).bind(eventId),
      env.DB.prepare(
        `INSERT INTO registration_day_attendance
         (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
         VALUES ('admitted-attendance', 'admitted-registration', 'admitted-day', 'in_person', datetime('now'), datetime('now'))`,
      ),
      env.DB.prepare(
        `INSERT INTO event_day_waitlist_entries
         (id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position, reason_code, created_at, updated_at)
         VALUES ('admitted-waitlist', ?, 'admitted-day', 'admitted-registration', 'admitted', 'general', 'accepted', 1,
                 'admin_capacity_exempt', datetime('now'), datetime('now'))`,
      ).bind(eventId),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const attendee = await createRegistration(env.DB, {
      event,
      userId: "attendee",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    expect(
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
        [attendee.registration.id],
      ),
    ).toEqual([{ status: "waiting" }]);
  });

  it("keeps an opened seat for earlier waitlisted attendees across registration and self-service updates", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
         VALUES ('queue-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      ...["holder", "waiting", "direct", "editing"].map((id) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(id, `${id}@example.test`, `${id}@example.test`),
      ),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const common = {
      event,
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    };
    const inPerson = [{ dayDate: "2026-12-01", attendanceType: "in_person" as const }];
    const virtual = [{ dayDate: "2026-12-01", attendanceType: "virtual" as const }];

    const holder = await createRegistration(env.DB, {
      ...common,
      userId: "holder",
      dayAttendance: inPerson,
    });
    const firstWaiting = await createRegistration(env.DB, {
      ...common,
      userId: "waiting",
      dayAttendance: inPerson,
    });
    const editing = await createRegistration(env.DB, {
      ...common,
      userId: "editing",
      dayAttendance: virtual,
    });

    await updateRegistrationById(
      env.DB,
      { eventId, registrationId: holder.registration.id, action: "cancel" },
      "admin",
    );

    const direct = await createRegistration(env.DB, {
      ...common,
      userId: "direct",
      dayAttendance: inPerson,
    });
    await updateRegistrationByManageToken(env.DB, {
      manageToken: editing.manageToken,
      signingSecret: common.signingSecret,
      action: "update",
      dayAttendance: inPerson,
    });

    const rows = await queryAll<{ registration_id: string; status: string; position: number }>(
      env.DB,
      `SELECT registration_id, status, position FROM event_day_waitlist_entries
       WHERE event_day_id = 'queue-day' AND status = 'waiting' ORDER BY position`,
    );
    expect(rows.map(({ registration_id, status }) => ({ registration_id, status }))).toEqual([
      { registration_id: firstWaiting.registration.id, status: "waiting" },
      { registration_id: direct.registration.id, status: "waiting" },
      { registration_id: editing.registration.id, status: "waiting" },
    ]);
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });

  it("admits new attendees into surplus seats while holding enough seats for the earlier queue", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
         VALUES ('expanded-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      ...["holder", "waiting", "direct", "editing", "late"].map((id) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(id, `${id}@example.test`, `${id}@example.test`),
      ),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const common = {
      event,
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    };
    const inPerson = [{ dayDate: "2026-12-01", attendanceType: "in_person" as const }];

    await createRegistration(env.DB, {
      ...common,
      userId: "holder",
      dayAttendance: inPerson,
    });
    const firstWaiting = await createRegistration(env.DB, {
      ...common,
      userId: "waiting",
      dayAttendance: inPerson,
    });
    const editing = await createRegistration(env.DB, {
      ...common,
      userId: "editing",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
    });

    await env.DB.prepare("UPDATE event_days SET in_person_capacity = 4 WHERE id = 'expanded-day'").run();

    const direct = await createRegistration(env.DB, {
      ...common,
      userId: "direct",
      dayAttendance: inPerson,
    });
    await updateRegistrationByManageToken(env.DB, {
      manageToken: editing.manageToken,
      signingSecret: common.signingSecret,
      action: "update",
      dayAttendance: inPerson,
    });
    const late = await createRegistration(env.DB, {
      ...common,
      userId: "late",
      dayAttendance: inPerson,
    });

    expect(
      await queryAll<{ registration_id: string; status: string }>(
        env.DB,
        `SELECT registration_id, status FROM event_day_waitlist_entries
         WHERE event_day_id = 'expanded-day' AND status = 'waiting' ORDER BY position`,
      ),
    ).toEqual([
      { registration_id: firstWaiting.registration.id, status: "waiting" },
      { registration_id: late.registration.id, status: "waiting" },
    ]);
    const [audit] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE entity_id = ? AND action = 'registration_capacity_decision'",
      [direct.registration.id],
    );
    expect(JSON.parse(audit.details_json)).toMatchObject({
      decisions: {
        to: [
          {
            outcome: "admitted",
            reason: "capacity_available_after_queue",
            seatsReservedBeforeDecision: 1,
            attendeesWaitingBeforeDecision: 1,
            limit: 4,
          },
        ],
      },
    });

    const offer = await promoteDayWaitlistIfCapacity(env.DB, {
      eventId,
      eventDayId: "expanded-day",
      claimWindowHours: 24,
    });
    expect(offer?.registration_id).toBe(firstWaiting.registration.id);
    expect(
      await queryAll<{ registration_id: string; status: string }>(
        env.DB,
        `SELECT registration_id, status FROM event_day_waitlist_entries
         WHERE event_day_id = 'expanded-day' AND status IN ('waiting', 'offered') ORDER BY position`,
      ),
    ).toEqual([
      { registration_id: firstWaiting.registration.id, status: "offered" },
      { registration_id: late.registration.id, status: "waiting" },
    ]);
  });
});
