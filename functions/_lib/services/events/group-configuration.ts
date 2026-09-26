import type {
  EventDaysReplaceInput,
  EventTermsReplaceInput,
} from "../../../../assets/shared/schemas/event-configuration";
import type { EventRegistrationPolicy } from "../../../../assets/shared/schemas/event-series";
import { first } from "../../db/queries";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { isAuditChangeGuardFailure } from "../audit";
import { listConfiguredEventDaysWithCounts } from "../event-days";
import {
  guardEventResourceManagementDatabase,
  requireEventResourceManagementContext,
  type EventResourceManagementContext,
} from "../event-series/management";
import { replaceConfiguredEventDays } from "./day-configuration";
import { listConfiguredEventTerms, replaceConfiguredEventTerms } from "./term-configuration";

interface ConfigurableEvent {
  id: string;
  timezone: string;
  updatedAt: string;
  registrationPolicy: EventRegistrationPolicy;
}

async function requireConfigurableGroupEvent(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
): Promise<{ event: ConfigurableEvent; context: EventResourceManagementContext; guardedDb: DatabaseLike }> {
  const event = await first<ConfigurableEvent>(
    db,
    `SELECT event.id, event.timezone, event.updated_at AS updatedAt,
            event.registration_mode AS registrationPolicy
       FROM events event
       LEFT JOIN event_series series ON series.event_id = event.id
      WHERE event.id = ?
        AND COALESCE(event.profile_key, '') NOT IN ('meeting', 'board_meeting')
        AND series.id IS NULL`,
    [eventId],
  );
  if (!event) {
    throw new AppError(
      409,
      "EVENT_MANAGED_BY_MEETING_SERIES",
      "Meeting events must be configured through their meeting series",
    );
  }
  const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, event.id, "manage");
  return {
    event,
    context,
    guardedDb: guardEventResourceManagementDatabase(db, actor, context, "manage"),
  };
}

function standaloneEventGuard(db: DatabaseLike, eventId: string) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM events guarded_event
           WHERE guarded_event.id = ?
             AND COALESCE(guarded_event.profile_key, '') NOT IN ('meeting', 'board_meeting')
             AND NOT EXISTS (
               SELECT 1 FROM event_series guarded_series WHERE guarded_series.event_id = guarded_event.id
             )`,
    bindings: [eventId],
  });
}

function mapConfigurationWriteError(error: unknown): never {
  if (isAuthorizationGuardFailure(error)) {
    throw new AppError(
      409,
      "EVENT_MANAGED_BY_MEETING_SERIES",
      "The event became managed by a meeting series before the configuration was saved",
    );
  }
  if (isAuditChangeGuardFailure(error)) {
    throw new AppError(409, "GROUP_EVENT_CHANGED", "The event changed; reload before saving");
  }
  throw error;
}

export async function getGroupManagedEventTerms(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
) {
  const { event, guardedDb } = await requireConfigurableGroupEvent(db, actor, groupIdOrSlug, eventId);
  return { eventUpdatedAt: event.updatedAt, terms: await listConfiguredEventTerms(guardedDb, event.id) };
}

export async function replaceGroupManagedEventTerms(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  expectedUpdatedAt: string,
  input: EventTermsReplaceInput,
) {
  const { event, context, guardedDb } = await requireConfigurableGroupEvent(db, actor, groupIdOrSlug, eventId);
  if (event.registrationPolicy !== "no_registration" && !input.attendee.some((term) => term.required)) {
    throw new AppError(
      422,
      "EVENT_REGISTRATION_TERMS_REQUIRED",
      "Enabled registration requires at least one required attendee term",
    );
  }
  try {
    const { updatedAt } = await replaceConfiguredEventTerms(guardedDb, event.id, input, {
      actorId: actor.id,
      auditScope: { type: "group", id: context.groupId },
      expectedUpdatedAt,
      authorizationGuards: [standaloneEventGuard(guardedDb, event.id)],
    });
    return { success: true as const, eventUpdatedAt: updatedAt };
  } catch (error) {
    mapConfigurationWriteError(error);
  }
}

export async function getGroupManagedEventDays(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
) {
  const { event, guardedDb } = await requireConfigurableGroupEvent(db, actor, groupIdOrSlug, eventId);
  return { eventUpdatedAt: event.updatedAt, days: await listConfiguredEventDaysWithCounts(guardedDb, event.id) };
}

export async function replaceGroupManagedEventDays(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  expectedUpdatedAt: string,
  input: EventDaysReplaceInput,
) {
  const { event, context, guardedDb } = await requireConfigurableGroupEvent(db, actor, groupIdOrSlug, eventId);
  try {
    const { skipped, updatedAt } = await replaceConfiguredEventDays(guardedDb, event, input, {
      actorId: actor.id,
      auditScope: { type: "group", id: context.groupId },
      expectedUpdatedAt,
      authorizationGuards: [standaloneEventGuard(guardedDb, event.id)],
    });
    return { success: true as const, eventUpdatedAt: updatedAt, skipped };
  } catch (error) {
    mapConfigurationWriteError(error);
  }
}
