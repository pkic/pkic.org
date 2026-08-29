import {
  eventRegistrationPolicySchema,
  type EventRegistrationPolicy,
} from "../../../../assets/shared/schemas/event-series";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import {
  commitEventResourceManagementBatch,
  requireEventResourceManagementContext,
  type EventResourceManagementContext,
} from "../event-series/management";
import { EVENT_COLUMNS, type EventRecord } from "../events";
import { nowIso } from "../../utils/time";

type ConfigurableEvent = EventRecord & { updated_at: string };

async function requireRequiredAttendeeTerms(db: DatabaseLike, eventId: string): Promise<void> {
  const required = await first<{ id: string }>(
    db,
    `SELECT id
       FROM event_terms
      WHERE event_id = ? AND audience_type = 'attendee' AND active = 1 AND required = 1
      LIMIT 1`,
    [eventId],
  );
  if (!required) {
    throw new AppError(422, "EVENT_REGISTRATION_TERMS_REQUIRED", "Registration requires required attendee terms");
  }
}

function eventStandaloneAndTermsGuard(db: DatabaseLike, eventId: string, requiresTerms: boolean): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM events guarded_event
           WHERE guarded_event.id = ?
             AND COALESCE(guarded_event.profile_key, '') NOT IN ('meeting', 'board_meeting')
             AND NOT EXISTS (
               SELECT 1 FROM event_series guarded_series WHERE guarded_series.event_id = guarded_event.id
             )
             ${
               requiresTerms
                 ? `AND EXISTS (
               SELECT 1 FROM event_terms attendee_term
                WHERE attendee_term.event_id = guarded_event.id
                  AND attendee_term.audience_type = 'attendee'
                  AND attendee_term.active = 1
                  AND attendee_term.required = 1
             )`
                 : ""
             }
           LIMIT 1`,
    bindings: [eventId],
  });
}

function configurableEvent(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
): Promise<{ event: ConfigurableEvent; context: EventResourceManagementContext }> {
  return (async () => {
    const event = await first<ConfigurableEvent>(db, `SELECT ${EVENT_COLUMNS}, updated_at FROM events WHERE id = ?`, [
      eventId,
    ]);
    if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
    if (event.profile_key === "meeting" || event.profile_key === "board_meeting") {
      throw new AppError(
        409,
        "EVENT_MANAGED_BY_MEETING_SERIES",
        "Meeting events must be configured through their series",
      );
    }
    const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, event.id, "manage");
    return { event, context };
  })();
}

export async function getGroupEventRegistrationSettings(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
) {
  const { event } = await configurableEvent(db, actor, groupIdOrSlug, eventId);
  return {
    eventUpdatedAt: event.updated_at,
    registrationPolicy: eventRegistrationPolicySchema.parse(event.registration_mode),
  };
}

export async function replaceGroupEventRegistrationSettings(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  expectedUpdatedAt: string,
  registrationPolicy: EventRegistrationPolicy,
) {
  const { event, context } = await configurableEvent(db, actor, groupIdOrSlug, eventId);
  if (registrationPolicy !== "no_registration") await requireRequiredAttendeeTerms(db, event.id);

  const now = nowIso();
  const statements: StatementLike[] = [
    eventStandaloneAndTermsGuard(db, event.id, registrationPolicy !== "no_registration"),
  ];
  const updatedAt = now;
  statements.push(
    db
      .prepare("UPDATE events SET registration_mode = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
      .bind(registrationPolicy, updatedAt, event.id, expectedUpdatedAt),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "group", id: context.groupId },
      "admin",
      actor.id,
      "event_registration_settings_updated",
      "event",
      event.id,
      { registrationPolicy },
      updatedAt,
    ),
  );

  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", statements);
  } catch (error) {
    if (
      isAuthorizationGuardFailure(error) ||
      (error instanceof AppError && error.code === "EVENT_MANAGEMENT_CONTEXT_CHANGED")
    ) {
      throw new AppError(
        409,
        "EVENT_REGISTRATION_SETTINGS_CHANGED",
        "Event registration settings changed; reload and retry",
      );
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "EVENT_REGISTRATION_SETTINGS_CHANGED",
        "Event registration settings changed; reload and retry",
      );
    }
    throw error;
  }

  return {
    eventUpdatedAt: updatedAt,
    registrationPolicy,
  };
}
