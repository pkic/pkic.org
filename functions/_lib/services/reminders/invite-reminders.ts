import { all } from "../../db/queries";
import { sha256Hex } from "../../utils/crypto";
import { formatInviterList, type InviteInviterInfo } from "../invites";
import { buildInviteEmailQueueRow } from "../invite-email";
import { isStaleInviteTransition, prepareInviteTransitionGuard } from "../invite-lifecycle";
import {
  daysUntil,
  inviteReminderSubject,
  type DueInviteRow,
  type EventRouteRow,
  type ReminderCandidatePreview,
} from "../reminders-support";
import { attendeeEffectiveDeadline, batchQueueEmailsAndUpdateState } from "./shared";
import type { DatabaseLike } from "../../types";
import {
  activeEffectiveInviteExpirySql,
  effectiveInviteExpirySql,
  eventInviteWindowsEvidence,
} from "../../invite-validity";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";

export async function runInviteReminders(
  db: DatabaseLike,
  params: {
    appBaseUrl: string;
    limit: number;
    maxInviteReminders: number;
    cutoff: string;
    now: string;
    dryRun?: boolean;
  },
): Promise<{
  inviteRemindersQueued: number;
  attendeeInvites: ReminderCandidatePreview[];
  speakerInvites: ReminderCandidatePreview[];
}> {
  const { appBaseUrl, limit, maxInviteReminders, cutoff, now, dryRun } = params;

  const dueInvites = await all<DueInviteRow>(
    db,
    `WITH candidates AS (
       SELECT
         i.id, i.event_id, i.invitee_email, i.invitee_first_name, i.invitee_last_name,
         i.invite_type, i.link_secret, i.reminder_count, i.transition_revision,
         ${effectiveInviteExpirySql("i", "e")} AS expires_at,
         e.name AS event_name, e.slug AS event_slug, e.base_path AS event_base_path,
         e.starts_at AS event_starts_at, e.ends_at AS event_ends_at, e.settings_json AS event_settings_json,
         CASE WHEN json_valid(e.settings_json)
           THEN COALESCE(
             json_extract(e.settings_json, '$.registration.closesAt'),
             json_extract(e.settings_json, '$.registrationClosesAt')
           )
           ELSE NULL
         END AS registration_closes_at,
         COALESCE(i.last_communication_at, i.created_at) AS candidate_due_at
       FROM invites i
       JOIN events e ON e.id = i.event_id
       WHERE i.status = 'sent'
         AND ${activeEffectiveInviteExpirySql(effectiveInviteExpirySql("i", "e"))}
         AND i.reminder_count < ?
         AND (i.reminders_paused_until IS NULL OR i.reminders_paused_until <= ?)
         AND COALESCE(i.last_communication_at, i.created_at) <= ?
     )
     SELECT
       id, event_id, invitee_email, invitee_first_name, invitee_last_name,
       invite_type, link_secret, reminder_count, transition_revision, expires_at, event_name, event_slug,
       event_base_path, event_starts_at, event_ends_at, event_settings_json
     FROM candidates
     WHERE invite_type <> 'attendee'
       OR (
         (event_starts_at IS NULL OR datetime(event_starts_at) IS NULL OR datetime(event_starts_at) > datetime(?))
         AND (
           registration_closes_at IS NULL
           OR datetime(registration_closes_at) IS NULL
           OR datetime(registration_closes_at) > datetime(?)
         )
       )
     ORDER BY candidate_due_at ASC, id ASC
     LIMIT ?`,
    [now, maxInviteReminders, now, cutoff, now, now, limit],
  );

  const attendeeInvites: ReminderCandidatePreview[] = [];
  const speakerInvites: ReminderCandidatePreview[] = [];
  for (const invite of dueInvites) {
    const event: EventRouteRow = {
      id: invite.event_id,
      name: invite.event_name,
      slug: invite.event_slug,
      base_path: invite.event_base_path,
      starts_at: invite.event_starts_at,
      settings_json: invite.event_settings_json,
    };
    const isAttendee = invite.invite_type === "attendee";
    const deadlineForUrgency = isAttendee ? attendeeEffectiveDeadline(invite) : invite.expires_at;
    const reminderNumber = Number(invite.reminder_count ?? 0) + 1;
    const candidate: ReminderCandidatePreview = {
      category: isAttendee ? "attendee_invite" : "speaker_invite",
      templateKey: isAttendee ? "attendee_invite" : "speaker_invite",
      eventName: event.name,
      eventSlug: event.slug,
      recipientEmail: invite.invitee_email,
      recipientName: [invite.invitee_first_name, invite.invitee_last_name].filter(Boolean).join(" ") || null,
      proposalTitle: null,
      reminderNumber,
      dueAt: deadlineForUrgency,
      subject: inviteReminderSubject(event.name, reminderNumber, daysUntil(deadlineForUrgency)),
    };
    if (isAttendee) attendeeInvites.push(candidate);
    else speakerInvites.push(candidate);
  }

  let queuedCount = 0;
  if (!dryRun && dueInvites.length > 0) {
    const inviteIds = dueInvites.map((i) => i.id);
    const inviterRows = await all<InviteInviterInfo & { invite_id: string }>(
      db,
      `SELECT ii.invite_id, ii.inviter_user_id AS userId, u.first_name AS firstName,
              u.last_name AS lastName, u.organization_name AS organizationName
       FROM invite_inviters ii
       JOIN users u ON u.id = ii.inviter_user_id
       WHERE ii.invite_id IN (SELECT value FROM json_each(?))
       ORDER BY ii.invited_at ASC`,
      [JSON.stringify(inviteIds)],
    );
    const invitersByInviteId = new Map<string, InviteInviterInfo[]>();
    for (const row of inviterRows) {
      const arr = invitersByInviteId.get(row.invite_id) ?? [];
      arr.push({
        userId: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        organizationName: row.organizationName,
      });
      invitersByInviteId.set(row.invite_id, arr);
    }

    const emailRows = await Promise.all(
      dueInvites.map(async (invite) => {
        const event: EventRouteRow = {
          id: invite.event_id,
          name: invite.event_name,
          slug: invite.event_slug,
          base_path: invite.event_base_path,
          starts_at: invite.event_starts_at,
          settings_json: invite.event_settings_json,
        };
        const isAttendee = invite.invite_type === "attendee";
        const deadlineForUrgency = isAttendee ? attendeeEffectiveDeadline(invite) : invite.expires_at;
        const daysToExpiry = daysUntil(deadlineForUrgency);
        const reminderNumber = Number(invite.reminder_count ?? 0) + 1;
        const subject = inviteReminderSubject(event.name, reminderNumber, daysToExpiry);
        return buildInviteEmailQueueRow({
          event,
          invite,
          appBaseUrl,
          source: isAttendee ? "invite_reminder" : "speaker_invite_reminder",
          subject,
          inviterName: formatInviterList(invitersByInviteId.get(invite.id) ?? []),
          reminderCount: String(reminderNumber),
          daysUntilExpiry: daysToExpiry !== null ? String(daysToExpiry) : "",
          linkSecretFingerprint: await sha256Hex(invite.link_secret),
        });
      }),
    );

    queuedCount = await batchQueueEmailsAndUpdateState(
      db,
      emailRows,
      dueInvites.map((invite) => [
        prepareInviteTransitionGuard(db, invite),
        db
          .prepare(
            "UPDATE invites SET reminder_count = reminder_count + 1, last_communication_at = ?, reminders_paused_until = NULL WHERE id = ? AND status = 'sent'",
          )
          .bind(now, invite.id),
      ]),
      now,
      {
        isExpectedConflict: (error) => isStaleInviteTransition(error) || isAuthorizationGuardFailure(error),
        prepareSliceStatements: (start, end) => [
          prepareAuthorizationGuard(
            db,
            eventInviteWindowsEvidence(
              dueInvites.slice(start, end).map((invite) => ({
                eventId: invite.event_id,
                event: { starts_at: invite.event_starts_at, ends_at: invite.event_ends_at },
                expiresAt: invite.expires_at!,
              })),
              now,
            ),
          ),
        ],
      },
    );
  }

  return { inviteRemindersQueued: dryRun ? dueInvites.length : queuedCount, attendeeInvites, speakerInvites };
}
