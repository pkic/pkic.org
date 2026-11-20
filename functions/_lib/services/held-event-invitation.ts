import { first } from "../db/queries";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { activeEffectiveInviteExpirySql, effectiveInviteExpirySql } from "../invite-validity";
import type { DatabaseLike } from "../types";
import { inviteColumnProjection, type InviteRecord } from "./invite-types";

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Statuses that keep an invitation meaningful: `sent` still admits, `accepted` was used and keeps the event visible. */
type HeldInvitationStatus = Extract<InviteRecord["status"], "sent" | "accepted">;

/**
 * The one match for "this user holds an active invitation to this event": an
 * invitation addressed to the account's primary address or a verified added
 * one, in one of the given
 * statuses, whose effective deadline under the event window has not passed.
 * Event visibility, registration access and the portal prompt all read it, so
 * the person who can see an invitation-only event is the person it admits.
 *
 * Aliases and the user expression are trusted source constants; statuses come
 * from the closed union above. The user expression appears once, so a `?`
 * placeholder binds once. Registration applies the full sign-in address rule
 * (`readRegistrationAccessEvidence`); this shallower match keeps visibility within D1's
 * expression depth limit.
 */
export function heldEventInvitationConditions(input: {
  inviteAlias: string;
  /** An event row in scope; its window caps the invitation deadline. */
  eventAlias: string;
  userIdSql: string;
  statuses: readonly HeldInvitationStatus[];
  /** Registration admits attendee invitations only; visibility accepts every invitation type. */
  attendeeOnly?: boolean;
}): string {
  const { inviteAlias: invite, eventAlias: event } = input;
  return `${invite}.event_id = ${event}.id
    AND EXISTS (SELECT 1 FROM (SELECT ${input.userIdSql} AS id) held_account
      WHERE EXISTS (SELECT 1 FROM users held_person
              WHERE held_person.id = held_account.id AND held_person.normalized_email = ${invite}.invitee_email)
         OR EXISTS (SELECT 1 FROM user_emails held_address
              WHERE held_address.user_id = held_account.id AND held_address.normalized_email = ${invite}.invitee_email
                AND held_address.verified_at IS NOT NULL))
    AND ${invite}.status IN (${input.statuses.map((status) => `'${status}'`).join(", ")})
    ${input.attendeeOnly ? `AND ${invite}.invite_type = 'attendee'` : ""}
    AND ${activeEffectiveInviteExpirySql(effectiveInviteExpirySql(invite, event), NOW_SQL)}`;
}

/** The same match as an EXISTS predicate, for read models and visibility. */
export function heldEventInvitationExistsSql(input: Parameters<typeof heldEventInvitationConditions>[0]): string {
  return `EXISTS (SELECT 1 FROM invites ${input.inviteAlias} WHERE ${heldEventInvitationConditions(input)})`;
}

/**
 * Selects the user's open attendee invitation to the event, so registering can
 * accept it. An address holds at most one sent invitation of a type per event
 * (`uq_invites_active_recipient`); the lookup seeks the event's sent
 * attendee invitations on `idx_invites_event_status`.
 */
function heldAttendeeInvitationSelection(eventId: string, userId: string, inviteId?: string): AuthorizationEvidence {
  return {
    sql: `SELECT ${inviteColumnProjection("held_invite")}
            FROM events held_event
            JOIN invites held_invite ON ${heldEventInvitationConditions({
              inviteAlias: "held_invite",
              eventAlias: "held_event",
              userIdSql: "?",
              statuses: ["sent"],
              attendeeOnly: true,
            })}
           WHERE held_event.id = ? ${inviteId ? "AND held_invite.id = ?" : ""}
           LIMIT 1`,
    bindings: [userId, eventId, ...(inviteId ? [inviteId] : [])],
  };
}

/** The user's open attendee invitation to the event, or the named one when it is still theirs and open. */
export async function findHeldAttendeeInvitation(
  db: DatabaseLike,
  input: { eventId: string; userId: string; inviteId?: string },
): Promise<InviteRecord | null> {
  const selection = heldAttendeeInvitationSelection(input.eventId, input.userId, input.inviteId);
  return first<InviteRecord>(db, selection.sql, [...selection.bindings]);
}

/** Rechecks, in the registration batch, that the accepted invitation is still addressed to this user. */
export function heldAttendeeInvitationEvidence(input: {
  eventId: string;
  userId: string;
  inviteId: string;
}): AuthorizationEvidence {
  return heldAttendeeInvitationSelection(input.eventId, input.userId, input.inviteId);
}
