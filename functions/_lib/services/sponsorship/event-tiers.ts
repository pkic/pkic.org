/**
 * Per-event sponsor tier config: which tiers may access attendee data, and
 * which consortium tiers capture leads at the event. Split out of
 * sponsorship.ts.
 */
import type { z } from "zod";
import type {
  eventSponsorTiersReplaceSchema,
  eventSponsorTiersResponseSchema,
} from "../../../../assets/shared/schemas/sponsorship-management";
import { first } from "../../db/queries";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareAuditLog } from "../audit";
import type { DatabaseLike, D1StatementResult, StatementLike } from "../../types";

export interface EventSponsorTierRow {
  tierName: string;
  hasAttendeeDataAccess: boolean;
}

type EventSponsorTiers = z.infer<typeof eventSponsorTiersResponseSchema>;
type EventSponsorTiersReplace = z.infer<typeof eventSponsorTiersReplaceSchema>;

/** A tier an event may admit: active in the consortium catalog, or already admitted by this event. Bind the event id. */
const OFFERED_CONSORTIUM_TIER_SQL = `SELECT catalog.tier FROM sponsorship_tier_catalog catalog
  WHERE catalog.sponsor_type='consortium' AND catalog.active=1
  UNION SELECT admitted.tier FROM event_consortium_lead_tiers admitted WHERE admitted.event_id=?`;

function prepareEventSponsorTierRead(db: DatabaseLike, eventId: string): StatementLike[] {
  return [
    db
      .prepare(
        `SELECT tier_name, has_attendee_data_access FROM event_sponsor_attendee_tiers WHERE event_id = ? ORDER BY tier_name ASC`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT offered.tier,
           EXISTS(SELECT 1 FROM event_consortium_lead_tiers admitted WHERE admitted.event_id=? AND admitted.tier=offered.tier) AS captures_leads
         FROM (${OFFERED_CONSORTIUM_TIER_SQL}) offered
         LEFT JOIN sponsorship_tier_catalog catalog ON catalog.sponsor_type='consortium' AND catalog.tier=offered.tier
         ORDER BY COALESCE(catalog.display_weight, 0) DESC, offered.tier ASC`,
      )
      .bind(eventId, eventId),
  ];
}

function decodeEventSponsorTiers(results: D1StatementResult[]): EventSponsorTiers {
  const tiers = (results[0]?.results ?? []) as { tier_name: string; has_attendee_data_access: number }[];
  const consortium = (results[1]?.results ?? []) as { tier: string; captures_leads: number }[];
  return {
    tiers: tiers.map((r) => ({ tierName: r.tier_name, hasAttendeeDataAccess: r.has_attendee_data_access === 1 })),
    consortiumTiers: consortium.map((r) => ({ tier: r.tier, capturesLeads: r.captures_leads === 1 })),
  };
}

export async function listEventSponsorTiers(db: DatabaseLike, eventId: string): Promise<EventSponsorTiers> {
  return decodeEventSponsorTiers(await db.batch(prepareEventSponsorTierRead(db, eventId)));
}

/** Replaces both tier settings atomically and returns the saved state from the same batch. */
export async function replaceEventSponsorTiers(
  db: DatabaseLike,
  actorId: string,
  eventId: string,
  input: EventSponsorTiersReplace,
): Promise<EventSponsorTiers> {
  const now = nowIso();
  const { tiers, consortiumLeadTiers } = input;
  const chosen = JSON.stringify(consortiumLeadTiers);
  const statements = [
    // Every chosen tier must still be on offer, checked before this event's own admissions are replaced.
    prepareStateGuard(db, {
      sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) chosen
        WHERE chosen.value NOT IN (${OFFERED_CONSORTIUM_TIER_SQL}))`,
      bindings: [chosen, eventId],
    }),
    db.prepare(`DELETE FROM event_sponsor_attendee_tiers WHERE event_id = ?`).bind(eventId),
    db.prepare(`DELETE FROM event_consortium_lead_tiers WHERE event_id = ?`).bind(eventId),
    db
      .prepare(
        `INSERT INTO event_consortium_lead_tiers (event_id, tier, created_at) SELECT ?, chosen.value, ? FROM json_each(?) chosen`,
      )
      .bind(eventId, now, chosen),
  ];
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
  statements.push(
    prepareAuditLog(
      db,
      "admin",
      actorId,
      "event_sponsor_tiers_updated",
      "event",
      eventId,
      { tierCount: tiers.length, consortiumLeadTiers },
      now,
    ),
  );
  const read = prepareEventSponsorTierRead(db, eventId);
  try {
    const results = await db.batch([...statements, ...read]);
    return decodeEventSponsorTiers(results.slice(statements.length));
  } catch (error) {
    if (isStateGuardFailure(error))
      throw new AppError(409, "CONSORTIUM_TIER_UNAVAILABLE", "A chosen consortium tier is no longer offered.");
    throw error;
  }
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
