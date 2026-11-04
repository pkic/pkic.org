import type { EventAttendanceRegistrationsQuery } from "../../../../assets/shared/schemas/event-registrations";
import type {
  GroupEventCreateInput,
  GroupEventSettingsUpdateInput,
} from "../../../../assets/shared/schemas/group-events";
import {
  isAuthorizationGuardFailure,
  isStateGuardFailure,
  prepareAuthorizationGuard,
  prepareStateGuard,
} from "../../db/authorization-guard";
import { isAuditChangeGuardFailure, prepareScopedAuditLog } from "../audit";
import { getGroup, prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "../groups";
import {
  deriveEventBasePath,
  getEventById,
  prepareEventById,
  prepareEventCreateStatement,
  type EventRecord,
} from "../events";
import { prepareEventFormSettingsRead } from "./direct-form-selection";
import { batchFirst } from "../../db/pagination";
import { nowIso } from "../../utils/time";
import {
  listEventAttendanceRegistrations,
  type EventAttendanceRegistrationsListResult,
} from "../registrations/event-attendance-registrations";
import type { AuthAdmin, DatabaseLike, D1StatementResult, StatementLike } from "../../types";
import { AppError } from "../../errors";
import { buildEventSettingsMutationStatements } from "./settings";
import {
  type EventResourceManagementContext,
  commitEventResourceManagementBatch,
  guardEventResourceManagementDatabase,
  requireEventResourceManagementContext,
} from "../event-series/management";

/**
 * Creates a portal event under one selected group. Profile activation and the
 * actor's effective group leadership are revalidated by the same D1 batch as
 * the insert, rather than trusting the request-time context alone.
 */
export async function createGroupManagedEvent(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  input: GroupEventCreateInput,
): Promise<{ eventId: string }> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  if (!group.active) throw new AppError(409, "GROUP_INACTIVE", "Events cannot be created in an inactive group");
  await requireGroupManagement(db, actor, group.id);

  const mutation = prepareEventCreateStatement(db, {
    slug: input.slug,
    name: input.name,
    timezone: input.timezone,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    registrationMode: input.registrationPolicy,
    visibility: input.visibility ?? "group_members",
    inviteLimitAttendee: input.inviteLimitAttendee,
    city: input.city ?? null,
    country: input.country ?? null,
    ownerGroupId: group.id,
    profileKey: input.profileKey,
    sourceMode: "portal",
    basePath: deriveEventBasePath({ slug: input.slug, base_path: null, starts_at: input.startsAt ?? null }),
    links: input.links,
  });
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [group.id]),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1
                FROM groups guarded_group
                JOIN event_profiles profile ON profile.key = ? AND profile.active = 1
               WHERE guarded_group.id = ? AND guarded_group.active = 1`,
        bindings: [input.profileKey, group.id],
      }),
      mutation.statement,
      prepareScopedAuditLog(
        db,
        { type: "group", id: group.id },
        "admin",
        actor.id,
        "group_event_created",
        "event",
        mutation.eventId,
        { slug: input.slug, profileKey: input.profileKey },
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "GROUP_EVENT_CREATE_AUTHORIZATION_CHANGED",
        "Group event creation authority or profile availability changed before the event was saved",
      );
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: events.slug")) {
      throw new AppError(409, "EVENT_SLUG_EXISTS", "An event with this slug already exists");
    }
    throw error;
  }
  return { eventId: mutation.eventId };
}

/**
 * Applies a group-scoped compare-and-set update. The event resource guard
 * checks the exact owner/grant capability and current leadership in the same
 * D1 transaction as the settings and audit transition.
 */
export async function updateGroupManagedEventSettings(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  input: GroupEventSettingsUpdateInput,
  appBaseUrl: string,
): Promise<void> {
  const read = prepareGroupEventSettingsRead(db, eventId, input);
  const results = await db.batch(read.statements);
  const event = read.decodeEvent(results[0]);
  const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, event.id, "manage");
  const snapshot = read.decode(results);
  await commitGroupEventSettings(db, actor, context, input, appBaseUrl, snapshot);
}

/** One resource snapshot plans form and settings changes for both authorized entry points. */
export function prepareGroupEventSettingsRead(db: DatabaseLike, eventId: string, input: GroupEventSettingsUpdateInput) {
  const at = nowIso();
  const formRead = prepareEventFormSettingsRead(db, eventId, input, at);
  const decodeEvent = (result: D1StatementResult) => {
    const event = batchFirst<EventRecord>(result);
    if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
    return event;
  };
  return {
    decodeEvent,
    statements: [
      prepareEventById(db, eventId),
      db.prepare("SELECT id FROM event_series WHERE event_id = ? LIMIT 1").bind(eventId),
      ...formRead.statements,
    ],
    decode(results: D1StatementResult[]) {
      const event = decodeEvent(results[0]);
      if (event.source_mode === "portal" && formRead.statements.length) {
        throw new AppError(
          409,
          "EVENT_FORM_PLACEMENT_REQUIRED",
          "Configure portal event forms through the event form settings",
        );
      }
      const formStatements = formRead.decode(results.slice(2));
      if (event.profile_key === "meeting" || event.profile_key === "board_meeting" || batchFirst(results[1])) {
        throw new AppError(
          409,
          "EVENT_MANAGED_BY_MEETING_SERIES",
          "Meeting events must be updated through their meeting series",
        );
      }
      return { at, event, formStatements };
    },
  };
}

/** Commit the planned transition and optional response in the same guarded transaction. */
export async function commitGroupEventSettings(
  db: DatabaseLike,
  actor: AuthAdmin,
  context: EventResourceManagementContext,
  input: GroupEventSettingsUpdateInput,
  appBaseUrl: string,
  snapshot: ReturnType<ReturnType<typeof prepareGroupEventSettingsRead>["decode"]>,
  authorizationGuards: StatementLike[] = [],
  responseStatements: StatementLike[] = [],
) {
  const { event, at, formStatements } = snapshot;
  const { expectedUpdatedAt, links, ...settings } = input;
  try {
    return await commitEventResourceManagementBatch(db, actor, context, "manage", [
      ...authorizationGuards,
      prepareGroupManagementAuthorizationGuard(db, actor, [context.groupId]),
      prepareStateGuard(db, {
        sql: `SELECT 1
                  FROM events guarded_event
                 WHERE guarded_event.id = ?
                   ${formStatements.length ? "AND COALESCE(guarded_event.source_mode, '') <> 'portal'" : ""}
                   AND COALESCE(guarded_event.profile_key, '') NOT IN ('meeting', 'board_meeting')
                   AND NOT EXISTS (
                     SELECT 1 FROM event_series guarded_series WHERE guarded_series.event_id = guarded_event.id
                   )`,
        bindings: [event.id],
      }),
      ...buildEventSettingsMutationStatements(db, {
        event,
        actorId: actor.id,
        settings,
        links,
        expectedUpdatedAt,
        updatedAt: at,
        auditScope: { type: "group", id: context.groupId },
        auditDetails: {
          ...settings,
          ...(links === undefined ? {} : { links }),
        },
        appBaseUrl,
      }),
      ...formStatements,
      ...responseStatements,
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "EVENT_MANAGEMENT_CONTEXT_CHANGED",
        "Event-management authority or form placement changed before the update was saved",
      );
    }
    if (isStateGuardFailure(error)) {
      throw new AppError(
        409,
        "EVENT_MANAGED_BY_MEETING_SERIES",
        "The event became managed by a meeting series before the update was saved",
      );
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "GROUP_EVENT_CHANGED", "The event changed; reload before saving");
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: events.slug")) {
      throw new AppError(409, "EVENT_SLUG_EXISTS", "An event with this slug already exists");
    }
    throw error;
  }
}

/**
 * The attendee list reuses the shared server-side list primitives while
 * keeping administrator-only registration data outside this projection.
 */
export async function listGroupManagedEventRegistrations(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  query: EventAttendanceRegistrationsQuery,
): Promise<{ event: { id: string; slug: string; name: string }; result: EventAttendanceRegistrationsListResult }> {
  const event = await getEventById(db, eventId);
  const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, event.id, "manage_attendance");
  return {
    event: { id: event.id, slug: event.slug, name: event.name },
    result: await listEventAttendanceRegistrations(
      guardEventResourceManagementDatabase(db, actor, context, "manage_attendance"),
      event.id,
      query,
    ),
  };
}
