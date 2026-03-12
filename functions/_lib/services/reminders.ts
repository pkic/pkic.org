import { all, run } from "../db/queries";
import { queueEmail } from "../email/outbox";
import { inviteDeclineUrl, proposalPageUrl, registrationPageUrl, speakerManagePageUrl } from "./frontend-links";
import { markInviteReminderSent, refreshInviteToken } from "./invites";
import { refreshSpeakerManageToken } from "./proposals";
import { buildEventEmailVariables } from "./events";
import { nowIso } from "../utils/time";
import { parseJsonSafe } from "../utils/json";
import type { DatabaseLike } from "../types";

interface EventRouteRow {
  id: string;
  name: string;
  slug: string;
  base_path: string | null;
  starts_at: string | null;
  settings_json: string;
}

interface DueInviteRow {
  id: string;
  event_id: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: "attendee" | "speaker";
  reminder_count: number;
  expires_at: string | null;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_starts_at: string | null;
  event_settings_json: string;
}

interface EventReminderSettings {
  registrationClosesAt?: string | null;
  registration?: {
    closesAt?: string | null;
  };
}

function attendeeRegistrationClosesAt(invite: DueInviteRow): string | null {
  const settings = parseJsonSafe<EventReminderSettings>(invite.event_settings_json, {});
  return settings.registration?.closesAt ?? settings.registrationClosesAt ?? null;
}

interface DuePresentationRow {
  speaker_id: string;
  proposal_id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  proposal_title: string;
  event_id: string;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_starts_at: string | null;
  event_settings_json: string;
  presentation_deadline: string | null;
  reminder_count: number;
}

function daysUntil(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  return Math.ceil(diff / 86_400_000);
}

function inviteReminderSubject(eventName: string, reminderNumber: number, daysToExpiry: number | null): string {
  if (daysToExpiry !== null && daysToExpiry <= 2) {
    return `Final reminder: your invitation expires soon — ${eventName}`;
  }
  const variants = [
    `Reminder: your invitation to ${eventName}`,
    `Still interested in ${eventName}?`,
    `Quick follow-up: ${eventName} invitation`,
  ];
  return variants[(Math.max(1, reminderNumber) - 1) % variants.length];
}

function presentationReminderSubject(eventName: string, reminderNumber: number, daysToDeadline: number | null): string {
  if (daysToDeadline !== null && daysToDeadline <= 1) {
    return `Final call: upload your presentation today — ${eventName}`;
  }
  if (daysToDeadline !== null && daysToDeadline <= 3) {
    return `Urgent: presentation upload deadline is near — ${eventName}`;
  }
  const variants = [
    `Reminder: please upload your presentation — ${eventName}`,
    `We still need your slides for ${eventName}`,
    `Quick follow-up: presentation upload for ${eventName}`,
  ];
  return variants[(Math.max(1, reminderNumber) - 1) % variants.length];
}

function isAttendeeInviteReminderAllowed(invite: DueInviteRow): boolean {
  const nowMs = Date.now();

  // Do not remind attendees after the event has started.
  if (invite.event_starts_at) {
    const startsMs = new Date(invite.event_starts_at).getTime();
    if (Number.isFinite(startsMs) && startsMs <= nowMs) {
      return false;
    }
  }

  // Respect optional registration closure in event settings.
  const closesAt = attendeeRegistrationClosesAt(invite);
  if (closesAt) {
    const closesMs = new Date(closesAt).getTime();
    if (Number.isFinite(closesMs) && closesMs <= nowMs) {
      return false;
    }
  }

  return true;
}

function attendeeEffectiveDeadline(invite: DueInviteRow): string | null {
  const candidates = [invite.expires_at, attendeeRegistrationClosesAt(invite)]
    .filter((v): v is string => Boolean(v));

  if (candidates.length === 0) return null;

  let minIso = candidates[0];
  let minTs = new Date(minIso).getTime();
  for (const iso of candidates.slice(1)) {
    const ts = new Date(iso).getTime();
    if (Number.isFinite(ts) && ts < minTs) {
      minTs = ts;
      minIso = iso;
    }
  }
  return minIso;
}

