/**
 * Per-event sponsor attendee-data tier config. Split out of
 * sponsorship.ts.
 */
import { first, all } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike } from "../../types";

export interface EventSponsorTierRow {
  tierName: string;
  hasAttendeeDataAccess: boolean;
}

export async function listEventSponsorTiers(db: DatabaseLike, eventId: string): Promise<EventSponsorTierRow[]> {
  const rows = await all<{ tier_name: string; has_attendee_data_access: number }>(
    db,
    `SELECT tier_name, has_attendee_data_access FROM event_sponsor_attendee_tiers WHERE event_id = ? ORDER BY tier_name ASC`,
    [eventId],
  );
  return rows.map((r) => ({ tierName: r.tier_name, hasAttendeeDataAccess: r.has_attendee_data_access === 1 }));
}

export async function replaceEventSponsorTiers(
  db: DatabaseLike,
  eventId: string,
  tiers: EventSponsorTierRow[],
): Promise<void> {
  const now = nowIso();
  const statements = [db.prepare(`DELETE FROM event_sponsor_attendee_tiers WHERE event_id = ?`).bind(eventId)];
  for (const tier of tiers) {
    statements.push(
      db
        .prepare(
          `INSERT INTO event_sponsor_attendee_tiers (id, event_id, tier_name, has_attendee_data_access, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(uuid(), eventId, tier.tierName, tier.hasAttendeeDataAccess ? 1 : 0, now, now),
    );
  }
  await db.batch(statements);
}

export async function eventSponsorTierHasAttendeeAccess(
  db: DatabaseLike,
  eventId: string,
  tier: string,
): Promise<boolean> {
  const row = await first<{ has_attendee_data_access: number }>(
    db,
    `SELECT has_attendee_data_access FROM event_sponsor_attendee_tiers WHERE event_id = ? AND tier_name = ?`,
    [eventId, tier],
  );
  return row?.has_attendee_data_access === 1;
}
