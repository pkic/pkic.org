import { env } from "cloudflare:workers";
import type { z } from "zod";
import {
  attendancePointResultSchema,
  attendancePointsResponseSchema,
  attendanceOccupancyResponseSchema,
  type AttendancePoint,
} from "../../assets/shared/schemas/event-attendance-points";
import type { AttendancePointSelection } from "../../assets/shared/attendance-points";
import { getAgenda } from "../../functions/_lib/services/event-agenda/read";
import { resolveLiveCheckIn } from "../../functions/_lib/services/event-attendance-points/live-check-in";
import { grantAdministrator } from "./administrator";
import { callApi } from "./app";
import { createAdminSession } from "./auth";
import { resetDb } from "./reset-db";

/**
 * A synthetic two-day event whose first day is today (UTC): one in-person
 * attendee, a virtual one, one waiting for an in-person place, a stranger and
 * an organizer; one room with a session running now and one later today, and
 * a lab without a room, running now, that needs a reservation.
 */
export function createAttendancePointFixture() {
  const slug = "check-in-test";
  const ids = {
    event: crypto.randomUUID(),
    organizer: crypto.randomUUID(),
    attendee: crypto.randomUUID(),
    virtual: crypto.randomUUID(),
    waiting: crypto.randomUUID(),
    stranger: crypto.randomUUID(),
    room: crypto.randomUUID(),
    running: crypto.randomUUID(),
    later: crypto.randomUUID(),
    lab: crypto.randomUUID(),
    today: crypto.randomUUID(),
    tomorrow: crypto.randomUUID(),
  };
  const tokens: Record<string, string> = {};
  const dates = { today: "", tomorrow: "" };
  const minutes = (offset: number) => new Date(Date.now() + offset * 60_000).toISOString();

  async function setup() {
    await resetDb();
    const now = new Date().toISOString();
    dates.today = now.slice(0, 10);
    dates.tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const user of ["organizer", "attendee", "virtual", "waiting", "stranger"] as const)
      await env.DB.prepare("INSERT INTO users (id,email,normalized_email,active) VALUES (?,?,?,1)")
        .bind(ids[user], `${user}@example.test`, `${user}@example.test`)
        .run();
    await grantAdministrator(env.DB, ids.organizer);
    // The stranger holds an account through another event's registration, not this one.
    const elsewhere = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events (id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES (?,'elsewhere','Elsewhere','UTC','invite_or_open','{}',?,?)",
    )
      .bind(elsewhere, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations (id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES (?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), elsewhere, ids.stranger, crypto.randomUUID(), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO events (id,slug,name,timezone,starts_at,ends_at,registration_mode,settings_json,created_at,updated_at) VALUES (?,?,'Check-in test','UTC',?,?,'invite_or_open','{}',?,?)",
    )
      .bind(ids.event, slug, `${dates.today}T00:00:00.000Z`, `${dates.tomorrow}T23:00:00.000Z`, now, now)
      .run();
    for (const [id, date, order] of [
      [ids.today, dates.today, 0],
      [ids.tomorrow, dates.tomorrow, 1],
    ] as const)
      await env.DB.prepare(
        "INSERT INTO event_days (id,event_id,day_date,in_person_capacity,sort_order,created_at,updated_at) VALUES (?,?,?,2,?,?,?)",
      )
        .bind(id, ids.event, date, order, now, now)
        .run();
    for (const [user, type, waiting] of [
      ["attendee", "in_person", false],
      ["virtual", "virtual", false],
      ["waiting", "in_person", true],
    ] as const) {
      const registration = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO registrations (id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES (?,?,?,'registered',?,'test',?,?,?)",
      )
        .bind(registration, ids.event, ids[user], type, crypto.randomUUID(), now, now)
        .run();
      for (const day of [ids.today, ids.tomorrow])
        await env.DB.prepare(
          "INSERT INTO registration_day_attendance (id,registration_id,event_day_id,attendance_type,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        )
          .bind(crypto.randomUUID(), registration, day, type, now, now)
          .run();
      if (waiting)
        await env.DB.prepare(
          "INSERT INTO event_day_waitlist_entries (id,event_id,event_day_id,registration_id,user_id,priority_lane,status,position,created_at,updated_at) VALUES (?,?,?,?,?,'general','waiting',1,?,?)",
        )
          .bind(crypto.randomUUID(), ids.event, ids.today, registration, ids[user], now, now)
          .run();
    }
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Main hall',100)")
      .bind(ids.room, ids.event)
      .run();
    for (const [id, title, start, end, room, policy] of [
      [ids.running, "Opening keynote", minutes(-1), minutes(50), ids.room, "preference"],
      [ids.later, "Closing panel", minutes(180), minutes(240), ids.room, "preference"],
      [ids.lab, "Hands-on lab", minutes(-5), minutes(40), null, "reservation"],
    ] as const)
      await env.DB.prepare(
        "INSERT INTO event_agenda_occurrences (id,event_id,title,start_at,end_at,room_id,admission_policy) VALUES (?,?,?,?,?,?,?)",
      )
        .bind(id, ids.event, title, start, end, room, policy)
        .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(ids.event, now)
      .run();
    const snapshot = await getAgenda(env.DB, ids.event, slug);
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(crypto.randomUUID(), ids.event, JSON.stringify(snapshot), ids.organizer, now)
      .run();
    for (const user of ["organizer", "attendee", "virtual", "waiting", "stranger"] as const)
      tokens[user] = await createAdminSession(env.DB, ids[user], crypto.randomUUID());
  }

  function request(as: keyof typeof tokens | null, path: string, init: RequestInit = {}) {
    return callApi(env, `/api/v1/events/${slug}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
        ...init.headers,
      },
    });
  }

  async function points(query = ""): Promise<AttendancePoint[]> {
    const response = await request("organizer", `/attendance/points${query}`);
    if (response.status !== 200) throw new Error(`Points listing failed: ${response.status}`);
    return attendancePointsResponseSchema.parse(await response.json()).points;
  }

  async function point(kind: AttendancePoint["kind"], day: "today" | "tomorrow" = "today") {
    const list = await points(kind === "session" ? "?kind=session" : "");
    const found = list.find((item) => item.kind === kind && (!item.dayDate || item.dayDate === dates[day]));
    if (!found) throw new Error(`No ${kind} point`);
    return found.token;
  }

  async function read(as: keyof typeof tokens, token: string) {
    const response = await request(as, `/attendance/points/${token}`);
    return { status: response.status, body: (await response.json()) as z.infer<typeof attendancePointResultSchema> };
  }

  async function record(
    as: keyof typeof tokens,
    direction: "check-ins" | "check-outs",
    token: string,
    operationId: string = crypto.randomUUID(),
  ) {
    const response = await request(as, `/attendance/${direction}`, {
      method: "POST",
      body: JSON.stringify({ pointToken: token, operationId }),
    });
    const body = await response.json();
    return {
      status: response.status,
      body: response.status === 200 ? attendancePointResultSchema.parse(body) : (body as Record<string, unknown>),
    };
  }

  /** The code a studio output shows for a selection, as a phone camera reads it from the screen. */
  async function studioCode(selection: AttendancePointSelection) {
    const graphic = await resolveLiveCheckIn(env.DB, env.INTERNAL_SIGNING_SECRET!, ids.event, selection);
    if (!graphic) throw new Error(`No studio code for ${selection.kind}`);
    return graphic.path.split("/check-in/")[1]!;
  }

  async function occupancy() {
    const response = await request("organizer", "/attendance/occupancy");
    return attendanceOccupancyResponseSchema.parse(await response.json()).days;
  }

  return { ids, dates, setup, request, points, point, read, record, occupancy, studioCode };
}
