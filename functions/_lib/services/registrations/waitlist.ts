import { all, first, run } from "../../db/queries";
import { AppError } from "../../errors";
import { nowIso, addHours, isPast } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike } from "../../types";

interface WaitlistRow {
  id: string;
  event_id: string;
  registration_id: string;
  status: string;
  position: number;
  offer_expires_at: string | null;
}

export async function getInPersonRegisteredCount(db: DatabaseLike, eventId: string): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
     FROM registrations
     WHERE event_id = ? AND status = 'registered' AND attendance_type = 'in_person'`,
    [eventId],
  );

  return Number(row?.total ?? 0);
}

export async function nextWaitlistPosition(db: DatabaseLike, eventId: string): Promise<number> {
  const row = await first<{ max_position: number }>(
    db,
    "SELECT MAX(position) AS max_position FROM waitlist_entries WHERE event_id = ?",
    [eventId],
  );
  return Number(row?.max_position ?? 0) + 1;
}

export async function addToWaitlist(db: DatabaseLike, eventId: string, registrationId: string): Promise<WaitlistRow> {
  const position = await nextWaitlistPosition(db, eventId);
  const entry: WaitlistRow = {
    id: uuid(),
    event_id: eventId,
    registration_id: registrationId,
    status: "waiting",
    position,
    offer_expires_at: null,
  };

  await run(
    db,
    `INSERT INTO waitlist_entries (
      id, event_id, registration_id, status, position, offer_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.event_id, entry.registration_id, entry.status, entry.position, null, nowIso(), nowIso()],
  );

  return entry;
}

export async function claimWaitlistOffer(
  db: DatabaseLike,
  registrationId: string,
  eventId: string,
): Promise<boolean> {
  const entry = await first<WaitlistRow>(
    db,
    "SELECT * FROM waitlist_entries WHERE registration_id = ? AND event_id = ?",
    [registrationId, eventId],
  );

  if (!entry) {
    return false;
  }

  if (entry.status !== "offered") {
    throw new AppError(409, "WAITLIST_NOT_OFFERED", "No active waitlist offer for this registration");
  }

  if (entry.offer_expires_at && isPast(entry.offer_expires_at)) {
    await run(
      db,
      "UPDATE waitlist_entries SET status = 'expired', updated_at = ? WHERE id = ?",
      [nowIso(), entry.id],
    );
    throw new AppError(410, "WAITLIST_OFFER_EXPIRED", "Waitlist offer expired");
  }

  await run(
    db,
    "UPDATE waitlist_entries SET status = 'accepted', updated_at = ? WHERE id = ?",
    [nowIso(), entry.id],
  );

  return true;
}

export async function promoteWaitlistIfCapacity(
  db: DatabaseLike,
  eventId: string,
  inPersonCapacity: number | null,
  claimWindowHours: number,
): Promise<WaitlistRow | null> {
  if (!inPersonCapacity || inPersonCapacity <= 0) {
    return null;
  }

  const count = await getInPersonRegisteredCount(db, eventId);
  if (count >= inPersonCapacity) {
    return null;
  }

  const next = await first<WaitlistRow>(
    db,
    `SELECT * FROM waitlist_entries
     WHERE event_id = ? AND status = 'waiting'
     ORDER BY position ASC
     LIMIT 1`,
    [eventId],
  );

  if (!next) {
    return null;
  }

  const offerExpiry = addHours(nowIso(), claimWindowHours);
  await run(
    db,
    `UPDATE waitlist_entries
     SET status = 'offered', offer_expires_at = ?, updated_at = ?
     WHERE id = ?`,
    [offerExpiry, nowIso(), next.id],
  );

  return { ...next, status: "offered", offer_expires_at: offerExpiry };
}

export async function listWaitlistForEvent(db: DatabaseLike, eventId: string): Promise<WaitlistRow[]> {
  return all<WaitlistRow>(
    db,
    "SELECT * FROM waitlist_entries WHERE event_id = ? ORDER BY position ASC",
    [eventId],
  );
}
