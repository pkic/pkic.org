import { all, first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { listEventDays } from "../event-days";
import { listDayWaitlistForRegistration } from "./day-waitlist-queries";
import { prepareLapsedDayOfferRequeue } from "./day-waitlist-policy";
import { prepareRegistrationStatusEmail, type RegistrationStatusEmailEvent } from "./status-notifications";
import { promoteDayWaitlistIfCapacity } from "./day-waitlist";
import { openWaitlistOptionCte, waitlistEntryCanBeOfferedSql } from "./day-waitlist-capacity";
import type { DatabaseLike, StatementLike } from "../../types";
import { outboxIdForOperation } from "../../email/outbox-queue";

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
      let preparedOutboxId: string | null = null;
      const promoted = await promoteDayWaitlistIfCapacity(db, {
        eventId: payload.event.id,
        eventDayId,
        claimWindowHours: payload.claimWindowHours,
        isCommitConflict: isAuditChangeGuardFailure,
        prepareCommitGuard: (promotion) =>
          prepareAuditLogAfterOneChange(
            db,
            payload.source.actorType,
            payload.source.actorId,
            payload.source.auditAction,
            "event",
            payload.event.id,
            {
              source: payload.source.source,
              eventDayId: promotion.event_day_id,
              registrationId: promotion.registration_id,
              dayRegistrationOffers: 1,
              capacityDecision: {
                outcome: "offered",
                reason: "queue_promotion",
                seatsReservedBeforeDecision: promotion.capacitySnapshot?.seatsReservedBeforeDecision,
                limit: promotion.capacitySnapshot?.limit,
              },
            },
            nowIso(),
          ),
        prepareCommitStatements: async (promotion) => {
          const statements: StatementLike[] = [];
          const day = await first<{ day_date: string }>(db, "SELECT day_date FROM event_days WHERE id = ?", [
            promotion.event_day_id,
          ]);
          if (!day) throw new Error("Promoted event day no longer exists");
          const currentWaitlist = await listDayWaitlistForRegistration(db, promotion.registration_id);
          const dayWaitlist = [
            ...currentWaitlist.filter((entry) => entry.dayDate !== day.day_date),
            {
              dayDate: day.day_date,
              status: "offered" as const,
              priorityLane: promotion.priority_lane,
              offerExpiresAt: promotion.offer_expires_at,
            },
          ];
          const offerKey =
            `waitlist-offer:${payload.event.id}:${promotion.registration_id}:` +
            `${promotion.event_day_id}:${promotion.offer_expires_at}`;
          const email = await prepareRegistrationStatusEmail(db, {
            event: payload.event,
            registrationId: promotion.registration_id,
            appBaseUrl: payload.appBaseUrl,
            templateKey: "registration_waitlist_offer",
            subject: `A spot is available — ${payload.event.name}`,
            noticeKind: "waitlist_offer",
            outboxId: await outboxIdForOperation(offerKey),
            idempotencyKey: offerKey,
            dayWaitlist,
          });
          statements.push(email.statement);
          preparedOutboxId = email.outboxId;
          return statements;
        },
      });
      if (!promoted) break;

      result.dayRegistrationOffers += 1;
      affected.add(promoted.registration_id);
      if (preparedOutboxId) {
        result.outboxIds.push(preparedOutboxId);
      }
    }
  }

  result.affectedRegistrations = Array.from(affected);

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
  await prepareLapsedDayOfferRequeue(db, { now: nowIso() }).run();

  const events = await all<WaitlistPromotionEvent>(
    db,
    `WITH ${openWaitlistOptionCte(
      "scoped_day.event_id IN (SELECT id FROM events WHERE ends_at IS NULL OR datetime(ends_at) >= datetime('now'))",
      "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )}
     SELECT
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
     WHERE EXISTS (
       SELECT 1
       FROM open_waitlist_option open_option
       JOIN event_days ed ON ed.id = open_option.event_day_id
       JOIN event_day_waitlist_entries candidate
         ON candidate.event_day_id = open_option.event_day_id AND candidate.status = 'waiting'
       JOIN registration_day_attendance selected ON selected.registration_id = candidate.registration_id
         AND selected.event_day_id = candidate.event_day_id AND selected.attendance_type = open_option.attendance_type
       JOIN registrations candidate_registration ON candidate_registration.id = candidate.registration_id
       WHERE open_option.event_id = e.id
         AND ${waitlistEntryCanBeOfferedSql("candidate", "candidate_registration", "ed", "selected.attendance_type")}
     )
     ORDER BY datetime(COALESCE(e.starts_at, '9999-12-31')) ASC, e.name ASC, e.id ASC
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
