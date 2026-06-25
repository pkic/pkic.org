import { all } from "../../db/queries";
import { inviteDeclineUrl, registrationPageUrl, proposalPageUrl } from "../frontend-links";
import { formatInviterList, type InviteInviterInfo } from "../invites";
import { buildEventEmailVariables } from "../events";
import { randomToken, sha256Hex } from "../../utils/crypto";
import {
  daysUntil,
  inviteReminderSubject,
  type DueInviteRow,
  type EventRouteRow,
  type ReminderCandidatePreview,
} from "../reminders-support";
import {
  batchStatements,
  batchQueueEmailsAndUpdateState,
  isAttendeeInviteReminderAllowed,
  attendeeEffectiveDeadline,
} from "./shared";
import type { DatabaseLike } from "../../types";

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
    `SELECT
       i.id, i.event_id, i.invitee_email, i.invitee_first_name, i.invitee_last_name,
       i.invite_type, i.reminder_count, i.expires_at,
       e.name AS event_name, e.slug AS event_slug, e.base_path AS event_base_path,
       e.starts_at AS event_starts_at, e.settings_json AS event_settings_json
     FROM invites i
     JOIN events e ON e.id = i.event_id
     WHERE i.status = 'sent'
       AND i.reminder_count < ?
       AND (i.reminders_paused_until IS NULL OR i.reminders_paused_until <= ?)
       AND COALESCE(i.last_communication_at, i.created_at) <= ?
     ORDER BY COALESCE(i.last_communication_at, i.created_at) ASC
     LIMIT ?`,
    [maxInviteReminders, now, cutoff, limit],
  );

  const filteredInvites = dueInvites.filter((i) => i.invite_type !== "attendee" || isAttendeeInviteReminderAllowed(i));

  const attendeeInvites: ReminderCandidatePreview[] = [];
  const speakerInvites: ReminderCandidatePreview[] = [];
  for (const invite of filteredInvites) {
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

  if (!dryRun && filteredInvites.length > 0) {
    const tokenData = await Promise.all(
      filteredInvites.map(async (invite) => {
        const token = randomToken(24);
        const hash = await sha256Hex(token);
        return { id: invite.id, token, hash };
      }),
    );
    const tokenByInviteId = new Map(tokenData.map((t) => [t.id, t.token]));

    await batchStatements(
      db,
      tokenData.map((t) => db.prepare("UPDATE invites SET token_hash = ? WHERE id = ?").bind(t.hash, t.id)),
    );

    const inviteIds = filteredInvites.map((i) => i.id);
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

    const emailRows = filteredInvites.map((invite) => {
      const event: EventRouteRow = {
        id: invite.event_id,
        name: invite.event_name,
        slug: invite.event_slug,
        base_path: invite.event_base_path,
        starts_at: invite.event_starts_at,
        settings_json: invite.event_settings_json,
      };
      const isAttendee = invite.invite_type === "attendee";
      const token = tokenByInviteId.get(invite.id)!;
      const actionUrl = isAttendee
        ? registrationPageUrl(appBaseUrl, event, { invite: token, inviteId: invite.id, source: "invite_reminder" })
        : proposalPageUrl(appBaseUrl, event, { invite: token, inviteId: invite.id, source: "speaker_invite_reminder" });
      const declineUrl = inviteDeclineUrl(appBaseUrl, event, token, invite.id);
      const deadlineForUrgency = isAttendee ? attendeeEffectiveDeadline(invite) : invite.expires_at;
      const daysToExpiry = daysUntil(deadlineForUrgency);
      const reminderNumber = Number(invite.reminder_count ?? 0) + 1;
      const subject = inviteReminderSubject(event.name, reminderNumber, daysToExpiry);
      return {
        eventId: event.id,
        recipientEmail: invite.invitee_email,
        templateKey: isAttendee ? "attendee_invite" : "speaker_invite",
        subject,
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          firstName: invite.invitee_first_name ?? "",
          lastName: invite.invitee_last_name ?? "",
          inviterName: formatInviterList(invitersByInviteId.get(invite.id) ?? []),
          registrationUrl: isAttendee ? actionUrl : undefined,
          proposalUrl: isAttendee ? undefined : actionUrl,
          declineUrl,
          isReminder: true,
          reminderCount: String(reminderNumber),
          daysUntilExpiry: daysToExpiry !== null ? String(daysToExpiry) : "",
          __subjectOverride: subject,
        },
      };
    });

    await batchQueueEmailsAndUpdateState(
      db,
      emailRows,
      filteredInvites.map((invite) =>
        db
          .prepare(
            "UPDATE invites SET reminder_count = reminder_count + 1, last_communication_at = ?, reminders_paused_until = NULL WHERE id = ?",
          )
          .bind(now, invite.id),
      ),
      now,
    );
  }

  return { inviteRemindersQueued: filteredInvites.length, attendeeInvites, speakerInvites };
}
