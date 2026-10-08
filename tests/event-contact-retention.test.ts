import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { eventContactRetentionSchema } from "../assets/shared/schemas/event-contact-retention";
import { resetDb } from "./helpers/reset-db";
import { nowIso } from "../functions/_lib/utils/time";
import {
  assertEventContactAccess,
  eventContactAccessSql,
  readEventContactRetention,
} from "../functions/_lib/services/event-participation/evidence-retention";
import { sessionAttendancePeople, sessionBookings } from "../functions/_lib/services/event-participation/reporting";
import { attendanceEvidence } from "../functions/_lib/services/event-participation/attendance-corrections";
import { eventAttendanceSummary } from "../functions/_lib/services/event-participation/attendance-summary";
const eventId = crypto.randomUUID(),
  otherEvent = crypto.randomUUID(),
  personId = crypto.randomUUID();
async function policy(days = 1) {
  await env.DB.prepare("INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES(?,?,?)")
    .bind(eventId, days, nowIso())
    .run();
}
async function contactPredicate(id = eventId) {
  return (await env.DB.prepare(
    `SELECT EXISTS(SELECT 1 FROM events e WHERE e.id=? AND ${eventContactAccessSql("e.id")}) AS allowed`,
  )
    .bind(id)
    .first<{ allowed: number }>())!.allowed;
}
beforeEach(async () => {
  await resetDb();
  const now = nowIso();
  for (const [id, slug] of [
    [eventId, "retained-event"],
    [otherEvent, "other-retained-event"],
  ])
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,ends_at,created_at,updated_at) VALUES(?,?,?,'UTC','{}','2020-01-01T10:00:00.000Z',?,?)",
    )
      .bind(id, slug, slug, now, now)
      .run();
  await env.DB.prepare(
    "INSERT INTO users(id,email,normalized_email,first_name,active) VALUES(?,'retained@example.test','retained@example.test','Original identity',1)",
  )
    .bind(personId)
    .run();
});
describe("event-specific contact purpose retention", () => {
  it("exposes unset policy/end honestly without inventing a cutoff; blocks due reads before cleanup", async () => {
    expect(await readEventContactRetention(env.DB, eventId)).toEqual({
      state: "unconfigured",
      contactUntil: null,
      closedAt: null,
    });
    expect(await contactPredicate()).toBe(1);
    await policy();
    expect(await readEventContactRetention(env.DB, eventId)).toMatchObject({
      state: "closed",
      contactUntil: "2020-01-02T10:00:00.000Z",
    });
    expect(await contactPredicate()).toBe(0);
    await expect(assertEventContactAccess(env.DB, eventId)).rejects.toMatchObject({
      status: 410,
      code: "EVENT_CONTACT_RETENTION_EXPIRED",
    });
    expect(await env.DB.prepare("SELECT email,first_name FROM users WHERE id=?").bind(personId).first()).toEqual({
      email: "retained@example.test",
      first_name: "Original identity",
    });
    expect(await readEventContactRetention(env.DB, otherEvent)).toMatchObject({ state: "unconfigured" });
    expect(await contactPredicate(otherEvent)).toBe(1);
  });
  it("keeps closure permanent when an expired event end is moved later or cleared", async () => {
    await policy();
    await env.DB.prepare("UPDATE events SET ends_at='2099-01-01T10:00:00.000Z' WHERE id=?").bind(eventId).run();
    expect(await readEventContactRetention(env.DB, eventId)).toEqual({
      state: "closed",
      contactUntil: "2020-01-02T10:00:00.000Z",
      closedAt: "2020-01-02T10:00:00.000Z",
    });
    await env.DB.prepare("UPDATE events SET ends_at=NULL WHERE id=?").bind(eventId).run();
    expect(await contactPredicate()).toBe(0);
    expect(await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(personId).first()).toEqual({
      email: "retained@example.test",
    });
  });
  it("preserves expired closure through policy extension, deletion and reinsertion", async () => {
    await policy();
    await env.DB.prepare("UPDATE retention_policies SET user_retention_days=100000 WHERE event_id=?")
      .bind(eventId)
      .run();
    expect(await contactPredicate()).toBe(0);
    await env.DB.prepare("DELETE FROM retention_policies WHERE event_id=?").bind(eventId).run();
    await policy(100000);
    expect(await contactPredicate()).toBe(0);
    expect(await readEventContactRetention(env.DB, eventId)).toMatchObject({
      state: "closed",
      closedAt: "2020-01-02T10:00:00.000Z",
    });
  });
  it("captures closure on direct policy deletion and event reassignment while isolating the other event", async () => {
    await policy();
    await env.DB.prepare("DELETE FROM retention_policies WHERE event_id=?").bind(eventId).run();
    expect(await contactPredicate()).toBe(0);
    expect(await contactPredicate(otherEvent)).toBe(1);
    // A separate expired source policy cannot disappear through an UPDATE of its primary key.
    await env.DB.prepare("UPDATE events SET ends_at='2020-02-01T10:00:00.000Z' WHERE id=?").bind(otherEvent).run();
    await env.DB.prepare("INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES(?,2,?)")
      .bind(otherEvent, nowIso())
      .run();
    await env.DB.prepare("UPDATE retention_policies SET event_id=? WHERE event_id=?").bind(eventId, otherEvent).run();
    expect(await contactPredicate(otherEvent)).toBe(0);
    expect(await readEventContactRetention(env.DB, otherEvent)).toMatchObject({ closedAt: "2020-02-03T10:00:00.000Z" });
  });
  it("allows configured future purpose and requires an event end rather than guessing one", async () => {
    await env.DB.prepare("UPDATE events SET ends_at='2099-01-01T10:00:00.000Z' WHERE id=?").bind(eventId).run();
    await policy(0);
    expect(await readEventContactRetention(env.DB, eventId)).toEqual({
      state: "open",
      contactUntil: "2099-01-01T10:00:00.000Z",
      closedAt: null,
    });
    expect(await contactPredicate()).toBe(1);
    await env.DB.prepare("UPDATE events SET ends_at=NULL WHERE id=?").bind(eventId).run();
    expect(await readEventContactRetention(env.DB, eventId)).toEqual({
      state: "unconfigured",
      contactUntil: null,
      closedAt: null,
    });
  });
  it("refuses ordinary evidence/booking/person identities after expiry while aggregate originals survive", async () => {
    const observedAt = "2020-01-01T09:00:00.000Z";
    await env.DB.prepare(
      "INSERT INTO event_attendance_observations(id,event_id,user_id,attendance_mode,observed_at) VALUES(?,?,?,'physical',?)",
    )
      .bind(crypto.randomUUID(), eventId, personId, observedAt)
      .run();
    const before = await eventAttendanceSummary(env.DB, eventId, {});
    await policy();
    for (const operation of [
      () => attendanceEvidence(env.DB, eventId, {}),
      () => sessionAttendancePeople(env.DB, eventId, crypto.randomUUID(), {}),
      () => sessionBookings(env.DB, eventId, crypto.randomUUID(), {}),
    ])
      await expect(operation()).rejects.toMatchObject({ status: 410, code: "EVENT_CONTACT_RETENTION_EXPIRED" });
    const after = await eventAttendanceSummary(env.DB, eventId, {});
    expect(after.observed).toEqual(before.observed);
    expect(after.observed.uniquePeople).toBe(1);
    expect(
      await env.DB.prepare("SELECT observed_at,user_id FROM event_attendance_observations WHERE event_id=?")
        .bind(eventId)
        .first(),
    ).toEqual({ observed_at: observedAt, user_id: personId });
  });
});

it("rejects inconsistent policy states rather than treating a missing deadline as an open or closed purpose", () => {
  for (const value of [
    { state: "open", contactUntil: null, closedAt: null },
    { state: "closed", contactUntil: "2020-01-01T00:00:00.000Z", closedAt: null },
    { state: "unconfigured", contactUntil: "2020-01-01T00:00:00.000Z", closedAt: null },
  ])
    expect(eventContactRetentionSchema.safeParse(value).success).toBe(false);
});
