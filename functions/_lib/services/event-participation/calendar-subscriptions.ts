import { preparePersonalCalendarEntries } from "./calendar-entries";
import {
  agendaCalendarCurrentSubscriptionSchema,
  agendaCalendarSettingsSchema,
  agendaCalendarSubscriptionSchema,
} from "../../../../assets/shared/schemas/event-agenda-calendar";
import { AppError } from "../../errors";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { hmacSha256Hex, sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";
/** Where a feed URL is served and the key that lets its owner read it again. */
export interface AgendaCalendarFeedOrigin {
  baseUrl: string;
  eventSlug: string;
  /** INTERNAL_SIGNING_SECRET. Without it a link is random and shown only when created. */
  signingSecret?: string;
}
/**
 * A link's token is derived from its subscription ID with the server's signing secret, so the owner can
 * see the link again while the database still holds only its hash.
 */
async function feedToken(id: string, signingSecret: string | undefined) {
  if (signingSecret) return hmacSha256Hex(signingSecret, `agenda-calendar-feed:v1:${id}`);
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function feedUrl(origin: AgendaCalendarFeedOrigin, token: string) {
  return new URL(
    `/api/v1/events/${encodeURIComponent(origin.eventSlug)}/calendar/subscriptions/${token}/calendar.ics`,
    origin.baseUrl,
  ).href;
}
/** Rotation revokes every previous URL atomically. Plain tokens are never persisted. */
export async function rotateAgendaCalendarSubscription(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  origin: AgendaCalendarFeedOrigin,
  raw: unknown,
) {
  const settings = agendaCalendarSettingsSchema.parse(raw);
  const id = crypto.randomUUID();
  const token = await feedToken(id, origin.signingSecret);
  const now = nowIso();
  const hash = await sha256Hex(token);
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
  return agendaCalendarSubscriptionSchema.parse({ id, url: feedUrl(origin, token), createdAt: now });
}
/** The owner's active link, re-derived and checked against its stored hash; never read from storage. */
export async function currentAgendaCalendarSubscription(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  origin: AgendaCalendarFeedOrigin,
) {
  const row = await first<{ id: string; token_hash: string; created_at: string }>(
    db,
    "SELECT id,token_hash,created_at FROM agenda_calendar_subscriptions WHERE event_id=? AND user_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [eventId, userId],
  );
  if (!row) return agendaCalendarCurrentSubscriptionSchema.parse({ active: false, subscription: null });
  const token = origin.signingSecret ? await feedToken(row.id, origin.signingSecret) : null;
  const recoverable = token !== null && (await sha256Hex(token)) === row.token_hash;
  return agendaCalendarCurrentSubscriptionSchema.parse({
    active: true,
    subscription: recoverable ? { id: row.id, url: feedUrl(origin, token), createdAt: row.created_at } : null,
  });
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
    [eventId, await sha256Hex(token)],
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
