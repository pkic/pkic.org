import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  createRegistration,
  updateRegistrationById,
  updateRegistrationByManageToken,
} from "../functions/_lib/services/registrations";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

describe("day waitlist queue fairness", () => {
  beforeEach(resetDb);

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
      attendanceType: "in_person",
      dayAttendance: inPerson,
    });
    const firstWaiting = await createRegistration(env.DB, {
      ...common,
      userId: "waiting",
      attendanceType: "in_person",
      dayAttendance: inPerson,
    });
    const editing = await createRegistration(env.DB, {
      ...common,
      userId: "editing",
      attendanceType: "virtual",
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
      attendanceType: "in_person",
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
});
