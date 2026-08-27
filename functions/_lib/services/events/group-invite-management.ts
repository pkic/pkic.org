import type { EventAttendeeInviteSummary, EventInviteSummary } from "../../../../assets/shared/schemas/event-invites";
import type { GroupEventAttendeeInvitesListQuery } from "../../../../assets/shared/schemas/group-events";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { getEventById } from "../events";
import { listEventInvitesOfType } from "./event-invite-list";
import { resendEventInvite } from "../invite-resend";
import { revokeEventInvite } from "../invite-revoke";
import {
  guardEventResourceManagementDatabase,
  requireEventResourceManagementContext,
} from "../event-series/management";

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
