import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { SELF_CHECK_IN_DAILY_LIMIT } from "../assets/shared/attendance-points";
import {
  attendanceAttributionsResponseSchema,
  selfCheckInsResponseSchema,
} from "../assets/shared/schemas/event-attendance-movement";
import { createAttendancePointFixture } from "./helpers/attendance-point-fixture";

const fixture = createAttendancePointFixture();
const { ids, point, read, record, request, occupancy, studioCode } = fixture;

const count = async (sql: string, ...bindings: unknown[]) =>
  (await env.DB.prepare(sql)
    .bind(...bindings)
    .first<{ total: number }>())!.total;

describe("attendee self check-in", () => {
  beforeEach(fixture.setup);

  it("checks an in-person attendee in to today once and reports it again without a second record", async () => {
    const token = await point("venue_check_in");
    expect((await read("attendee", token)).body).toMatchObject({
      status: "ready",
      target: { action: "check_in", kind: "venue_check_in", dayLabel: "Day 1", room: null, session: null },
    });
    const operationId = crypto.randomUUID();
    const first = await record("attendee", "check-ins", token, operationId);
    expect(first.body).toMatchObject({ status: "checked_in", reason: null, standing: "in_person", booked: null });
    // A retried request returns the same receipt; a new scan reports the existing check-in.
    expect((await record("attendee", "check-ins", token, operationId)).body).toMatchObject({ status: "checked_in" });
    expect((await record("attendee", "check-ins", token)).body).toMatchObject({ status: "already_checked_in" });
    expect((await read("attendee", token)).body).toMatchObject({ status: "already_checked_in" });
    expect(
      await env.DB.prepare(
        "SELECT action,capture_method,attendance_point_kind,attendee_standing,operator_user_id,badge_id,occurrence_id FROM event_scan_attempts",
      ).all(),
    ).toMatchObject({
      results: [
        {
          action: "attendance",
          capture_method: "self",
          attendance_point_kind: "venue_check_in",
          attendee_standing: "in_person",
          operator_user_id: ids.attendee,
          badge_id: null,
          occurrence_id: null,
        },
      ],
    });
    expect(
      await count("SELECT COUNT(*) AS total FROM event_attendance_observations WHERE user_id=?", ids.attendee),
    ).toBe(1);
    // An operation ID belongs to the attendee who used it.
    expect((await record("virtual", "check-ins", token, operationId)).status).toBe(409);
  });

  it("refuses forged, malformed, reissued and other-day codes", async () => {
    const token = await point("venue_check_in");
    const [payload, signature] = token.split(".");
    const forged = `${payload}.${signature!.slice(0, -2)}${signature!.endsWith("AA") ? "BB" : "AA"}`;
    expect((await read("attendee", forged)).body).toEqual({
      status: "refused",
      reason: "invalid_code",
      target: null,
      recordedAt: null,
      standing: null,
      booked: null,
    });
    expect((await read("attendee", "not-a-code")).status).toBe(400);
    expect((await record("attendee", "check-ins", await point("venue_check_in", "tomorrow"))).body).toMatchObject({
      status: "refused",
      reason: "wrong_day",
    });

    const reissued = await request("organizer", "/attendance/points/issuances", { method: "POST" });
    expect(reissued.status).toBe(201);
    expect((await record("attendee", "check-ins", token)).body).toMatchObject({
      status: "refused",
      reason: "invalid_code",
    });
    const fresh = await point("venue_check_in");
    expect(fresh).not.toBe(token);
    expect((await record("attendee", "check-ins", fresh)).body).toMatchObject({ status: "checked_in" });
    expect(
      await count("SELECT COUNT(*) AS total FROM audit_log WHERE action='agenda.attendance.points_reissued'"),
    ).toBe(1);
  });

  it("records people who are not registered or have no in-person place, tells them, and changes nothing else", async () => {
    const token = await point("venue_check_in");
    const before = {
      registrations: await count("SELECT COUNT(*) AS total FROM registrations WHERE event_id=?", ids.event),
      waiting: await count("SELECT COUNT(*) AS total FROM event_day_waitlist_entries WHERE status='waiting'"),
    };
    expect((await read("stranger", token)).body).toMatchObject({ status: "ready", standing: "not_registered" });
    expect((await record("stranger", "check-ins", token)).body).toMatchObject({
      status: "checked_in",
      standing: "not_registered",
    });
    expect((await record("waiting", "check-ins", token)).body).toMatchObject({
      status: "checked_in",
      standing: "no_in_person_place",
    });
    expect(
      (
        await env.DB.prepare(
          "SELECT attempt.attendee_standing,o.attendance_mode FROM event_scan_attempts attempt JOIN event_attendance_observations o ON o.attempt_id=attempt.id WHERE attempt.user_id IN (?,?) ORDER BY attempt.attendee_standing",
        )
          .bind(ids.stranger, ids.waiting)
          .all()
      ).results,
    ).toEqual([
      { attendee_standing: "no_in_person_place", attendance_mode: "physical" },
      { attendee_standing: "not_registered", attendance_mode: "physical" },
    ]);
    // They are in the building, so they count on site.
    expect((await occupancy())[0]).toMatchObject({ checkedIn: 2, onSite: 2 });
    expect(await count("SELECT COUNT(*) AS total FROM registrations WHERE event_id=?", ids.event)).toBe(
      before.registrations,
    );
    expect(await count("SELECT COUNT(*) AS total FROM event_day_waitlist_entries WHERE status='waiting'")).toBe(
      before.waiting,
    );
    expect((await request(null, `/attendance/points/${token}`)).status).toBe(401);
    expect((await request("attendee", "/attendance/points")).status).toBe(403);
  });

  it("records an online registrant's scan as remote, never as in-person attendance", async () => {
    const token = await point("venue_check_in");
    expect((await record("virtual", "check-ins", token)).body).toMatchObject({
      status: "checked_in",
      standing: "remote",
    });
    expect((await record("virtual", "check-ins", token)).body).toMatchObject({ status: "already_checked_in" });
    const onScreen = await studioCode({ kind: "session", occurrenceId: ids.running });
    expect((await record("virtual", "check-ins", onScreen)).body).toMatchObject({
      status: "checked_in",
      standing: "remote",
    });
    expect(
      (
        await env.DB.prepare("SELECT DISTINCT attendance_mode FROM event_attendance_observations WHERE user_id=?")
          .bind(ids.virtual)
          .all()
      ).results,
    ).toEqual([{ attendance_mode: "virtual" }]);
    expect((await occupancy())[0]).toMatchObject({ checkedIn: 0, onSite: 0, available: 2 });
    // Their remote check-out leaves on-site counts alone too.
    const checkOut = await point("venue_check_out");
    expect((await record("virtual", "check-outs", checkOut)).body).toMatchObject({ status: "checked_out" });
    expect((await occupancy())[0]).toMatchObject({ checkedIn: 0, checkedOut: 0, onSite: 0 });
  });

  it("checks in to a session without a booking and says whether a place was booked", async () => {
    const lab = (await fixture.points("?kind=session")).find((item) => item.session?.id === ids.lab)!;
    expect((await read("attendee", lab.token)).body).toMatchObject({ status: "ready", booked: false });
    expect((await record("attendee", "check-ins", lab.token)).body).toMatchObject({
      status: "checked_in",
      standing: "in_person",
      booked: false,
    });
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'physical','reserved',?,?)",
    )
      .bind(crypto.randomUUID(), ids.event, ids.lab, ids.waiting, now, now)
      .run();
    expect((await record("waiting", "check-ins", lab.token)).body).toMatchObject({
      status: "checked_in",
      standing: "no_in_person_place",
      booked: true,
    });
    expect(
      (
        await env.DB.prepare(
          "SELECT user_id,session_booked FROM event_scan_attempts WHERE occurrence_id=? ORDER BY session_booked",
        )
          .bind(ids.lab)
          .all()
      ).results,
    ).toEqual([
      { user_id: ids.attendee, session_booked: 0 },
      { user_id: ids.waiting, session_booked: 1 },
    ]);
    expect(await count("SELECT COUNT(*) AS total FROM agenda_session_participations")).toBe(1);
  });

  it("shows each session's own fixed code on a studio output, which works until a reissue", async () => {
    const listed = (await fixture.points("?kind=session")).find((item) => item.session?.id === ids.running)!;
    // A room on screen shows the code of the session running there, the same code the organizers list.
    expect(await studioCode({ kind: "room", roomId: ids.room })).toBe(listed.token);
    expect(await studioCode({ kind: "session", occurrenceId: ids.running })).toBe(listed.token);
    expect((await record("attendee", "check-ins", listed.token)).body).toMatchObject({ status: "checked_in" });
    expect(await env.DB.prepare("SELECT attendance_point_kind,occurrence_id FROM event_scan_attempts").first()).toEqual(
      { attendance_point_kind: "session", occurrence_id: ids.running },
    );
    await request("organizer", "/attendance/points/issuances", { method: "POST" });
    expect((await read("waiting", listed.token)).body).toMatchObject({ status: "refused", reason: "invalid_code" });
    expect(await studioCode({ kind: "room", roomId: ids.room })).not.toBe(listed.token);
  });

  it("counts one person once, however often they scan", async () => {
    const session = await studioCode({ kind: "session", occurrenceId: ids.running });
    const venue = await point("venue_check_in");
    const outcomes = [];
    for (let scan = 0; scan < 10; scan += 1) {
      outcomes.push((await record("attendee", "check-ins", session)).body.status);
      outcomes.push((await record("attendee", "check-ins", venue)).body.status);
    }
    expect(outcomes.filter((status) => status === "checked_in")).toHaveLength(2);
    expect(await count("SELECT COUNT(*) AS total FROM event_scan_attempts WHERE user_id=?", ids.attendee)).toBe(2);
    expect((await occupancy())[0]).toMatchObject({ checkedIn: 1, onSite: 1, selfCheckIns: 1 });
    const attributions = attendanceAttributionsResponseSchema.parse(
      await (await request("organizer", "/attendance/attributions")).json(),
    );
    expect(attributions.sessions.find((row) => row.session.id === ids.running)).toMatchObject({
      checkedIn: 1,
      attributed: 1,
    });
    const checkIns = selfCheckInsResponseSchema.parse(
      await (await request("organizer", "/attendance/check-ins")).json(),
    );
    expect(checkIns.page.total).toBe(2);
  });

  it("takes the same scan again within seconds as the earlier one, without a new record", async () => {
    const venue = await point("venue_check_in");
    const first = await record("attendee", "check-ins", venue);
    expect(first.body).toMatchObject({ status: "checked_in" });
    // A second camera read of the same code, racing the first, returns the earlier result.
    const again = await Promise.all([record("attendee", "check-ins", venue), record("attendee", "check-ins", venue)]);
    for (const response of again) expect(response.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS total FROM event_scan_attempts WHERE user_id=?", ids.attendee)).toBe(1);
  });

  it("lets someone step out and back in all day, and refuses only past the daily limit", async () => {
    const checkIn = await point("venue_check_in");
    const checkOut = await point("venue_check_out");
    expect((await record("attendee", "check-ins", checkIn)).body).toMatchObject({ status: "checked_in" });
    for (let cycle = 0; cycle < 20; cycle += 1) {
      expect((await record("attendee", "check-outs", checkOut)).body).toMatchObject({ status: "checked_out" });
      expect((await record("attendee", "check-ins", checkIn)).body).toMatchObject({ status: "checked_in" });
    }
    const written = 41;
    expect(await count("SELECT COUNT(*) AS total FROM event_scan_attempts WHERE user_id=?", ids.attendee)).toBe(
      written,
    );
    // Presence counts the person once; their movement keeps every scan.
    expect((await occupancy())[0]).toMatchObject({ checkedIn: 1, checkedOut: 0, onSite: 1 });
    expect(
      await count("SELECT COUNT(*) AS total FROM event_attendance_observations WHERE user_id=?", ids.attendee),
    ).toBe(written);

    // Fill the rest of the day's allowance with copies of the person's own scans.
    const columns = (
      await env.DB.prepare("SELECT name FROM pragma_table_info('event_scan_attempts')").all<{ name: string }>()
    ).results.map((column) => column.name);
    const copied = columns.map((name) =>
      name === "id" || name === "operation_id"
        ? "lower(hex(randomblob(16)))"
        : name === "request_hash"
          ? "'filler'"
          : name,
    );
    await env.DB.prepare(
      `INSERT INTO event_scan_attempts(${columns.join(",")}) SELECT ${copied.join(",")} FROM event_scan_attempts
       CROSS JOIN (SELECT 1 FROM event_scan_attempts LIMIT 3) WHERE user_id=? AND action='checkout' LIMIT ?`,
    )
      .bind(ids.attendee, SELF_CHECK_IN_DAILY_LIMIT - written)
      .run();
    expect(await count("SELECT COUNT(*) AS total FROM event_scan_attempts WHERE user_id=?", ids.attendee)).toBe(
      SELF_CHECK_IN_DAILY_LIMIT,
    );
    expect((await read("attendee", checkOut)).body).toMatchObject({ status: "refused", reason: "daily_limit" });
    expect((await record("attendee", "check-outs", checkOut)).body).toMatchObject({
      status: "refused",
      reason: "daily_limit",
    });
    expect(await count("SELECT COUNT(*) AS total FROM event_scan_attempts WHERE user_id=?", ids.attendee)).toBe(
      SELF_CHECK_IN_DAILY_LIMIT,
    );
    // Someone else is not affected.
    expect((await record("waiting", "check-ins", checkIn)).body).toMatchObject({ status: "checked_in" });
  });

  it("checks out only while checked in and lowers the on-site count without touching registration or the waiting list", async () => {
    const checkIn = await point("venue_check_in");
    const checkOut = await point("venue_check_out");
    expect((await record("attendee", "check-outs", checkOut)).body).toMatchObject({ reason: "not_checked_in" });
    expect((await record("attendee", "check-outs", checkIn)).status).toBe(400);
    await record("attendee", "check-ins", checkIn);
    expect((await occupancy())[0]).toMatchObject({ checkedIn: 1, checkedOut: 0, onSite: 1, capacity: 2, available: 1 });

    const before = {
      outbox: await count("SELECT COUNT(*) AS total FROM email_outbox"),
      waiting: await count("SELECT COUNT(*) AS total FROM event_day_waitlist_entries WHERE status='waiting'"),
    };
    expect((await read("attendee", checkOut)).body).toMatchObject({ status: "ready", target: { action: "check_out" } });
    expect((await record("attendee", "check-outs", checkOut)).body).toMatchObject({ status: "checked_out" });
    expect((await record("attendee", "check-outs", checkOut)).body).toMatchObject({ status: "already_checked_out" });
    expect((await occupancy())[0]).toMatchObject({
      dayDate: fixture.dates.today,
      checkedIn: 1,
      checkedOut: 1,
      onSite: 0,
      available: 2,
      selfCheckIns: 1,
      staffCheckIns: 0,
    });
    expect(await count("SELECT COUNT(*) AS total FROM email_outbox")).toBe(before.outbox);
    expect(await count("SELECT COUNT(*) AS total FROM event_day_waitlist_entries WHERE status='waiting'")).toBe(
      before.waiting,
    );
    expect(
      await count("SELECT COUNT(*) AS total FROM registrations WHERE event_id=? AND status='registered'", ids.event),
    ).toBe(3);

    // Coming back in is a new check-in.
    expect((await record("attendee", "check-ins", checkIn)).body).toMatchObject({ status: "checked_in" });
    expect((await occupancy())[0]).toMatchObject({ checkedIn: 1, checkedOut: 0, onSite: 1 });
    const current = await request("attendee", "/attendance/check-ins/current");
    expect(await current.json()).toMatchObject({ dayLabel: "Day 1", venue: "checked_in" });
  });

  it("resolves a room code to the session running there and refuses a session code before it opens", async () => {
    const room = await point("room");
    expect((await read("attendee", room)).body).toMatchObject({
      status: "ready",
      target: { kind: "room", room: { id: ids.room, name: "Main hall" }, session: { id: ids.running } },
    });
    expect((await record("attendee", "check-ins", room)).body).toMatchObject({ status: "checked_in" });
    expect(
      await env.DB.prepare("SELECT occurrence_id,room_id FROM event_attendance_observations WHERE user_id=?")
        .bind(ids.attendee)
        .first(),
    ).toEqual({ occurrence_id: ids.running, room_id: ids.room });
    expect((await record("attendee", "check-ins", room)).body).toMatchObject({ status: "already_checked_in" });
    expect((await record("virtual", "check-ins", room)).body).toMatchObject({
      status: "checked_in",
      standing: "remote",
    });

    const sessions = await fixture.points("?kind=session");
    const later = sessions.find((item) => item.session?.id === ids.later)!;
    expect((await record("attendee", "check-ins", later.token)).body).toMatchObject({
      status: "refused",
      reason: "session_not_open",
    });
    const current = await request("attendee", "/attendance/check-ins/current");
    expect(await current.json()).toMatchObject({ venue: "none", lastSession: { title: "Opening keynote" } });
  });
});
