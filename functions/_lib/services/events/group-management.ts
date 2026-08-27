import type { EventAttendanceRegistrationsQuery } from "../../../../assets/shared/schemas/event-registrations";
import type {
  GroupEventCreateInput,
  GroupEventSettingsUpdateInput,
} from "../../../../assets/shared/schemas/group-events";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLog } from "../audit";
import { getGroup, prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "../groups";
import { getEventById, prepareEventCreateStatement } from "../events";
import {
  listEventAttendanceRegistrations,
  type EventAttendanceRegistrationsListResult,
} from "../registrations/event-attendance-registrations";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { initialEventSettings, buildEventSettingsMutationStatements } from "./settings";
import {
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
    inviteLimitAttendee: input.inviteLimitAttendee,
    settings: initialEventSettings(input),
    ownerGroupId: group.id,
    profileKey: input.profileKey,
    sourceMode: "portal",
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
  const event = await getEventById(db, eventId);
  const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, event.id, "manage");
  const seriesManaged = await db
    .prepare(
      `SELECT 1
         FROM events event
         LEFT JOIN event_series series ON series.event_id = event.id
        WHERE event.id = ?
          AND (event.profile_key IN ('meeting', 'board_meeting') OR series.id IS NOT NULL)`,
    )
    .bind(event.id)
    .first();
  if (seriesManaged) {
    throw new AppError(
      409,
      "EVENT_MANAGED_BY_MEETING_SERIES",
      "Meeting events must be updated through their meeting series",
    );
  }
  const { expectedUpdatedAt, links, ...settings } = input;
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1
                  FROM events guarded_event
                 WHERE guarded_event.id = ?
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
        auditScope: { type: "group", id: context.groupId },
        auditDetails: {
          ...settings,
          ...(links === undefined ? {} : { links }),
        },
        appBaseUrl,
      }),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "EVENT_MANAGED_BY_MEETING_SERIES",
        "The event became managed by a meeting series before the update was saved",
      );
    }
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "GROUP_EVENT_CHANGED", "The event changed; reload before saving");
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
