import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import ICAL from "ical.js";
import { beforeEach, describe, expect, it } from "vitest";
import app from "./helpers/app";
import type { Env } from "../functions/_lib/types";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration } from "../functions/_lib/services/registrations";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { buildRegistrationIcs, calendarConfirmedDays } from "../functions/_lib/utils/calendar";
import { seedSessionAttendanceDays } from "./helpers/session-attendance-days";
import { resetDb } from "./helpers/reset-db";
import { fetchEventParticipation } from "../functions/_lib/services/events/participation";

const signingSecret = "personal-event-calendar-test-secret";

async function download(registrationId: string, token?: string) {
  return app.fetch(
    new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/calendar.ics`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { ...(env as unknown as Env), INTERNAL_SIGNING_SECRET: signingSecret, RSVP_EMAIL: "rsvp@example.test" },
    createExecutionContext(),
  );
}

describe("personal event calendar", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
  });

  it("uses configured access, local day times, and excludes unconfirmed attendance", async () => {
    const event = {
      ...(await getEventBySlug(env.DB, "pqc-2026")),
      timezone: "Europe/Amsterdam",
      starts_at: "2026-03-28T08:00:00.000Z",
      ends_at: "2026-03-28T17:00:00.000Z",
    };
    const days = [
      { dayDate: "2026-03-29", attendanceType: "moon_base", label: "Sunday", accessMode: "physical" as const },
      { dayDate: "2026-03-30", attendanceType: "lunar_stream", label: "Monday", accessMode: "remote" as const },
    ];
    const selected = calendarConfirmedDays(days, [{ dayDate: "2026-03-30", status: "waiting" }]);
    const result = await buildRegistrationIcs(event, "registration", "https://example.test/manage", selected);
    const calendar = new ICAL.Component(ICAL.parse(result.files[0]!.content));
    const entries = calendar.getAllSubcomponents("vevent");
    expect(entries).toHaveLength(1);
    expect(String(entries[0]!.getFirstPropertyValue("dtstart"))).toBe("2026-03-29T07:00:00Z");
    for (const status of ["waiting", "offered", "expired"]) {
      expect(calendarConfirmedDays(days, [{ dayDate: days[0]!.dayDate, status }])).toEqual([days[1]]);
    }
    expect(calendarConfirmedDays(days, [{ dayDate: days[0]!.dayDate, status: "accepted" }])).toEqual(days);
    expect((await buildRegistrationIcs(event, "registration", "https://example.test/manage", [])).files).toEqual([]);
    expect(
      (await buildRegistrationIcs(event, "registration", "https://example.test/manage", [days[1]!])).files,
    ).toHaveLength(1);
    expect(
      (
        await buildRegistrationIcs(event, "registration", "https://example.test/manage", [
          { ...days[0]!, accessMode: "none" },
        ])
      ).files,
    ).toEqual([]);
  });

  it("downloads the active attendee's existing calendar identity and denies other identities", async () => {
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const attendeeEmail = `calendar-attendee-${crypto.randomUUID()}@example.test`;
    const attendeeId = await insertUser(env.DB, attendeeEmail);
    await seedSessionAttendanceDays(env.DB, event.id, ["2026-05-20"], "on_demand");
    await env.DB.prepare("UPDATE event_days SET attendance_options_json=? WHERE event_id=?")
      .bind(
        JSON.stringify([
          { value: "on_demand", label: "On demand", accessMode: "none" },
          { value: "virtual", label: "Virtual", accessMode: "remote" },
        ]),
        event.id,
      )
      .run();
    const [other] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    const created = await createRegistration(env.DB, {
      event,
      userId: attendeeId,
      dayAttendance: [{ dayDate: "2026-05-20", attendanceType: "on_demand" }],
      sourceType: "direct",
      signingSecret,
    });
    const registrationId = created.registration.id;
    await env.DB.prepare("UPDATE registrations SET status = 'registered' WHERE id = ?").bind(registrationId).run();
    expect(
      (await fetchEventParticipation(env.DB, attendeeId, [event.id]).then((rows) => rows.get(event.id)))
        ?.calendarAvailable,
    ).toBe(false);
    await env.DB.prepare("UPDATE registration_day_attendance SET attendance_type='virtual' WHERE registration_id=?")
      .bind(registrationId)
      .run();
    expect(
      (await fetchEventParticipation(env.DB, attendeeId, [event.id]).then((rows) => rows.get(event.id)))
        ?.calendarAvailable,
    ).toBe(true);
    const attendeeToken = await createAdminSession(env.DB, attendeeId, crypto.randomUUID(), signingSecret);
    const otherToken = await createAdminSession(env.DB, other.id, crypto.randomUUID(), signingSecret);

    expect((await download(registrationId)).status).toBe(401);
    expect((await download(registrationId, otherToken)).status).toBe(404);
    const response = await download(registrationId, attendeeToken);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("pqc-2026-personal.ics");
    const calendar = new ICAL.Component(ICAL.parse(await response.text()));
    const invitation = calendar.getFirstSubcomponent("vevent")!;
    expect(String(invitation.getFirstPropertyValue("uid"))).toContain(registrationId);
    expect(String(invitation.getFirstPropertyValue("attendee"))).toContain(attendeeEmail);
    expect(String(invitation.getFirstPropertyValue("organizer"))).toContain("rsvp");

    await env.DB.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").bind(registrationId).run();
    expect((await download(registrationId, attendeeToken)).status).toBe(404);
  });
});
