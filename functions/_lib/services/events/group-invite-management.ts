import type { EventAttendeeInviteSummary, EventInviteSummary } from "../../../../assets/shared/schemas/event-invites";
import type { GroupEventAttendeeInvitesListQuery } from "../../../../assets/shared/schemas/group-events";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { getEventById } from "../events";
import {
  buildEventInviteListResult,
  buildEventInvitesPageQuery,
  listEventInvitesOfType,
  type EventInviteRow,
} from "./event-invite-list";
import { resendEventInvite } from "../invite-resend";
import { revokeEventInvite } from "../invite-revoke";
import {
  guardEventResourceManagementDatabase,
  requireEventResourceManagementContext,
} from "../event-series/management";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import {
  prepareGroupEventProposalContextGuard,
  queryGroupEventProposalPage,
  requireGroupEventProposalContext,
} from "../proposal-group-context";

function attendeeProjection(invite: EventInviteSummary): EventAttendeeInviteSummary {
  return {
    id: invite.id,
    inviteeEmail: invite.inviteeEmail,
    inviteeFirstName: invite.inviteeFirstName,
    inviteeLastName: invite.inviteeLastName,
    inviteType: invite.inviteType,
    status: invite.status,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    declinedAt: invite.declinedAt,
    createdAt: invite.createdAt,
    actions: invite.actions,
  };
}

/** Lists only attendee invitations through the selected group's live event-management grant. */
export async function listGroupEventAttendeeInvites(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  query: GroupEventAttendeeInvitesListQuery,
) {
  const context = await requireEventResourceManagementContext(db, actor, groupId, eventId, "manage");
  const result = await listEventInvitesOfType(
    guardEventResourceManagementDatabase(db, actor, context, "manage"),
    eventId,
    "attendee",
    query,
  );
  return {
    invites: result.invites.map(attendeeProjection),
    page: result.page,
  };
}

/** Re-queues one attendee invitation under the selected group's atomic management guard. */
export async function resendGroupEventAttendeeInvite(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  inviteId: string,
  appBaseUrl: string,
  expiresAt?: string,
) {
  const context = await requireEventResourceManagementContext(db, actor, groupId, eventId, "manage");
  const guardedDb = guardEventResourceManagementDatabase(db, actor, context, "manage");
  const event = await getEventById(guardedDb, eventId);
  return resendEventInvite(guardedDb, {
    event,
    inviteId,
    actor,
    appBaseUrl,
    expectedInviteType: "attendee",
    auditScope: { type: "group", id: context.groupId },
    expiresAt,
  });
}

/** Revokes one attendee invitation under the selected group's atomic management guard. */
export async function revokeGroupEventAttendeeInvite(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  inviteId: string,
) {
  const context = await requireEventResourceManagementContext(db, actor, groupId, eventId, "manage");
  const guardedDb = guardEventResourceManagementDatabase(db, actor, context, "manage");
  const event = await getEventById(guardedDb, eventId);
  await revokeEventInvite(guardedDb, {
    event,
    inviteId,
    actor,
    expectedInviteType: "attendee",
    auditScope: { type: "group", id: context.groupId },
  });
}

/** Speaker lifecycle is proposal-scoped and deliberately does not reuse the attendee projection. */
export async function listGroupEventSpeakerInvites(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  query: GroupEventAttendeeInvitesListQuery,
) {
  const context = await requireGroupEventProposalContext(db, actor, groupId, eventId, "proposals:manage");
  const page = await queryGroupEventProposalPage<EventInviteRow>(
    db,
    actor,
    context,
    "proposals:manage",
    buildEventInvitesPageQuery(context.eventId, { ...query, type: "speaker" }),
  );
  return buildEventInviteListResult(query, page.rows, page.total);
}

export async function resendGroupEventSpeakerInvite(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  inviteId: string,
  appBaseUrl: string,
  expiresAt?: string,
) {
  const context = await requireGroupEventProposalContext(db, actor, groupId, eventId, "proposals:manage");
  const event = await getEventById(db, context.eventId);
  return resendEventInvite(db, {
    event,
    inviteId,
    actor,
    appBaseUrl,
    expectedInviteType: "speaker",
    auditScope: { type: "group", id: context.groupId },
    expiresAt,
    authorizationStatements: [
      prepareGroupEventProposalContextGuard(db, context),
      preparePermissionsAuthorizationGuard(db, actor, [
        { permission: "proposals:manage", context: { type: "event", id: event.id } },
      ]),
    ],
  });
}

export async function revokeGroupEventSpeakerInvite(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  inviteId: string,
) {
  const context = await requireGroupEventProposalContext(db, actor, groupId, eventId, "proposals:manage");
  const event = await getEventById(db, context.eventId);
  await revokeEventInvite(db, {
    event,
    inviteId,
    actor,
    expectedInviteType: "speaker",
    auditScope: { type: "group", id: context.groupId },
    authorizationStatements: [
      prepareGroupEventProposalContextGuard(db, context),
      preparePermissionsAuthorizationGuard(db, actor, [
        { permission: "proposals:manage", context: { type: "event", id: event.id } },
      ]),
    ],
  });
}
