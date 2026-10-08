import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { eventDayHasAvailableCapacitySql } from "../functions/_lib/services/registrations/day-waitlist-capacity";
import { eventEntryOccupiedSql } from "../functions/_lib/services/event-participation/event-entry-capacity";
const now = "2030-01-01T10:00:00.000Z",
  dayDate = "2030-01-01";
let eventId: string, dayId: string, users: string[];
describe("Canonical event-day allocation populations", () => {
  beforeEach(async () => {
    await resetDb();
    eventId = crypto.randomUUID();
    dayId = crypto.randomUUID();
    users = Array.from({ length: 13 }, () => crypto.randomUUID());
    for (const [i, id] of users.entries())
      await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
        .bind(id, `capacity-${i}@example.test`, `capacity-${i}@example.test`)
        .run();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,capacity_in_person,created_at,updated_at) VALUES(?,'allocation-populations','Allocation populations','UTC',100,?,?)",
    )
      .bind(eventId, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,in_person_capacity,created_at,updated_at) VALUES(?,?,?,100,?,?)",
    )
      .bind(dayId, eventId, dayDate, now, now)
      .run();
    const otherDay = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,in_person_capacity,created_at,updated_at) VALUES(?,?,'2030-01-03',100,?,?)",
    )
      .bind(otherDay, eventId, now, now)
      .run();
    const registrations: string[] = [];
    for (let i = 0; i < 9; i++) {
      const registrationId = crypto.randomUUID();
      registrations.push(registrationId);
      await env.DB.prepare(
        "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,?,?,'test',?,?,?)",
      )
        .bind(
          registrationId,
          eventId,
          users[i],
          i === 2 ? "cancelled" : i === 1 ? "pending_email_confirmation" : "registered",
          i === 3 || i === 4 ? "virtual" : "in_person",
          crypto.randomUUID(),
          now,
          now,
        )
        .run();
      if (i !== 5)
        await env.DB.prepare(
          "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        )
          .bind(crypto.randomUUID(), registrationId, dayId, i === 3 ? "virtual" : "in_person", now, now)
          .run();
    }
    await env.DB.prepare(
      "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) VALUES(?,?,?,'in_person',?,?)",
    )
      .bind(crypto.randomUUID(), registrations[0], otherDay, now, now)
      .run();
    for (const [index, status, expiry] of [
      [6, "waiting", null],
      [7, "offered", "2030-01-02T00:00:00.000Z"],
      [8, "offered", "2029-12-31T00:00:00.000Z"],
    ] as const)
      await env.DB.prepare(
        "INSERT INTO event_day_waitlist_entries(id,event_id,event_day_id,registration_id,user_id,priority_lane,status,position,offer_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,'general',?,?,?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, dayId, registrations[index], users[index], status, index, expiry, now, now)
        .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    for (const index of [0, 9])
      await env.DB.prepare(
        "INSERT INTO event_agenda_operational_days(event_id,revision,day_date,user_id,sources_json) VALUES(?,0,?,?,?)",
      )
        .bind(eventId, dayDate, users[index], '["staff"]')
        .run();
    for (const index of [0, 10, 11])
      await env.DB.prepare(
        "INSERT INTO event_entry_admissions(id,event_id,day_date,user_id,operation_id,admitted_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, dayDate, users[index], crypto.randomUUID(), now)
        .run();
    for (const [kind, quantity, revoked, closed, expiry] of [
      ["open", 2, null, null, "2030-01-02T00:00:00.000Z"],
      ["revoked", 1, now, null, "2030-01-02T00:00:00.000Z"],
      ["expired", 1, null, null, "2029-12-31T00:00:00.000Z"],
      ["closed", 5, null, now, "2030-01-02T00:00:00.000Z"],
    ] as const) {
      const grantId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO event_offline_admission_grants(id,event_id,event_day_id,day_date,operator_user_id,device_id,quantity,issued_at,expires_at,revoked_at,closed_at,created_by) VALUES(?,?,?,?,?,?,?,'2029-01-01T00:00:00.000Z',?,?,?,?)",
      )
        .bind(
          grantId,
          eventId,
          dayId,
          dayDate,
          users[0],
          crypto.randomUUID(),
          quantity,
          expiry,
          revoked,
          closed,
          users[0],
        )
        .run();
      if (kind === "open") {
        for (const index of [0, 12])
          await env.DB.prepare("INSERT INTO event_offline_admission_entitlements(grant_id,user_id) VALUES(?,?)")
            .bind(grantId, users[index])
            .run();
        await env.DB.prepare(
          "INSERT INTO event_offline_admission_spends(operation_id,grant_id,slot,user_id,observed_at,accepted_at) VALUES(?,?,0,?,?,?)",
        )
          .bind(crypto.randomUUID(), grantId, users[11], now, now)
          .run();
      }
    }
  });
  it("allows the last real registration despite scanner evidence and refuses the next capacity claim", async () => {
    await env.DB.prepare("UPDATE event_days SET in_person_capacity=6 WHERE id=?").bind(dayId).run();
    const before = await env.DB.prepare("SELECT capacity_revision FROM event_days WHERE id=?").bind(dayId).first();
    await env.DB.prepare(
      "INSERT INTO event_entry_admissions(id,event_id,day_date,user_id,operation_id,admitted_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, dayDate, users[12], crypto.randomUUID(), now)
      .run();
    await env.DB.prepare(
      "UPDATE event_offline_admission_grants SET closed_at=? WHERE event_id=? AND revoked_at IS NOT NULL",
    )
      .bind(now, eventId)
      .run();
    expect(await env.DB.prepare("SELECT capacity_revision FROM event_days WHERE id=?").bind(dayId).first()).toEqual(
      before,
    );
    const registrationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(registrationId, eventId, users[12], crypto.randomUUID(), now, now)
      .run();
    const claim = (id: string, targetRegistration: string) =>
      env.DB.prepare(
        `INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at)
       SELECT ?,?,day.id,'in_person',?,? FROM event_days day WHERE day.id=? AND ${eventDayHasAvailableCapacitySql("day", "'2030-01-01T12:00:00.000Z'")}`,
      )
        .bind(id, targetRegistration, now, now, dayId)
        .run();
    const firstId = crypto.randomUUID();
    await claim(firstId, registrationId);
    expect(
      await env.DB.prepare("SELECT id,registration_id,event_day_id FROM registration_day_attendance WHERE id=?")
        .bind(firstId)
        .first(),
    ).toEqual({ id: firstId, registration_id: registrationId, event_day_id: dayId });
    const nextRegistration = crypto.randomUUID(),
      nextId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(nextRegistration, eventId, users[11], crypto.randomUUID(), now, now)
      .run();
    await claim(nextId, nextRegistration);
    expect(
      await env.DB.prepare("SELECT id FROM registration_day_attendance WHERE id=?").bind(nextId).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        `SELECT ${eventEntryOccupiedSql(`'${eventId}'`, `'${dayDate}'`, undefined, true, "'2030-01-01T12:00:00.000Z'")} AS occupied`,
      ).first(),
    ).toEqual({ occupied: 6 });
  });
  const cases = [true, false].flatMap((configured) =>
    [true, false].flatMap((includeOffers) =>
      [true, false].flatMap((exclude) =>
        [true, false].map((correlated) => ({ configured, includeOffers, exclude, correlated })),
      ),
    ),
  );
  it.each(cases)(
    "counts the exact canonical population: %j",
    async ({ configured, includeOffers, exclude, correlated }) => {
      const date = configured ? dayDate : "2030-01-02";
      const sql = correlated
        ? `WITH target AS(SELECT ? AS event_id,? AS day_date,? AS user_id) SELECT ${eventEntryOccupiedSql("target.event_id", "target.day_date", exclude ? "target.user_id" : undefined, includeOffers, "'2030-01-01T12:00:00.000Z'")} AS occupied FROM target`
        : `SELECT ${eventEntryOccupiedSql(`'${eventId}'`, `'${date}'`, exclude ? `'${users[0]}'` : undefined, includeOffers, "'2030-01-01T12:00:00.000Z'")} AS occupied`;
      const statement = correlated ? env.DB.prepare(sql).bind(eventId, date, users[0]) : env.DB.prepare(sql);
      // Configured: four distinct registered or operational people plus one live offer.
      // Scanner admissions, unclosed grants, entitlements and spends reserve no seats.
      // Unconfigured: six physical registrations; user zero still consumes one seat.
      const expected = (configured ? (includeOffers ? 5 : 4) : 6) - (exclude ? 1 : 0);
      expect(await statement.first()).toEqual({ occupied: expected });
    },
  );
});
