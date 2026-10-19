import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  attendanceAttributionsResponseSchema,
  attendanceMovementsResponseSchema,
  selfCheckInsResponseSchema,
} from "../assets/shared/schemas/event-attendance-movement";
import { createAttendancePointFixture } from "./helpers/attendance-point-fixture";

const fixture = createAttendancePointFixture();
const { ids, point, record, request, studioCode } = fixture;

async function report<T>(path: string, schema: { parse(value: unknown): T }) {
  const response = await request("organizer", path);
  expect(response.status).toBe(200);
  return schema.parse(await response.json());
}

/**
 * The lab (running since five minutes ago, needs a reservation) and the keynote
 * (running since a minute ago) overlap. The attendee sat in the lab without a
 * reservation from its start, then moved to the keynote now and stays to its
 * end; the stranger checks in to the keynote from its screen; the online
 * registrant scans the keynote's screen code from the livestream.
 */
async function sessionDay() {
  const lab = (await fixture.points("?kind=session")).find((item) => item.session?.id === ids.lab)!;
  await record("attendee", "check-ins", lab.token);
  await env.DB.prepare("UPDATE event_attendance_observations SET observed_at=? WHERE user_id=? AND occurrence_id=?")
    .bind(new Date(Date.now() - 5 * 60_000).toISOString(), ids.attendee, ids.lab)
    .run();
  await record("attendee", "check-ins", await point("room"));
  const onScreen = await studioCode({ kind: "room", roomId: ids.room });
  await record("stranger", "check-ins", onScreen);
  await record("virtual", "check-ins", onScreen);
}

describe("attendance reports from self check-in", () => {
  beforeEach(fixture.setup);

  it("lists everyone who checked in without being registered or booked, and remote check-ins apart", async () => {
    await sessionDay();
    const unexpected = await report("/attendance/check-ins?expected=no&sort=name", selfCheckInsResponseSchema);
    expect(unexpected.checkIns.map((row) => [row.person.userId, row.session?.id, row.standing, row.booked])).toEqual(
      expect.arrayContaining([
        [ids.attendee, ids.lab, "in_person", false],
        [ids.stranger, ids.running, "not_registered", true],
      ]),
    );
    expect(unexpected.page.total).toBe(2);
    const remote = await report("/attendance/check-ins?standing=remote", selfCheckInsResponseSchema);
    expect(remote.checkIns).toMatchObject([
      { person: { userId: ids.virtual }, expected: true, room: { name: "Main hall" } },
    ]);
    expect((await report("/attendance/check-ins?booking=not_booked", selfCheckInsResponseSchema)).page.total).toBe(1);
    expect((await request("attendee", "/attendance/check-ins")).status).toBe(403);
  });

  it("attributes overlapping sessions to the one each person stayed in longest, never counting remote viewers", async () => {
    await sessionDay();
    const { sessions } = await report("/attendance/attributions?sort=startAt", attendanceAttributionsResponseSchema);
    const bySession = Object.fromEntries(sessions.map((row) => [row.session.id, row]));
    expect(bySession[ids.lab]).toMatchObject({
      checkedIn: 1,
      attributed: 0,
      remote: 0,
      unexpected: 1,
    });
    expect(bySession[ids.running]).toMatchObject({
      checkedIn: 2,
      attributed: 2,
      remote: 1,
      unexpected: 1,
    });
    expect(bySession[ids.later]).toMatchObject({ checkedIn: 0, attributed: 0 });
    expect((await request("attendee", "/attendance/attributions")).status).toBe(403);
  });

  it("shows each person's movement between sessions with the time spent in each", async () => {
    await sessionDay();
    const { people } = await report(
      `/attendance/movements?userId=${ids.attendee}&dayDate=${fixture.dates.today}`,
      attendanceMovementsResponseSchema,
    );
    expect(people).toHaveLength(1);
    const [lab, keynote] = people[0]!.stays;
    // Five minutes of a 45-minute lab is too short to count there.
    expect(lab).toMatchObject({ session: { id: ids.lab, title: "Hands-on lab" }, tooShort: true, attributed: false });
    expect(keynote).toMatchObject({
      session: { id: ids.running, room: { name: "Main hall" } },
      tooShort: false,
      attributed: true,
    });
    // About five minutes in the lab, then the keynote until it ends in about fifty.
    expect(lab!.dwellSeconds).toBeGreaterThan(4 * 60);
    expect(lab!.dwellSeconds).toBeLessThan(6 * 60);
    expect(keynote!.dwellSeconds).toBeGreaterThan(45 * 60);
    expect(keynote!.leftAt).toBe(keynote!.session.endAt);
    // The online registrant is not part of in-person movement.
    const everyone = await report("/attendance/movements", attendanceMovementsResponseSchema);
    expect(everyone.people.map((row) => row.person.userId).sort()).toEqual([ids.attendee, ids.stranger].sort());
  });

  it("counts a stay from the event's minimum share of the session, which organizers can change", async () => {
    await sessionDay();
    const movement = () => report(`/attendance/movements?userId=${ids.attendee}`, attendanceMovementsResponseSchema);
    expect((await movement()).minimumStayPercent).toBe(50);
    const event = (await (await request("organizer", "")).json()) as { event: { updatedAt: string } };
    const save = (minimumStayPercent: number) =>
      request("organizer", "/settings", {
        method: "PATCH",
        body: JSON.stringify({ attendance: { minimumStayPercent }, expectedUpdatedAt: event.event.updatedAt }),
      });
    expect((await save(5)).status).toBe(400);
    expect((await save(10)).status).toBe(200);
    const lowered = await movement();
    expect(lowered.minimumStayPercent).toBe(10);
    // Five of 45 minutes now counts, though the longer keynote next door still wins the overlap.
    expect(lowered.people[0]!.stays[0]).toMatchObject({ session: { id: ids.lab }, tooShort: false, attributed: false });
    expect((await report("/attendance/attributions", attendanceAttributionsResponseSchema)).minimumStayPercent).toBe(
      10,
    );
  });
});
