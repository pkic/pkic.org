import { preparePersonalCalendarEntries } from "./calendar-entries";
import { agendaCalendarSettingsSchema } from "../../../../assets/shared/schemas/event-agenda-calendar";
import { AppError } from "../../errors";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
async function tokenHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Rotation revokes every previous URL atomically. Plain tokens are never persisted. */
export async function rotateAgendaCalendarSubscription(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  baseUrl: string,
  eventSlug: string,
  raw: unknown,
) {
  const settings = agendaCalendarSettingsSchema.parse(raw);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const id = crypto.randomUUID();
  const now = nowIso();
  const hash = await tokenHash(token);
  await db.batch([
    ...preparePersonalCalendarEntries(db, eventId, userId),
    db
      .prepare(
        "UPDATE agenda_calendar_subscriptions SET revoked_at=? WHERE event_id=? AND user_id=? AND revoked_at IS NULL",
      )
      .bind(now, eventId, userId),
    db
      .prepare(
        "INSERT INTO agenda_calendar_subscriptions(id,event_id,user_id,token_hash,include_tentative,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(id, eventId, userId, hash, settings.includeTentative ? 1 : 0, now),
    db
      .prepare(
        "INSERT INTO agenda_calendar_preferences(event_id,user_id,reminder_enabled,reminder_minutes,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET reminder_enabled=excluded.reminder_enabled,reminder_minutes=excluded.reminder_minutes,updated_at=excluded.updated_at",
      )
      .bind(eventId, userId, settings.reminderEnabled ? 1 : 0, settings.reminderMinutes, now),
  ]);
  return {
    id,
    url: new URL(
      `/api/v1/events/${encodeURIComponent(eventSlug)}/calendar/subscriptions/${token}/calendar.ics`,
      baseUrl,
    ).href,
    createdAt: now,
  };
}
export async function revokeAgendaCalendarSubscriptions(db: DatabaseLike, eventId: string, userId: string) {
  await db
    .prepare(
      "UPDATE agenda_calendar_subscriptions SET revoked_at=? WHERE event_id=? AND user_id=? AND revoked_at IS NULL",
    )
    .bind(nowIso(), eventId, userId)
    .run();
}
export async function resolveAgendaCalendarSubscription(db: DatabaseLike, eventId: string, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new AppError(404, "CALENDAR_NOT_FOUND", "Calendar subscription not found.");
  const subscription = await first<{ id: string; user_id: string; include_tentative: number }>(
    db,
    `SELECT sub.id,sub.user_id,sub.include_tentative FROM agenda_calendar_subscriptions sub JOIN users person ON person.id=sub.user_id
      WHERE sub.event_id=? AND sub.token_hash=? AND sub.revoked_at IS NULL AND person.active=1`,
    [eventId, await tokenHash(token)],
  );
  if (!subscription) throw new AppError(404, "CALENDAR_NOT_FOUND", "Calendar subscription not found.");
  return subscription;
}
export async function agendaCalendarSettings(db: DatabaseLike, eventId: string, userId: string) {
  const row = await first<{ reminder_enabled: number; reminder_minutes: number; include_tentative: number }>(
    db,
    `SELECT preference.reminder_enabled,preference.reminder_minutes,COALESCE((SELECT include_tentative FROM agenda_calendar_subscriptions WHERE event_id=? AND user_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1),0) AS include_tentative FROM agenda_calendar_preferences preference WHERE preference.event_id=? AND preference.user_id=?`,
    [eventId, userId, eventId, userId],
  );
  return agendaCalendarSettingsSchema.parse({
    reminderEnabled: row?.reminder_enabled === 1,
    reminderMinutes: row?.reminder_minutes ?? 10,
    includeTentative: row?.include_tentative === 1,
  });
}
export async function updateAgendaCalendarSettings(db: DatabaseLike, eventId: string, userId: string, raw: unknown) {
  const settings = agendaCalendarSettingsSchema.parse(raw);
  await db.batch([
    db
      .prepare(
        "INSERT INTO agenda_calendar_preferences(event_id,user_id,reminder_enabled,reminder_minutes,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET reminder_enabled=excluded.reminder_enabled,reminder_minutes=excluded.reminder_minutes,updated_at=excluded.updated_at",
      )
      .bind(eventId, userId, settings.reminderEnabled ? 1 : 0, settings.reminderMinutes, nowIso()),
    db
      .prepare(
        "UPDATE agenda_calendar_subscriptions SET include_tentative=? WHERE event_id=? AND user_id=? AND revoked_at IS NULL",
      )
      .bind(settings.includeTentative ? 1 : 0, eventId, userId),
  ]);
  return settings;
}
