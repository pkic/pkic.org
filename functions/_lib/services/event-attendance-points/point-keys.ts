/**
 * The per-event check-in key and the signed point codes made with it.
 *
 * Codes reuse the public capability token scheme: the Worker's signing secret
 * keys the HMAC and the event's stored link secret is bound into the signed
 * input, so a database read alone cannot forge a code and rotating the stored
 * secret ("Reissue codes") invalidates every printed or displayed code.
 *
 * A code is deterministic for one key generation (its validity starts at the
 * key's issue time), so a poster, the full-size view and a studio output show
 * the same code for a point until the key is rotated.
 */
import {
  decodeAttendancePointResource,
  encodeAttendancePointResource,
  type AttendancePointSelection,
} from "../../../../assets/shared/attendance-points";
import {
  newCapabilityLinkSecret,
  parseCapabilityToken,
  signCapabilityToken,
  verifyCapabilityToken,
} from "../../auth/capability-token";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";

/** Printed codes outlive any one event; rotation, not expiry, is how organizers withdraw them. */
const POINT_CODE_TTL_SECONDS = 2 * 366 * 24 * 60 * 60;

export interface AttendancePointKey {
  link_secret: string;
  generation: number;
  issued_at: string;
}

export function attendancePointSigningSecret(env: Pick<Env, "INTERNAL_SIGNING_SECRET">): string {
  if (!env.INTERNAL_SIGNING_SECRET)
    throw new AppError(503, "ATTENDANCE_POINTS_UNAVAILABLE", "Check-in codes are unavailable right now.");
  return env.INTERNAL_SIGNING_SECRET;
}

async function readKey(db: DatabaseLike, eventId: string) {
  return first<AttendancePointKey>(
    db,
    "SELECT link_secret,generation,issued_at FROM event_attendance_point_keys WHERE event_id=?",
    [eventId],
  );
}

/** The event's key, created on first use; concurrent first readers converge on one stored key. */
export async function ensureAttendancePointKey(db: DatabaseLike, eventId: string): Promise<AttendancePointKey> {
  const existing = await readKey(db, eventId);
  if (existing) return existing;
  await db
    .prepare(
      "INSERT INTO event_attendance_point_keys(event_id,link_secret,generation,issued_at) VALUES(?,?,1,?) ON CONFLICT(event_id) DO NOTHING",
    )
    .bind(eventId, newCapabilityLinkSecret(), nowIso())
    .run();
  const created = await readKey(db, eventId);
  if (!created) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  return created;
}

/** Rotate the key; every earlier code stops verifying. */
export async function reissueAttendancePointKey(db: DatabaseLike, eventId: string, actorId: string) {
  const issuedAt = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO event_attendance_point_keys(event_id,link_secret,generation,issued_at,issued_by_user_id) VALUES(?,?,1,?,?)
         ON CONFLICT(event_id) DO UPDATE SET link_secret=excluded.link_secret,generation=event_attendance_point_keys.generation+1,
         issued_at=excluded.issued_at,issued_by_user_id=excluded.issued_by_user_id`,
      )
      .bind(eventId, newCapabilityLinkSecret(), issuedAt, actorId),
    prepareScopedAuditLog(
      db,
      { type: "event", id: eventId },
      "user",
      actorId,
      "agenda.attendance.points_reissued",
      "event",
      eventId,
      {},
      issuedAt,
    ),
  ]);
  return { issuedAt };
}

/** A point's code: the same until the key is rotated. */
export function signAttendancePoint(
  signingSecret: string,
  key: AttendancePointKey,
  eventId: string,
  selection: AttendancePointSelection,
): Promise<string> {
  return signCapabilityToken({
    signingSecret,
    linkSecret: key.link_secret,
    purpose: "attendance_point",
    resourceId: encodeAttendancePointResource(eventId, selection),
    ttlSeconds: POINT_CODE_TTL_SECONDS,
    nowSeconds: Math.floor(Date.parse(key.issued_at) / 1000),
  });
}

export type VerifiedAttendancePoint =
  | { state: "valid"; selection: AttendancePointSelection; generation: number }
  | { state: "invalid" };

/**
 * The point a code names, for this event only. Invalid for a malformed,
 * forged or reissued code, or one from another event; the caller cannot tell
 * which, by design.
 */
export async function verifyAttendancePoint(
  db: DatabaseLike,
  signingSecret: string,
  eventId: string,
  token: string,
  now: string,
): Promise<VerifiedAttendancePoint> {
  const invalid = { state: "invalid" } as const;
  const parsed = parseCapabilityToken(token, "attendance_point");
  if (!parsed) return invalid;
  const resource = decodeAttendancePointResource(parsed.resourceId);
  if (!resource || resource.eventId !== eventId) return invalid;
  const key = await readKey(db, eventId);
  if (!key) return invalid;
  const verified = await verifyCapabilityToken({
    signingSecret,
    linkSecret: key.link_secret,
    purpose: "attendance_point",
    token,
    nowSeconds: Math.floor(Date.parse(now) / 1000),
  });
  if (!verified.ok) return invalid;
  return { state: "valid", selection: resource.selection, generation: key.generation };
}

/** Portal path a phone camera opens; the hash keeps the code out of server request logs. */
export function attendancePointPath(eventSlug: string, token: string): string {
  return `/portal/#/events/${encodeURIComponent(eventSlug)}/check-in/${token}`;
}
