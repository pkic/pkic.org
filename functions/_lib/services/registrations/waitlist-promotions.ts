import { all, run } from "../../db/queries";
import { writeAuditLog } from "../audit";
import { listEventDays } from "../event-days";
import { queueRegistrationStatusEmail, type RegistrationStatusEmailEvent } from "./status-notifications";
import { promoteDayWaitlistIfCapacity } from "./day-waitlist";
import type { DatabaseLike } from "../../types";

export interface WaitlistPromotionEvent extends RegistrationStatusEmailEvent {
  capacity_in_person?: number | null;
}

export interface WaitlistPromotionResult {
  dayRegistrationOffers: number;
  affectedRegistrations: string[];
  outboxIds: string[];
}

interface PromotionSource {
  actorType: "admin" | "system";
  actorId: string | null;
  auditAction: "admin_waitlist_promoted" | "system_waitlist_promoted";
  source: string;
}

function emptyResult(): WaitlistPromotionResult {
  return {
    dayRegistrationOffers: 0,
    affectedRegistrations: [],
    outboxIds: [],
  };
}

export async function promoteEventWaitlistWithNotifications(
  db: DatabaseLike,
  payload: {
    event: WaitlistPromotionEvent;
    appBaseUrl: string;
    claimWindowHours: number;
    source: PromotionSource;
    eventDayIds?: string[];
    maxOffers?: number;
  },
): Promise<WaitlistPromotionResult> {
  const result = emptyResult();
  const affected = new Set<string>();
  const maxOffers = payload.maxOffers ?? Number.POSITIVE_INFINITY;

  const days = payload.eventDayIds
    ? payload.eventDayIds
    : (await listEventDays(db, payload.event.id)).map((day) => day.id);
  for (const eventDayId of Array.from(new Set(days))) {
    while (result.dayRegistrationOffers < maxOffers) {
      const promoted = await promoteDayWaitlistIfCapacity(db, {
        eventId: payload.event.id,
        eventDayId,
        claimWindowHours: payload.claimWindowHours,
      });
      if (!promoted) break;

      result.dayRegistrationOffers += 1;
      affected.add(promoted.registration_id);
    }
  }

  result.affectedRegistrations = Array.from(affected);

  for (const registrationId of result.affectedRegistrations) {
    const outbox = await queueRegistrationStatusEmail(db, {
      event: payload.event,
      registrationId,
      appBaseUrl: payload.appBaseUrl,
      templateKey: "registration_waitlist_offer",
      subject: `In-person spot available — ${payload.event.name}`,
      noticeKind: "waitlist_offer",
    });
    result.outboxIds.push(outbox.outboxId);
  }

  if (result.affectedRegistrations.length > 0) {
    await writeAuditLog(
      db,
      payload.source.actorType,
      payload.source.actorId,
      payload.source.auditAction,
      "event",
      payload.event.id,
      {
        source: payload.source.source,
        dayRegistrationOffers: result.dayRegistrationOffers,
        affectedRegistrations: result.affectedRegistrations,
      },
    );
  }

  return result;
}

export interface WaitlistPromotionCycleResult {
  eventsScanned: number;
  dayRegistrationOffers: number;
  affectedRegistrations: number;
  outboxIds: string[];
}

export async function runWaitlistPromotionCycle(
  db: DatabaseLike,
  payload: { appBaseUrl: string; claimWindowHours: number; limit: number },
): Promise<WaitlistPromotionCycleResult> {
  await run(
    db,
    `UPDATE event_day_waitlist_entries
     SET status = 'expired', updated_at = datetime('now')
     WHERE status = 'offered'
       AND offer_expires_at IS NOT NULL
       AND datetime(offer_expires_at) <= datetime('now')`,
  );

  const events = await all<WaitlistPromotionEvent>(
    db,
    `SELECT DISTINCT
       e.id,
       e.slug,
       e.name,
       e.timezone,
       e.starts_at,
       e.ends_at,
       e.base_path,
       e.settings_json,
       e.capacity_in_person
     FROM events e
     WHERE (e.ends_at IS NULL OR datetime(e.ends_at) >= datetime('now'))
       AND EXISTS (
         SELECT 1 FROM event_day_waitlist_entries w
         WHERE w.event_id = e.id AND w.status = 'waiting'
       )
     ORDER BY datetime(COALESCE(e.starts_at, '9999-12-31')) ASC, e.name ASC
     LIMIT 50`,
  );

  const totals: WaitlistPromotionCycleResult = {
    eventsScanned: events.length,
    dayRegistrationOffers: 0,
    affectedRegistrations: 0,
    outboxIds: [],
  };

  for (const event of events) {
    const remaining = payload.limit - totals.dayRegistrationOffers;
    if (remaining <= 0) break;

    const promoted = await promoteEventWaitlistWithNotifications(db, {
      event,
      appBaseUrl: payload.appBaseUrl,
      claimWindowHours: payload.claimWindowHours,
      maxOffers: remaining,
      source: {
        actorType: "system",
        actorId: null,
        auditAction: "system_waitlist_promoted",
        source: "scheduled_due_work",
      },
    });

    totals.dayRegistrationOffers += promoted.dayRegistrationOffers;
    totals.affectedRegistrations += promoted.affectedRegistrations.length;
    totals.outboxIds.push(...promoted.outboxIds);
  }

  return totals;
}
