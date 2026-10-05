import {
  eventWebPushRegisterSchema,
  eventWebPushStatusSchema,
  webPushSubscriptionSchema,
} from "../../../../assets/shared/schemas/event-web-push";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { sha256Hex } from "../../utils/crypto";
import { sealValue, openValue, decodeBase64Url } from "../../utils/sealed-value";
import { prepareScopedAuditLog } from "../audit";
import { webPushConfiguration, type WebPushEnvironment } from "./web-push-configuration";
const purpose = "pkic-web-push-subscription";
interface DeviceRow {
  id: string;
  user_id: string;
  revoked_at: string | null;
  expires_at: string | null;
  enabled: number | null;
  reminder_minutes: number | null;
  updated_at: string;
}
async function deviceStatus(db: DatabaseLike, eventId: string, userId: string, deviceId: string) {
  const row = await first<DeviceRow>(
    db,
    `SELECT device.id,device.user_id,device.revoked_at,device.expires_at,preference.enabled,preference.reminder_minutes,device.updated_at
 FROM agenda_push_devices device LEFT JOIN agenda_push_event_preferences preference ON preference.device_id=device.id AND preference.event_id=? WHERE device.id=?`,
    [eventId, deviceId],
  );
  if (row && row.user_id !== userId)
    throw new AppError(403, "PUSH_DEVICE_OWNER_REQUIRED", "This device belongs to another user.");
  return eventWebPushStatusSchema.parse({
    deviceId,
    enabled: row?.enabled === 1 && !row.revoked_at && (!row.expires_at || row.expires_at > nowIso()),
    reminderMinutes: row?.reminder_minutes ?? 15,
    registered: !!row && !row.revoked_at && (!row.expires_at || row.expires_at > nowIso()),
    revoked: !!row?.revoked_at,
    updatedAt: row?.updated_at ?? null,
  });
}
export const eventWebPushStatus = deviceStatus;
export async function registerEventWebPush(
  db: DatabaseLike,
  env: WebPushEnvironment,
  eventId: string,
  userId: string,
  raw: unknown,
) {
  const input = eventWebPushRegisterSchema.parse(raw),
    config = await webPushConfiguration(env);
  if (!config) throw new AppError(503, "WEB_PUSH_UNAVAILABLE", "Browser notifications are not configured.");
  const now = nowIso();
  if (input.subscription.expirationTime !== null && input.subscription.expirationTime <= Date.now())
    throw new AppError(400, "WEB_PUSH_EXPIRED", "This browser subscription has expired.");
  try {
    const bytes = new Uint8Array(decodeBase64Url(input.subscription.keys.p256dh));
    if (bytes[0] !== 4) throw new Error("point");
    await crypto.subtle.importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch {
    throw new AppError(400, "WEB_PUSH_KEY_INVALID", "This browser subscription has an invalid key.");
  }
  const endpointHash = await sha256Hex(input.subscription.endpoint),
    keyHash = await sha256Hex(config.publicKey);
  const existing = await first<{ id: string; user_id: string }>(
    db,
    "SELECT id,user_id FROM agenda_push_devices WHERE id=? OR endpoint_hash=? ORDER BY id LIMIT 2",
    [input.deviceId, endpointHash],
  );
  if (existing && (existing.user_id !== userId || existing.id !== input.deviceId))
    throw new AppError(
      409,
      "WEB_PUSH_DEVICE_CONFLICT",
      "This browser subscription is already registered to another device or user.",
    );
  const ciphertext = await sealValue(
    JSON.stringify(input.subscription),
    config.encryptionKey,
    purpose,
    `${input.deviceId}:${userId}`,
  );
  await db.batch([
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM users user WHERE user.id=? AND user.active=1
    AND NOT EXISTS(SELECT 1 FROM agenda_push_devices device WHERE (device.id=? OR device.endpoint_hash=?) AND (device.user_id<>? OR device.id<>?))
    AND (SELECT COUNT(*) FROM agenda_push_devices device WHERE device.user_id=? AND device.revoked_at IS NULL AND device.id<>?)<10`,
      bindings: [userId, input.deviceId, endpointHash, userId, input.deviceId, userId, input.deviceId],
    }),
    db
      .prepare(
        `INSERT INTO agenda_push_devices(id,user_id,endpoint_hash,subscription_ciphertext,vapid_key_hash,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET endpoint_hash=excluded.endpoint_hash,subscription_ciphertext=excluded.subscription_ciphertext,vapid_key_hash=excluded.vapid_key_hash,expires_at=excluded.expires_at,revoked_at=NULL,updated_at=excluded.updated_at WHERE agenda_push_devices.user_id=excluded.user_id`,
      )
      .bind(
        input.deviceId,
        userId,
        endpointHash,
        ciphertext,
        keyHash,
        input.subscription.expirationTime === null ? null : new Date(input.subscription.expirationTime).toISOString(),
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO agenda_push_event_preferences(event_id,device_id,enabled,reminder_minutes,consented_at,updated_at) VALUES(?,?,1,?,?,?)
    ON CONFLICT(event_id,device_id) DO UPDATE SET enabled=1,reminder_minutes=excluded.reminder_minutes,consented_at=excluded.consented_at,updated_at=excluded.updated_at`,
      )
      .bind(eventId, input.deviceId, input.reminderMinutes, now, now),
    prepareScopedAuditLog(
      db,
      { type: "event", id: eventId },
      "user",
      userId,
      "agenda.push.opted_in",
      "push_device",
      input.deviceId,
      { reminderMinutes: input.reminderMinutes },
      now,
    ),
  ]);
  return deviceStatus(db, eventId, userId, input.deviceId);
}
export async function revokeEventWebPush(db: DatabaseLike, eventId: string, userId: string, deviceId: string) {
  await deviceStatus(db, eventId, userId, deviceId);
  const now = nowIso();
  await db.batch([
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND NOT EXISTS(SELECT 1 FROM agenda_push_devices WHERE id=? AND user_id<>?)",
      bindings: [userId, deviceId, userId],
    }),
    db
      .prepare(
        "UPDATE agenda_push_event_preferences SET enabled=0,updated_at=? WHERE event_id=? AND device_id=? AND EXISTS(SELECT 1 FROM agenda_push_devices WHERE id=? AND user_id=?)",
      )
      .bind(now, eventId, deviceId, deviceId, userId),
    db
      .prepare(
        "UPDATE agenda_push_outbox SET status='canceled',updated_at=?,lease_token=NULL,lease_until=NULL WHERE event_id=? AND device_id=? AND user_id=? AND status IN('queued','retry','sending','waiting')",
      )
      .bind(now, eventId, deviceId, userId),
    prepareScopedAuditLog(
      db,
      { type: "event", id: eventId },
      "user",
      userId,
      "agenda.push.opted_out",
      "push_device",
      deviceId,
      {},
      now,
    ),
  ]);
  return { revoked: true as const };
}
export async function revokeOwnedWebPushDevice(db: DatabaseLike, userId: string, deviceId: string) {
  const row = await first<{ user_id: string }>(db, "SELECT user_id FROM agenda_push_devices WHERE id=?", [deviceId]);
  if (row && row.user_id !== userId)
    throw new AppError(403, "PUSH_DEVICE_OWNER_REQUIRED", "This device belongs to another user.");
  const now = nowIso();
  await db.batch([
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND NOT EXISTS(SELECT 1 FROM agenda_push_devices WHERE id=? AND user_id<>?)",
      bindings: [userId, deviceId, userId],
    }),
    db
      .prepare(
        "UPDATE agenda_push_devices SET revoked_at=?,subscription_ciphertext='',updated_at=? WHERE id=? AND user_id=?",
      )
      .bind(now, now, deviceId, userId),
    db
      .prepare(
        "UPDATE agenda_push_event_preferences SET enabled=0,updated_at=? WHERE device_id=? AND EXISTS(SELECT 1 FROM agenda_push_devices WHERE id=? AND user_id=?)",
      )
      .bind(now, deviceId, deviceId, userId),
    db
      .prepare(
        "UPDATE agenda_push_outbox SET status='canceled',updated_at=?,lease_token=NULL,lease_until=NULL WHERE device_id=? AND user_id=? AND status IN('queued','retry','sending','waiting')",
      )
      .bind(now, deviceId, userId),
    prepareScopedAuditLog(
      db,
      { type: "user", id: userId },
      "user",
      userId,
      "agenda.push.device_revoked",
      "push_device",
      deviceId,
      {},
      now,
    ),
  ]);
  return { revoked: true as const };
}
export async function decryptWebPushSubscription(ciphertext: string, key: string, deviceId: string, userId: string) {
  return webPushSubscriptionSchema.parse(
    JSON.parse(await openValue(ciphertext, key, purpose, `${deviceId}:${userId}`)),
  );
}
