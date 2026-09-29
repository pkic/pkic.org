import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import ICAL from "ical.js";
import app from "../functions/router";
import { meetingCalendarThrough, outboundMeetingLocation } from "../assets/shared/meeting-calendar-policy";
import { eventSeriesCreateSchema, eventSeriesResponseSchema } from "../assets/shared/schemas/event-series";
import {
  createGroupEventSeries,
  updateGroupEventSeries,
  createSeriesOccurrence,
  updateSeriesOccurrence,
  getSeriesOccurrence,
  cancelGroupEventSeries,
  getGroupEventSeries,
  listOccurrenceInvitations,
} from "../functions/_lib/services/event-series";
import { runAutomaticMeetingInvitations } from "../functions/_lib/services/event-series/automatic-invitations";
import { renewMeetingCalendars } from "../functions/_lib/services/event-series/calendar-schedule";
import { buildSeriesCalendarPayload } from "../functions/_lib/services/event-series/series-calendar";
import { materializeSeriesOccurrences } from "../functions/_lib/services/event-series/recurrence";
import { recordCalendarRsvpEvent, normalizeCalendarRsvp } from "../functions/_lib/services/calendar-rsvp";
import { verifySignedRsvpAddressFull } from "../functions/_lib/email/rsvp";
import type { AuthAdmin } from "../functions/_lib/types";
import { insertUser } from "./helpers/membership";
import { ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import { mutateBeforeNextBatch } from "./helpers/database-races";

const GROUP = "20000000-0000-4000-8000-000000000003";
const BASE = "https://app.test";
const signingSecret = "meeting-series-calendar-signing-secret";
let admin: AuthAdmin;
let email: string;
let userId: string;
const options = { signingSecret };
function input() {
  return eventSeriesCreateSchema.parse({
    eventName: "Forms working session",
    eventSlug: `forms-${crypto.randomUUID()}`,
    policy: { registrationPolicy: "automatic", memberEligibility: "owner_group", guestPolicy: "none" },
    startsAt: new Date(Date.now() + 86400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    recurrenceRule: "FREQ=WEEKLY;COUNT=3",
    timezone: "Europe/Amsterdam",
    durationMinutes: 60,
  });
}
async function deliveries() {
  const rows = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE idempotency_key LIKE 'meeting-series-invitation:%' ORDER BY rowid",
  );
  return rows.map((row) => {
    const payload = JSON.parse(row.payload_json);
    return new ICAL.Component(ICAL.parse(payload.__calendarInvite.icsFiles[0].content));
  });
}
async function occurrences(seriesId: string) {
  return queryAll<{ id: string; starts_at: string; ends_at: string; updated_at: string }>(
    env.DB,
    "SELECT id, starts_at, ends_at, updated_at FROM event_occurrences WHERE series_id = ? ORDER BY starts_at",
    seriesId,
  );
}
async function dispatch(seriesId: string, limit = 20) {
  return runAutomaticMeetingInvitations(env.DB, BASE, limit, undefined, { ...options, seriesId });
}

beforeEach(async () => {
  await resetDb();
  const id = await insertUser(env.DB, "calendar-admin@example.test");
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  admin = { identityType: "user", id, email: "calendar-admin@example.test", role: "admin" };
  email = "organization-user@example.test";
  userId = await insertUser(env.DB, email);
  await ensureGroupMembershipCapacity(env.DB, GROUP, userId);
});

describe("recurring meeting calendars", () => {
  it("treats provider URLs as private destinations rather than public locations", () => {
    expect(outboundMeetingLocation("Room 12, Amsterdam")).toBe("Room 12, Amsterdam");
    for (const location of [
      "https://teams.example.test/private-room",
      "Teams: teams.example.test/private-room",
      "www.meet.example.test/private-room",
    ]) {
      expect(outboundMeetingLocation(location)).toBeNull();
      expect(eventSeriesCreateSchema.safeParse({ ...input(), location }).success).toBe(false);
    }
  });
  it("downloads the signed-in member's personal recurring invitation without exposing the provider URL", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    const privateUrl = "https://teams.example.test/private-room";
    await env.DB.prepare("UPDATE event_series SET location = ? WHERE id = ?").bind(privateUrl, series.id).run();
    const token = await createMemberSession(env.DB, userId, "personal-series-calendar", signingSecret);
    const response = await app.fetch(
      new Request(`${BASE}/api/v1/groups/${GROUP}/meetings/series/${series.id}/calendar.ics?personal=true`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { ...env, INTERNAL_SIGNING_SECRET: signingSecret } as typeof env,
      createExecutionContext(),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("-personal.ics");
    const calendar = new ICAL.Component(ICAL.parse(await response.text()));
    expect(calendar.getFirstPropertyValue("method")).toBe("REQUEST");
    const master = calendar.getFirstSubcomponent("vevent")!;
    expect(String(master.getFirstPropertyValue("attendee"))).toContain(email);
    expect(String(master.getFirstPropertyValue("organizer"))).toContain("mailto:");
    expect(String(master.getFirstPropertyValue("url"))).toMatch(/^https:\/\/app\.test\/m\/#token=m2\./);
    expect(master.getFirstSubcomponent("valarm")?.getFirstPropertyValue("action")).toBe("DISPLAY");
    expect(master.hasProperty("location")).toBe(false);
    expect(calendar.toString()).not.toContain(privateUrl);
  });
  it("downloads one selected occurrence and rejects invalid or unrelated occurrence IDs", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    const [first] = await occurrences(series.id);
    const token = await createAdminSession(env.DB, admin.id, "calendar-download-session");
    const url = `${BASE}/api/v1/groups/${GROUP}/meetings/series/${series.id}/calendar.ics`;
    async function download(query: string, authenticated = true) {
      const context = createExecutionContext();
      const response = await app.fetch(
        new Request(url + query, {
          headers: authenticated ? { authorization: `Bearer ${token}` } : {},
        }),
        env,
        context,
      );
      await waitOnExecutionContext(context);
      return response;
    }
    const response = await download(`?occurrenceId=${first.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/forms-working-session\.ics/);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const calendar = new ICAL.Component(ICAL.parse(await response.text()));
    expect(calendar.hasProperty("method")).toBe(false);
    const events = calendar.getAllSubcomponents("vevent");
    expect(events).toHaveLength(1);
    expect(events[0].hasProperty("rrule")).toBe(false);
    expect(events[0].hasProperty("attendee")).toBe(false);
    expect(String(events[0].getFirstPropertyValue("description"))).toContain("do not forward");
    expect((events[0].getFirstPropertyValue("dtstart") as ICAL.Time).toJSDate().toISOString()).toBe(first.starts_at);
    expect((await download("?occurrenceId=invalid")).status).toBe(400);
    expect((await download(`?occurrenceId=${crypto.randomUUID()}`)).status).toBe(404);
    expect((await download(`?occurrenceId=${first.id}`, false)).status).toBe(401);
  });

  it("uses the meeting's year-end and renews from October, including future series", () => {
    expect(meetingCalendarThrough("2026-01-01T10:00:00.000Z", "Europe/Amsterdam", "2026-09-30T21:59:59.000Z")).toBe(
      "2026-12-31T22:59:59.999Z",
    );
    expect(meetingCalendarThrough("2026-01-01T10:00:00.000Z", "Europe/Amsterdam", "2026-09-30T22:00:00.000Z")).toBe(
      "2027-12-31T22:59:59.999Z",
    );
    expect(meetingCalendarThrough("2029-06-01T10:00:00.000Z", "UTC", "2026-09-01T00:00:00.000Z")).toBe(
      "2029-12-31T23:59:59.999Z",
    );
  });

  it("renews the year-end horizon once in October and preserves daylight-saving wall clocks", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, {
      ...input(),
      startsAt: "2099-09-01T08:00:00.000Z",
      recurrenceRule: "FREQ=WEEKLY",
    });
    await dispatch(series.id);
    const original = await occurrences(series.id);
    expect(original.at(-1)!.starts_at.slice(0, 4)).toBe("2099");
    await renewMeetingCalendars(env.DB, series.id, "2099-10-01T10:00:00.000Z");
    const extended = await occurrences(series.id);
    expect(extended.at(-1)!.starts_at.slice(0, 4)).toBe("2100");
    expect(
      extended.filter((row) => row.starts_at.startsWith("2100-01")).every((row) => row.starts_at.includes("T09:00")),
    ).toBe(true);
    expect(
      extended.filter((row) => row.starts_at.startsWith("2100-07")).every((row) => row.starts_at.includes("T08:00")),
    ).toBe(true);
    expect(await dispatch(series.id)).toEqual({ queued: 1 });
    await renewMeetingCalendars(env.DB, series.id, "2099-10-03T10:00:00.000Z");
    expect(await dispatch(series.id)).toEqual({ queued: 0 });
    expect(await occurrences(series.id)).toEqual(extended);
    const calendars = await deliveries();
    expect(calendars).toHaveLength(2);
    expect(calendars[1].getFirstSubcomponent("vevent")!.getFirstPropertyValue("uid")).toBe(`${series.id}@pkic.org`);
    const iterator = new ICAL.Event(calendars[1].getFirstSubcomponent("vevent")!).iterator();
    const expanded: string[] = [];
    for (let occurrence = iterator.next(); occurrence; occurrence = iterator.next()) {
      expanded.push(occurrence.toJSDate().toISOString());
      if (expanded.length > 200) throw new Error("Calendar recurrence exceeded its horizon");
    }
    expect(expanded).toEqual(extended.map((row) => row.starts_at));
  });

  it("anchors a weekday rule to its first actual occurrence without a phantom start", () => {
    const calendar = buildSeriesCalendarPayload(
      {
        id: "forms-series",
        event_id: "forms-event",
        owner_group_id: GROUP,
        event_name: "Forms session",
        starts_at: "2026-09-14T08:00:00.123Z",
        recurrence_rule: "FREQ=WEEKLY;BYDAY=WE",
        duration_minutes: 60,
        timezone: "Europe/Amsterdam",
        location: null,
        calendar_revision: 1,
        calendar_through: "2026-12-31T23:00:00.000Z",
      },
      [],
      { baseUrl: BASE, cancelled: false, now: "2026-09-14T00:00:00.000Z", published: true },
    );
    const parsed = new ICAL.Component(ICAL.parse(calendar.inlineContent!));
    expect(
      (parsed.getFirstSubcomponent("vevent")!.getFirstPropertyValue("dtstart") as ICAL.Time).toJSDate().toISOString(),
    ).toBe("2026-09-16T08:00:00.000Z");
    expect(parsed.hasProperty("method")).toBe(false);
  });

  it("creates occurrences through the mounted route and queues one calendar with a signed RSVP organizer", async () => {
    const token = await createAdminSession(env.DB, admin.id, "calendar-test-session");
    const context = createExecutionContext();
    const response = await app.fetch(
      new Request(`${BASE}/api/v1/groups/${GROUP}/meetings/series`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input()),
      }),
      env,
      context,
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const { series } = eventSeriesResponseSchema.parse(await response.json());
    await waitOnExecutionContext(context);
    expect(await occurrences(series.id)).toHaveLength(3);
    const calendars = await deliveries();
    expect(calendars).toHaveLength(1);
    const master = calendars[0].getFirstSubcomponent("vevent")!;
    expect(master.getFirstPropertyValue("uid")).toBe(`${series.id}@pkic.org`);
    expect(master.getFirstPropertyValue("rrule")).toMatchObject({ count: 3 });
    expect(master.hasProperty("rdate")).toBe(false);
    expect(calendars[0].getFirstSubcomponent("vtimezone")).not.toBeNull();
    const organizer = String(master.getFirstPropertyValue("organizer")).replace("mailto:", "");
    expect(
      (await verifySignedRsvpAddressFull(organizer, env.INTERNAL_SIGNING_SECRET!, env.RSVP_EMAIL))?.registrationId,
    ).toBe(series.id);
    expect(await dispatch(series.id)).toEqual({ queued: 0 });
  });

  it("generates the schedule immediately when an empty meeting is rescheduled", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, {
      ...input(),
      startsAt: "2000-01-01T10:00:00.000Z",
      recurrenceRule: "FREQ=WEEKLY;COUNT=1",
    });
    expect(await occurrences(series.id)).toHaveLength(0);
    await updateGroupEventSeries(env.DB, admin, GROUP, series.id, {
      expectedUpdatedAt: series.updatedAt,
      startsAt: input().startsAt,
    });
    expect(await occurrences(series.id)).toHaveLength(1);
    expect(await dispatch(series.id)).toEqual({ queued: 1 });
  });

  it("updates a moved or cancelled exception and adds an extra occurrence without duplicate calendars", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    await dispatch(series.id);
    const [first] = await occurrences(series.id);
    const moved = await updateSeriesOccurrence(
      env.DB,
      admin,
      GROUP,
      series.id,
      first.id,
      {
        expectedUpdatedAt: first.updated_at,
        startsAt: new Date(Date.parse(first.starts_at) + 3600_000).toISOString(),
        endsAt: new Date(Date.parse(first.ends_at) + 3600_000).toISOString(),
      },
      "",
    );
    await dispatch(series.id);
    const messages = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'meeting-series-invitation' ORDER BY rowid",
    );
    const updateMessage = JSON.parse(messages[1].payload_json);
    expect(updateMessage.isUpdate).toBe(true);
    expect(updateMessage.changedOccurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ moved: true, originalStartsAt: first.starts_at, startsAt: moved.startsAt }),
      ]),
    );
    let calendars = await deliveries();
    const update = calendars[1].getAllSubcomponents("vevent");
    expect(update).toHaveLength(2);
    expect((update[1].getFirstPropertyValue("recurrence-id") as ICAL.Time).toJSDate().toISOString()).toBe(
      first.starts_at,
    );
    expect(update[1].getFirstPropertyValue("uid")).toBe(`${series.id}@pkic.org`);
    await materializeSeriesOccurrences(env.DB, admin, GROUP, series.id, {
      through: new Date(Date.now() + 30 * 86400_000).toISOString(),
      maxOccurrences: 30,
    });
    expect(await occurrences(series.id)).toHaveLength(3);
    await updateSeriesOccurrence(
      env.DB,
      admin,
      GROUP,
      series.id,
      first.id,
      { expectedUpdatedAt: moved.updatedAt, status: "cancelled" },
      "",
    );
    await createSeriesOccurrence(
      env.DB,
      admin,
      GROUP,
      series.id,
      {
        startsAt: new Date(Date.now() + 4 * 86400_000).toISOString(),
        endsAt: new Date(Date.now() + 4 * 86400_000 + 3600_000).toISOString(),
      },
      "",
    );
    await dispatch(series.id);
    calendars = await deliveries();
    const latest = calendars.at(-1)!;
    expect(latest.getFirstSubcomponent("vevent")!.getFirstProperty("rdate")!.getValues()).toHaveLength(1);
    expect(
      latest.getAllSubcomponents("vevent").some((item) => item.getFirstPropertyValue("status") === "CANCELLED"),
    ).toBe(true);
    const current = await getGroupEventSeries(env.DB, GROUP, series.id);
    await cancelGroupEventSeries(env.DB, admin, GROUP, series.id, current.updatedAt);
    await dispatch(series.id);
    expect((await deliveries()).at(-1)!.getFirstPropertyValue("method")).toBe("CANCEL");
  });

  it("rejects duplicate calendar instances that differ only in milliseconds", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    const [first] = await occurrences(series.id);
    await expect(
      createSeriesOccurrence(
        env.DB,
        admin,
        GROUP,
        series.id,
        {
          startsAt: first.starts_at.replace(".000Z", ".123Z"),
          endsAt: first.ends_at,
        },
        "",
      ),
    ).rejects.toMatchObject({ code: "EVENT_OCCURRENCE_EXISTS", status: 409 });
    expect(await occurrences(series.id)).toHaveLength(3);
  });

  it("keeps extra occurrences in later years at their IANA local time", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    const year = new Date().getUTCFullYear() + 3;
    const startsAt = `${year}-07-01T08:00:00.000Z`;
    await createSeriesOccurrence(
      env.DB,
      admin,
      GROUP,
      series.id,
      {
        startsAt,
        endsAt: `${year}-07-01T09:00:00.000Z`,
      },
      "",
    );
    await dispatch(series.id);
    const master = (await deliveries())[0].getFirstSubcomponent("vevent")!;
    const extra = master.getFirstProperty("rdate")!.getFirstValue() as ICAL.Time;
    expect(extra.toJSDate().toISOString()).toBe(startsAt);
    expect(extra.hour).toBe(10);
  });

  it("retains a past cancellation when replacing the recurring master", async () => {
    const startsAt = new Date(Date.now() - 40 * 86400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const series = await createGroupEventSeries(env.DB, admin, GROUP, {
      ...input(),
      startsAt,
      recurrenceRule: "FREQ=WEEKLY",
    });
    const past = await createSeriesOccurrence(
      env.DB,
      admin,
      GROUP,
      series.id,
      {
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 3600_000).toISOString(),
      },
      "",
    );
    await updateSeriesOccurrence(
      env.DB,
      admin,
      GROUP,
      series.id,
      past.id,
      {
        expectedUpdatedAt: past.updatedAt,
        status: "cancelled",
      },
      "",
    );
    await dispatch(series.id);
    const events = (await deliveries())[0].getAllSubcomponents("vevent");
    expect(
      events.some(
        (item) =>
          item.getFirstPropertyValue("status") === "CANCELLED" &&
          (item.getFirstPropertyValue("recurrence-id") as ICAL.Time).toJSDate().toISOString() === startsAt,
      ),
    ).toBe(true);
  });

  it("records series replies and an individual exception against the original time", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    await dispatch(series.id);
    const [first, second] = await occurrences(series.id);
    const reply = {
      registrationId: series.id,
      icsUid: `${series.id}@pkic.org`,
      attendeeEmail: email,
      responseStatus: "accepted" as const,
      provider: "test",
      sourceMessageId: "series-yes",
    };
    await recordCalendarRsvpEvent(env.DB, reply);
    expect((await getSeriesOccurrence(env.DB, GROUP, series.id, first.id)).occurrence.rsvp.accepted).toBe(1);
    const recurrence = first.starts_at.replace(/[-:]/g, "").replace(".000Z", "Z");
    const parsed = normalizeCalendarRsvp({
      provider: "test",
      sourceMessageId: "one-no",
      calendarIcs: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REPLY\r\nBEGIN:VEVENT\r\nUID:${series.id}@pkic.org\r\nRECURRENCE-ID:${recurrence}\r\nATTENDEE;PARTSTAT=DECLINED:mailto:${email}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    });
    await recordCalendarRsvpEvent(env.DB, parsed);
    expect((await getSeriesOccurrence(env.DB, GROUP, series.id, first.id)).occurrence.rsvp.declined).toBe(1);
    expect((await getSeriesOccurrence(env.DB, GROUP, series.id, second.id)).occurrence.rsvp.accepted).toBe(1);
    const list = await listOccurrenceInvitations(env.DB, admin, GROUP, series.id, first.id, {
      limit: 25,
      offset: 0,
      sort: "name",
    });
    expect(list.invitations[0].response).toBe("declined");
    await expect(
      recordCalendarRsvpEvent(env.DB, { ...reply, attendeeEmail: "uninvited@example.test" }),
    ).rejects.toMatchObject({ code: "MEETING_RSVP_NOT_INVITED" });
  });

  it("pages recipients, cancels a departing user's calendar, and re-invites on rejoining", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    const another = await insertUser(env.DB, "second@example.test");
    await ensureGroupMembershipCapacity(env.DB, GROUP, another);
    expect(await dispatch(series.id, 1)).toEqual({ queued: 1 });
    expect(await dispatch(series.id, 1)).toEqual({ queued: 1 });
    expect(await dispatch(series.id, 1)).toEqual({ queued: 0 });
    await env.DB.prepare("UPDATE group_memberships SET left_at = ? WHERE user_id = ?")
      .bind(new Date().toISOString(), userId)
      .run();
    await dispatch(series.id);
    expect((await deliveries()).at(-1)!.getFirstPropertyValue("method")).toBe("CANCEL");
    await env.DB.prepare("UPDATE group_memberships SET left_at = NULL WHERE user_id = ?").bind(userId).run();
    await dispatch(series.id);
    expect((await deliveries()).at(-1)!.getFirstPropertyValue("method")).toBe("REQUEST");
    expect(await dispatch(series.id)).toEqual({ queued: 0 });
  });

  it("leaves an unsigned invitation pending and retries safely within a bounded query budget", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    await expect(
      runAutomaticMeetingInvitations(env.DB, BASE, 20, undefined, { seriesId: series.id }),
    ).rejects.toMatchObject({ code: "EMAIL_SIGNING_NOT_CONFIGURED" });
    expect(await deliveries()).toHaveLength(0);
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 40);
    expect(await runAutomaticMeetingInvitations(db, BASE, 20, budget, { ...options, seriesId: series.id })).toEqual({
      queued: 1,
    });
    expect(budget.usedQueries()).toBeLessThan(15);
    expect(await dispatch(series.id)).toEqual({ queued: 0 });
  });

  it("rolls back a stale calendar snapshot and sends the newer revision on retry", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    const racing = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_series SET calendar_revision = calendar_revision + 1 WHERE id = ?")
        .bind(series.id)
        .run(),
    );
    await expect(
      runAutomaticMeetingInvitations(racing, BASE, 20, undefined, { ...options, seriesId: series.id }),
    ).rejects.toThrow();
    expect(await deliveries()).toHaveLength(0);
    expect(await dispatch(series.id)).toEqual({ queued: 1 });
    expect(await dispatch(series.id)).toEqual({ queued: 0 });
  });

  it("rolls back a delivery when membership is revoked after selection", async () => {
    const series = await createGroupEventSeries(env.DB, admin, GROUP, input());
    const racing = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(userId).run(),
    );
    await expect(
      runAutomaticMeetingInvitations(racing, BASE, 20, undefined, { ...options, seriesId: series.id }),
    ).rejects.toThrow();
    expect(await deliveries()).toHaveLength(0);
  });
});