export async function runReminderCycle(
  db: DatabaseLike,
  payload: {
    appBaseUrl: string;
    reminderIntervalDays: number;
    maxInviteReminders: number;
    maxPresentationReminders: number;
    limit: number;
    dryRun?: boolean;
  },
): Promise<{
  inviteRemindersQueued: number;
  presentationRemindersQueued: number;
  processed: number;
}> {
  const now = nowIso();
  const cutoff = new Date(Date.now() - payload.reminderIntervalDays * 86_400_000).toISOString();

  const dueInvites = await all<DueInviteRow>(
    db,
    `SELECT
       i.id,
       i.event_id,
       i.invitee_email,
       i.invitee_first_name,
       i.invitee_last_name,
       i.invite_type,
       i.reminder_count,
       i.expires_at,
       e.name       AS event_name,
       e.slug       AS event_slug,
       e.base_path  AS event_base_path,
       e.starts_at  AS event_starts_at,
       e.settings_json AS event_settings_json
     FROM invites i
     JOIN events e ON e.id = i.event_id
     WHERE i.status = 'sent'
       AND i.reminder_count < ?
       AND (i.expires_at IS NULL OR i.expires_at > ?)
       AND (i.reminders_paused_until IS NULL OR i.reminders_paused_until <= ?)
       AND COALESCE(i.last_communication_at, i.created_at) <= ?
     ORDER BY COALESCE(i.last_communication_at, i.created_at) ASC
     LIMIT ?`,
    [payload.maxInviteReminders, now, now, cutoff, payload.limit],
  );

  let inviteRemindersQueued = 0;

  for (const invite of dueInvites) {
    if (invite.invite_type === "attendee" && !isAttendeeInviteReminderAllowed(invite)) {
      continue;
    }

    const event: EventRouteRow = {
      id: invite.event_id,
      name: invite.event_name,
      slug: invite.event_slug,
      base_path: invite.event_base_path,
      starts_at: invite.event_starts_at,
      settings_json: invite.event_settings_json,
    };

    const token = await refreshInviteToken(db, invite.id);
    const isAttendee = invite.invite_type === "attendee";
    const actionUrl = isAttendee
      ? registrationPageUrl(payload.appBaseUrl, event, { invite: token, source: "invite_reminder" })
      : proposalPageUrl(payload.appBaseUrl, event, { invite: token, source: "speaker_invite_reminder" });
    const declineUrl = inviteDeclineUrl(payload.appBaseUrl, event, token);
    const deadlineForUrgency = isAttendee ? attendeeEffectiveDeadline(invite) : invite.expires_at;
    const daysToExpiry = daysUntil(deadlineForUrgency);
    const reminderNumber = Number(invite.reminder_count ?? 0) + 1;
    const subject = inviteReminderSubject(event.name, reminderNumber, daysToExpiry);

    if (!payload.dryRun) {
      await queueEmail(db, {
        eventId: event.id,
        templateKey: isAttendee ? "attendee_invite" : "speaker_invite",
        recipientEmail: invite.invitee_email,
        messageType: "transactional",
        subject,
        data: {
          ...buildEventEmailVariables(event, payload.appBaseUrl),
          firstName: invite.invitee_first_name ?? "",
          lastName: invite.invitee_last_name ?? "",
          registrationUrl: isAttendee ? actionUrl : undefined,
          proposalUrl: isAttendee ? undefined : actionUrl,
          declineUrl,
          isReminder: true,
          reminderCount: String(reminderNumber),
          daysUntilExpiry: daysToExpiry !== null ? String(daysToExpiry) : "",
          __subjectOverride: subject,
        },
      });

      await markInviteReminderSent(db, invite.id);
    }

    inviteRemindersQueued += 1;
  }

  const remainingLimit = Math.max(0, payload.limit - inviteRemindersQueued);

  const duePresentation = remainingLimit > 0
    ? await all<DuePresentationRow>(
      db,
      `SELECT
         ps.id                  AS speaker_id,
         ps.proposal_id         AS proposal_id,
         ps.user_id             AS user_id,
         u.email                AS email,
         u.first_name           AS first_name,
         u.last_name            AS last_name,
         sp.title               AS proposal_title,
         sp.event_id            AS event_id,
         e.name                 AS event_name,
         e.slug                 AS event_slug,
         e.base_path            AS event_base_path,
         e.starts_at            AS event_starts_at,
         e.settings_json        AS event_settings_json,
         sp.presentation_deadline AS presentation_deadline,
         ps.presentation_reminder_count AS reminder_count
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
       JOIN session_proposals sp ON sp.id = ps.proposal_id
       JOIN events e ON e.id = sp.event_id
       WHERE sp.status = 'accepted'
         AND ps.status IN ('invited', 'confirmed')
         AND sp.presentation_uploaded_at IS NULL
         AND (sp.presentation_deadline IS NULL OR sp.presentation_deadline > ?)
         AND ps.presentation_reminder_count < ?
         AND (ps.presentation_reminders_paused_until IS NULL OR ps.presentation_reminders_paused_until <= ?)
         AND COALESCE(ps.presentation_last_communication_at, sp.updated_at, ps.created_at) <= ?
       ORDER BY COALESCE(ps.presentation_last_communication_at, sp.updated_at, ps.created_at) ASC
       LIMIT ?`,
      [now, payload.maxPresentationReminders, now, cutoff, remainingLimit],
    )
    : [];

  let presentationRemindersQueued = 0;

  for (const row of duePresentation) {
    const event: EventRouteRow = {
      id: row.event_id,
      name: row.event_name,
      slug: row.event_slug,
      base_path: row.event_base_path,
      starts_at: row.event_starts_at,
      settings_json: row.event_settings_json,
    };

    const manageToken = await refreshSpeakerManageToken(db, row.proposal_id, row.user_id);

    const uploadUrl = speakerManagePageUrl(payload.appBaseUrl, event, manageToken);
    const daysToDeadline = daysUntil(row.presentation_deadline);
    const reminderNumber = Number(row.reminder_count ?? 0) + 1;
    const subject = presentationReminderSubject(event.name, reminderNumber, daysToDeadline);

    if (!payload.dryRun) {
      await queueEmail(db, {
        eventId: row.event_id,
        templateKey: "presentation_upload_request",
        recipientEmail: row.email,
        recipientUserId: row.user_id,
        messageType: "transactional",
        subject,
        data: {
          ...buildEventEmailVariables(event, payload.appBaseUrl),
          firstName: row.first_name ?? "",
          proposalTitle: row.proposal_title,
          uploadUrl,
          deadline: row.presentation_deadline ?? "",
          isReminder: true,
          reminderCount: String(reminderNumber),
          daysUntilDeadline: daysToDeadline !== null ? String(daysToDeadline) : "",
          __subjectOverride: subject,
        },
      });

      await run(
        db,
        `UPDATE proposal_speakers
         SET presentation_reminder_count = presentation_reminder_count + 1,
             presentation_last_communication_at = ?,
             presentation_reminders_paused_until = NULL
         WHERE id = ?`,
        [now, row.speaker_id],
      );
    }

    presentationRemindersQueued += 1;
  }

  return {
    inviteRemindersQueued,
    presentationRemindersQueued,
    processed: inviteRemindersQueued + presentationRemindersQueued,
  };
}