import { all } from "../../db/queries";
import { speakerManagePageUrl } from "../frontend-links";
import { buildEventEmailVariables } from "../events";
import { randomToken, sha256Hex } from "../../utils/crypto";
import { type DueSpeakerInviteRow, type EventRouteRow, type ReminderCandidatePreview } from "../reminders-support";
import { batchStatements, batchQueueEmailsAndUpdateState, bulkBuildProposalInviteEmailContexts } from "./shared";
import type { DatabaseLike } from "../../types";

export async function runCoSpeakerInviteReminders(
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
  speakerInviteRemindersQueued: number;
  coSpeakerInvites: ReminderCandidatePreview[];
}> {
  const { appBaseUrl, limit, maxInviteReminders, cutoff, now, dryRun } = params;

  const dueSpeakerInvites =
    limit > 0
      ? await all<DueSpeakerInviteRow>(
          db,
          `SELECT
         ps.id AS speaker_id, ps.proposal_id, ps.user_id, ps.role, ps.status AS speaker_status,
         u.email, u.first_name, u.last_name,
         sp.title AS proposal_title, pu.first_name AS proposer_first_name,
         sp.event_id, e.name AS event_name, e.slug AS event_slug,
         e.base_path AS event_base_path, e.starts_at AS event_starts_at,
         e.settings_json AS event_settings_json,
         ps.speaker_invite_reminder_count AS reminder_count
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
       JOIN session_proposals sp ON sp.id = ps.proposal_id
       JOIN events e ON e.id = sp.event_id
       LEFT JOIN users pu ON pu.id = sp.proposer_user_id
       WHERE ps.status = 'invited'
         AND ps.role <> 'proposer'
         AND sp.status NOT IN ('rejected', 'withdrawn')
         AND (e.starts_at IS NULL OR e.starts_at > ?)
         AND ps.speaker_invite_reminder_count < ?
         AND (ps.speaker_invite_reminders_paused_until IS NULL OR ps.speaker_invite_reminders_paused_until <= ?)
         AND COALESCE(ps.speaker_invite_last_communication_at, ps.created_at) <= ?
       ORDER BY COALESCE(ps.speaker_invite_last_communication_at, ps.created_at) ASC
       LIMIT ?`,
          [now, maxInviteReminders, now, cutoff, limit],
        )
      : [];

  const uniqueProposalIds = [...new Set(dueSpeakerInvites.map((r) => r.proposal_id))];
  const proposalContexts = await bulkBuildProposalInviteEmailContexts(db, uniqueProposalIds);

  const coSpeakerInvites: ReminderCandidatePreview[] = [];
  for (const row of dueSpeakerInvites) {
    const event: EventRouteRow = {
      id: row.event_id,
      name: row.event_name,
      slug: row.event_slug,
      base_path: row.event_base_path,
      starts_at: row.event_starts_at,
      settings_json: row.event_settings_json,
    };
    const reminderNumber = Number(row.reminder_count ?? 0) + 1;
    const ctx = proposalContexts.get(row.proposal_id);
    coSpeakerInvites.push({
      category: "co_speaker_invite",
      templateKey: "co_speaker_invite",
      eventName: event.name,
      eventSlug: event.slug,
      recipientEmail: row.email,
      recipientName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
      proposalTitle: ctx?.proposalTitle ?? null,
      reminderNumber,
      dueAt: event.starts_at,
      subject: `Reminder: please confirm speaker participation — ${event.name}`,
    });
  }

  if (!dryRun && dueSpeakerInvites.length > 0) {
    const tokenData = await Promise.all(
      dueSpeakerInvites.map(async (row) => {
        const token = randomToken(24);
        const hash = await sha256Hex(token);
        return { proposalId: row.proposal_id, userId: row.user_id, speakerId: row.speaker_id, token, hash };
      }),
    );
    const speakerTokenKey = (proposalId: string, userId: string) => `${proposalId}:${userId}`;
    const speakerTokenByKey = new Map(tokenData.map((t) => [speakerTokenKey(t.proposalId, t.userId), t.token]));

    await batchStatements(
      db,
      tokenData.map((t) =>
        db
          .prepare("UPDATE proposal_speakers SET manage_token_hash = ? WHERE proposal_id = ? AND user_id = ?")
          .bind(t.hash, t.proposalId, t.userId),
      ),
    );

    const emailRows = dueSpeakerInvites.map((row) => {
      const event: EventRouteRow = {
        id: row.event_id,
        name: row.event_name,
        slug: row.event_slug,
        base_path: row.event_base_path,
        starts_at: row.event_starts_at,
        settings_json: row.event_settings_json,
      };
      const reminderNumber = Number(row.reminder_count ?? 0) + 1;
      const subject = `Reminder: please confirm speaker participation — ${event.name}`;
      const manageToken = speakerTokenByKey.get(speakerTokenKey(row.proposal_id, row.user_id))!;
      const ctx = proposalContexts.get(row.proposal_id);
      return {
        eventId: row.event_id,
        recipientEmail: row.email,
        recipientUserId: row.user_id,
        templateKey: "co_speaker_invite",
        subject,
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          firstName: row.first_name ?? "",
          lastName: row.last_name ?? "",
          proposerFirstName: row.proposer_first_name ?? "",
          invitedByDisplay: ctx?.invitedByDisplay ?? "",
          proposalTitle: ctx?.proposalTitle ?? "",
          proposalAbstract: ctx?.proposalAbstract ?? "",
          speakerLineupText: ctx?.speakerLineupText ?? "",
          manageUrl: speakerManagePageUrl(appBaseUrl, event, manageToken),
          isReminder: true,
          reminderCount: String(reminderNumber),
        },
      };
    });

    await batchQueueEmailsAndUpdateState(
      db,
      emailRows,
      dueSpeakerInvites.map((row) =>
        db
          .prepare(
            `UPDATE proposal_speakers
           SET speaker_invite_reminder_count = speaker_invite_reminder_count + 1,
               speaker_invite_last_communication_at = ?,
               speaker_invite_reminders_paused_until = NULL
           WHERE id = ?`,
          )
          .bind(now, row.speaker_id),
      ),
      now,
    );
  }

  return { speakerInviteRemindersQueued: dueSpeakerInvites.length, coSpeakerInvites };
}
