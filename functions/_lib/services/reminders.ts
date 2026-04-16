import { all } from "../db/queries";
import { bulkQueueInviteEmails } from "../email/outbox";
import {
  inviteDeclineUrl,
  proposalPageUrl,
  registrationPageUrl,
  speakerManagePageUrl,
  registrationConfirmPageUrl,
} from "./frontend-links";
import { formatInviterList, type InviteInviterInfo } from "./invites";
import { formatInvitePerson, type ProposalInviteEmailContext } from "./proposals";
import { buildEventEmailVariables } from "./events";
import { nowIso, addHours } from "../utils/time";
import { parseJsonSafe } from "../utils/json";
import { randomToken, sha256Hex } from "../utils/crypto";
import type { DatabaseLike, StatementLike } from "../types";

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

interface DueSpeakerInviteRow {
  speaker_id: string;
  proposal_id: string;
  user_id: string;
  role: string;
  speaker_status: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  proposal_title: string;
  proposer_first_name: string | null;
  event_id: string;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_starts_at: string | null;
  event_settings_json: string;
  reminder_count: number;
}

interface ConfirmationReminderRow {
  id: string;
  event_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  confirmation_token_hash: string;
  confirmation_token_expires_at: string;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_starts_at: string | null;
  event_settings_json: string;
}

interface ReminderCandidatePreview {
  category:
    | "attendee_invite"
    | "speaker_invite"
    | "co_speaker_invite"
    | "presentation_upload_request"
    | "registration_confirmation";
  templateKey: string;
  eventName: string;
  eventSlug: string;
  recipientEmail: string;
  recipientName: string | null;
  proposalTitle: string | null;
  reminderNumber: number;
  dueAt: string | null;
  subject: string;
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
  const candidates = [invite.expires_at, attendeeRegistrationClosesAt(invite)].filter((v): v is string => Boolean(v));

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

/** Runs D1 statements in chunks of 500 to respect batch limits. */
async function batchStatements(db: DatabaseLike, stmts: StatementLike[]): Promise<void> {
  if (stmts.length === 0) return;
  const MAX = 500;
  for (let i = 0; i < stmts.length; i += MAX) {
    await db.batch(stmts.slice(i, i + MAX));
  }
}

/**
 * Batch version of buildProposalInviteEmailContext. Fetches all required
 * data for multiple proposals in 3 queries instead of 3×N.
 */
async function bulkBuildProposalInviteEmailContexts(
  db: DatabaseLike,
  proposalIds: string[],
): Promise<Map<string, ProposalInviteEmailContext>> {
  if (proposalIds.length === 0) return new Map();

  const proposalIdsJson = JSON.stringify(proposalIds);

  const proposals = await all<{ id: string; title: string; abstract: string; proposer_user_id: string }>(
    db,
    `SELECT id, title, abstract, proposer_user_id FROM session_proposals
     WHERE id IN (SELECT value FROM json_each(?))`,
    [proposalIdsJson],
  );

  const proposerUserIds = [...new Set(proposals.map((p) => p.proposer_user_id).filter(Boolean))];
  type UserRow = {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
  };
  type SpeakerRow = {
    proposal_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
  };

  const [proposerUsers, speakerRows] = await Promise.all([
    proposerUserIds.length > 0
      ? all<UserRow>(
          db,
          `SELECT id, email, first_name, last_name, organization_name FROM users
           WHERE id IN (SELECT value FROM json_each(?))`,
          [JSON.stringify(proposerUserIds)],
        )
      : ([] as UserRow[]),
    all<SpeakerRow>(
      db,
      `SELECT ps.proposal_id, u.email, u.first_name, u.last_name, u.organization_name
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
       WHERE ps.proposal_id IN (SELECT value FROM json_each(?))
       ORDER BY ps.created_at ASC`,
      [proposalIdsJson],
    ),
  ]);

  const proposerById = new Map(proposerUsers.map((u) => [u.id, u]));
  const speakersByProposal = new Map<string, SpeakerRow[]>();
  for (const s of speakerRows) {
    const arr = speakersByProposal.get(s.proposal_id) ?? [];
    arr.push(s);
    speakersByProposal.set(s.proposal_id, arr);
  }

  const result = new Map<string, ProposalInviteEmailContext>();
  for (const proposal of proposals) {
    const proposer = proposerById.get(proposal.proposer_user_id);
    const speakers = speakersByProposal.get(proposal.id) ?? [];
    const speakerLineupText = speakers
      .map((s) => `- ${formatInvitePerson(s.first_name, s.last_name, s.organization_name, s.email)}`)
      .join("\n");
    result.set(proposal.id, {
      invitedByDisplay: proposer
        ? formatInvitePerson(proposer.first_name, proposer.last_name, proposer.organization_name, proposer.email)
        : "The proposer",
      proposalTitle: proposal.title,
      proposalAbstract: proposal.abstract,
      speakerLineupText,
    });
  }

  return result;
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
  speakerInviteRemindersQueued: number;
  presentationRemindersQueued: number;
  confirmationRemindersQueued: number;
  processed: number;
  preview: {
    attendeeInvites: ReminderCandidatePreview[];
    speakerInvites: ReminderCandidatePreview[];
    coSpeakerInvites: ReminderCandidatePreview[];
    presentationUploads: ReminderCandidatePreview[];
    registrationConfirmations: ReminderCandidatePreview[];
  };
}> {
  const now = nowIso();
  const cutoff = new Date(Date.now() - payload.reminderIntervalDays * 86_400_000).toISOString();

  // ── Section 1: Attendee + Speaker Invites ─────────────────────────────────

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

  const filteredInvites = dueInvites.filter((i) => i.invite_type !== "attendee" || isAttendeeInviteReminderAllowed(i));

  // Build preview candidates in memory (no DB writes)
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
    const daysToExpiry = daysUntil(deadlineForUrgency);
    const reminderNumber = Number(invite.reminder_count ?? 0) + 1;
    const subject = inviteReminderSubject(event.name, reminderNumber, daysToExpiry);
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
      subject,
    };
    if (isAttendee) attendeeInvites.push(candidate);
    else speakerInvites.push(candidate);
  }

  const inviteRemindersQueued = filteredInvites.length;

  // Batch DB operations — skipped entirely on dry-run
  if (!payload.dryRun && filteredInvites.length > 0) {
    // 1. Generate all tokens in parallel (pure crypto, no DB)
    const tokenData = await Promise.all(
      filteredInvites.map(async (invite) => {
        const token = randomToken(24);
        const hash = await sha256Hex(token);
        return { id: invite.id, token, hash };
      }),
    );
    const tokenByInviteId = new Map(tokenData.map((t) => [t.id, t.token]));

    // 2. Batch refresh all invite tokens (1 round-trip instead of N)
    await batchStatements(
      db,
      tokenData.map((t) => db.prepare("UPDATE invites SET token_hash = ? WHERE id = ?").bind(t.hash, t.id)),
    );

    // 3. Fetch all inviters in one query (1 round-trip instead of N)
    const inviteIds = filteredInvites.map((i) => i.id);
    const inviterRows = await all<InviteInviterInfo & { invite_id: string }>(
      db,
      `SELECT ii.invite_id,
              ii.inviter_user_id  AS userId,
              u.first_name        AS firstName,
              u.last_name         AS lastName,
              u.organization_name AS organizationName
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

    // 4. Build all email rows in memory
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
        ? registrationPageUrl(payload.appBaseUrl, event, { invite: token, source: "invite_reminder" })
        : proposalPageUrl(payload.appBaseUrl, event, { invite: token, source: "speaker_invite_reminder" });
      const declineUrl = inviteDeclineUrl(payload.appBaseUrl, event, token);
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
          ...buildEventEmailVariables(event, payload.appBaseUrl),
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

    // 5. Batch queue all emails (1 round-trip instead of N)
    await bulkQueueInviteEmails(db, emailRows);

    // 6. Batch update all reminder states (1 round-trip instead of N)
    await batchStatements(
      db,
      filteredInvites.map((invite) =>
        db
          .prepare(
            "UPDATE invites SET reminder_count = reminder_count + 1, last_communication_at = ?, reminders_paused_until = NULL WHERE id = ?",
          )
          .bind(now, invite.id),
      ),
    );
  }

  // ── Section 2: Co-speaker Invites ─────────────────────────────────────────

  const remainingAfterInvites = Math.max(0, payload.limit - inviteRemindersQueued);

  const dueSpeakerInvites =
    remainingAfterInvites > 0
      ? await all<DueSpeakerInviteRow>(
          db,
          `SELECT
         ps.id                     AS speaker_id,
         ps.proposal_id            AS proposal_id,
         ps.user_id                AS user_id,
         ps.role                   AS role,
         ps.status                 AS speaker_status,
         u.email                   AS email,
         u.first_name              AS first_name,
         u.last_name               AS last_name,
         sp.title                  AS proposal_title,
         pu.first_name             AS proposer_first_name,
         sp.event_id               AS event_id,
         e.name                    AS event_name,
         e.slug                    AS event_slug,
         e.base_path               AS event_base_path,
         e.starts_at               AS event_starts_at,
         e.settings_json           AS event_settings_json,
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
          [now, payload.maxInviteReminders, now, cutoff, remainingAfterInvites],
        )
      : [];

  // Batch-fetch proposal contexts — needed even for dry-run preview
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
    const subject = `Reminder: please confirm speaker participation — ${event.name}`;
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
      subject,
    });
  }

  const speakerInviteRemindersQueued = dueSpeakerInvites.length;

  if (!payload.dryRun && dueSpeakerInvites.length > 0) {
    // 1. Generate all manage tokens in parallel
    const tokenData = await Promise.all(
      dueSpeakerInvites.map(async (row) => {
        const token = randomToken(24);
        const hash = await sha256Hex(token);
        return { proposalId: row.proposal_id, userId: row.user_id, speakerId: row.speaker_id, token, hash };
      }),
    );
    const speakerTokenKey = (proposalId: string, userId: string) => `${proposalId}:${userId}`;
    const speakerTokenByKey = new Map(tokenData.map((t) => [speakerTokenKey(t.proposalId, t.userId), t.token]));

    // 2. Batch refresh all manage tokens (1 round-trip instead of N)
    await batchStatements(
      db,
      tokenData.map((t) =>
        db
          .prepare("UPDATE proposal_speakers SET manage_token_hash = ? WHERE proposal_id = ? AND user_id = ?")
          .bind(t.hash, t.proposalId, t.userId),
      ),
    );

    // 3. Build email rows in memory
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
      const manageUrl = speakerManagePageUrl(payload.appBaseUrl, event, manageToken);
      const ctx = proposalContexts.get(row.proposal_id);
      return {
        eventId: row.event_id,
        recipientEmail: row.email,
        recipientUserId: row.user_id,
        templateKey: "co_speaker_invite",
        subject,
        data: {
          ...buildEventEmailVariables(event, payload.appBaseUrl),
          firstName: row.first_name ?? "",
          lastName: row.last_name ?? "",
          proposerFirstName: row.proposer_first_name ?? "",
          invitedByDisplay: ctx?.invitedByDisplay ?? "",
          proposalTitle: ctx?.proposalTitle ?? "",
          proposalAbstract: ctx?.proposalAbstract ?? "",
          speakerLineupText: ctx?.speakerLineupText ?? "",
          manageUrl,
          isReminder: true,
          reminderCount: String(reminderNumber),
        },
      };
    });

    // 4. Batch queue all emails (1 round-trip instead of N)
    await bulkQueueInviteEmails(db, emailRows);

    // 5. Batch update all speaker invite states (1 round-trip instead of N)
    await batchStatements(
      db,
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
    );
  }

  // ── Section 3: Presentation Reminders ─────────────────────────────────────

  const remainingLimit = Math.max(0, payload.limit - inviteRemindersQueued - speakerInviteRemindersQueued);

  const duePresentation =
    remainingLimit > 0
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

  const presentationUploads: ReminderCandidatePreview[] = [];
  for (const row of duePresentation) {
    const event: EventRouteRow = {
      id: row.event_id,
      name: row.event_name,
      slug: row.event_slug,
      base_path: row.event_base_path,
      starts_at: row.event_starts_at,
      settings_json: row.event_settings_json,
    };
    const daysToDeadline = daysUntil(row.presentation_deadline);
    const reminderNumber = Number(row.reminder_count ?? 0) + 1;
    const subject = presentationReminderSubject(event.name, reminderNumber, daysToDeadline);
    presentationUploads.push({
      category: "presentation_upload_request",
      templateKey: "presentation_upload_request",
      eventName: event.name,
      eventSlug: event.slug,
      recipientEmail: row.email,
      recipientName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
      proposalTitle: row.proposal_title,
      reminderNumber,
      dueAt: row.presentation_deadline,
      subject,
    });
  }

  const presentationRemindersQueued = duePresentation.length;

  if (!payload.dryRun && duePresentation.length > 0) {
    // 1. Generate all manage tokens in parallel
    const tokenData = await Promise.all(
      duePresentation.map(async (row) => {
        const token = randomToken(24);
        const hash = await sha256Hex(token);
        return { proposalId: row.proposal_id, userId: row.user_id, speakerId: row.speaker_id, token, hash };
      }),
    );
    const presTokenKey = (proposalId: string, userId: string) => `${proposalId}:${userId}`;
    const presTokenByKey = new Map(tokenData.map((t) => [presTokenKey(t.proposalId, t.userId), t.token]));

    // 2. Batch refresh all manage tokens (1 round-trip instead of N)
    await batchStatements(
      db,
      tokenData.map((t) =>
        db
          .prepare("UPDATE proposal_speakers SET manage_token_hash = ? WHERE proposal_id = ? AND user_id = ?")
          .bind(t.hash, t.proposalId, t.userId),
      ),
    );

    // 3. Build email rows in memory
    const emailRows = duePresentation.map((row) => {
      const event: EventRouteRow = {
        id: row.event_id,
        name: row.event_name,
        slug: row.event_slug,
        base_path: row.event_base_path,
        starts_at: row.event_starts_at,
        settings_json: row.event_settings_json,
      };
      const daysToDeadline = daysUntil(row.presentation_deadline);
      const reminderNumber = Number(row.reminder_count ?? 0) + 1;
      const subject = presentationReminderSubject(event.name, reminderNumber, daysToDeadline);
      const uploadUrl = speakerManagePageUrl(
        payload.appBaseUrl,
        event,
        presTokenByKey.get(presTokenKey(row.proposal_id, row.user_id))!,
      );
      return {
        eventId: row.event_id,
        recipientEmail: row.email,
        recipientUserId: row.user_id,
        templateKey: "presentation_upload_request",
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
      };
    });

    // 4. Batch queue all emails (1 round-trip instead of N)
    await bulkQueueInviteEmails(db, emailRows);

    // 5. Batch update all presentation reminder states (1 round-trip instead of N)
    await batchStatements(
      db,
      duePresentation.map((row) =>
        db
          .prepare(
            `UPDATE proposal_speakers
             SET presentation_reminder_count = presentation_reminder_count + 1,
                 presentation_last_communication_at = ?,
                 presentation_reminders_paused_until = NULL
             WHERE id = ?`,
          )
          .bind(now, row.speaker_id),
      ),
    );
  }

  // ── Section 4: Registration Confirmation Reminders ─────────────────────────

  const remainingLimitForConfirmations =
    payload.limit - inviteRemindersQueued - speakerInviteRemindersQueued - presentationRemindersQueued;
  const dueConfirmations =
    remainingLimitForConfirmations > 0
      ? await all<ConfirmationReminderRow>(
          db,
          `SELECT
           r.id,
           r.event_id,
           u.id AS user_id,
           u.first_name,
           u.last_name,
           u.email,
           r.confirmation_token_hash,
           r.confirmation_token_expires_at,
           e.name       AS event_name,
           e.slug       AS event_slug,
           e.base_path  AS event_base_path,
           e.starts_at  AS event_starts_at,
           e.settings_json AS event_settings_json
         FROM registrations r
         JOIN events e ON e.id = r.event_id
         JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending_email_confirmation'
           AND r.confirmation_reminder_sent_at IS NULL
           AND r.confirmation_token_expires_at IS NOT NULL
           AND r.confirmation_token_expires_at > ?
           AND datetime(r.confirmation_token_expires_at, '-1 day') <= ?
         ORDER BY r.created_at ASC
         LIMIT ?`,
          [now, now, remainingLimitForConfirmations],
        )
      : [];

  const registrationConfirmations: ReminderCandidatePreview[] = [];
  for (const row of dueConfirmations) {
    const event: EventRouteRow = {
      id: row.event_id,
      name: row.event_name,
      slug: row.event_slug,
      base_path: row.event_base_path,
      starts_at: row.event_starts_at,
      settings_json: row.event_settings_json,
    };
    registrationConfirmations.push({
      category: "registration_confirmation",
      templateKey: "registration_confirmation_reminder",
      eventName: event.name,
      eventSlug: event.slug,
      recipientEmail: row.email,
      recipientName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
      proposalTitle: null,
      reminderNumber: 1,
      dueAt: row.confirmation_token_expires_at,
      subject: `Reminder: please confirm your registration for ${event.name}`,
    });
  }

  const confirmationRemindersQueued = dueConfirmations.length;

  if (!payload.dryRun && dueConfirmations.length > 0) {
    // 1. Generate all new tokens in parallel (pure crypto, no DB)
    const tokenData = await Promise.all(
      dueConfirmations.map(async (row) => {
        const newToken = randomToken(24);
        const newTokenHash = await sha256Hex(newToken);
        const newExpiresAt = addHours(now, 48);
        return { id: row.id, userId: row.user_id, token: newToken, hash: newTokenHash, expiresAt: newExpiresAt, row };
      }),
    );

    // 2. Build email rows in memory
    const emailRows = tokenData.map(({ token, row }) => {
      const event: EventRouteRow = {
        id: row.event_id,
        name: row.event_name,
        slug: row.event_slug,
        base_path: row.event_base_path,
        starts_at: row.event_starts_at,
        settings_json: row.event_settings_json,
      };
      const subject = `Reminder: please confirm your registration for ${event.name}`;
      return {
        eventId: event.id,
        recipientEmail: row.email,
        recipientUserId: row.user_id,
        templateKey: "registration_confirmation_reminder",
        subject,
        data: {
          ...buildEventEmailVariables(event, payload.appBaseUrl),
          firstName: row.first_name ?? "",
          confirmationUrl: registrationConfirmPageUrl(payload.appBaseUrl, event, token),
          manageUrl: `${payload.appBaseUrl}/events/${event.slug}/manage`,
          timeToExpire: "48 hours",
          __subjectOverride: subject,
        },
      };
    });

    // 3. Batch queue all emails (1 round-trip instead of N)
    await bulkQueueInviteEmails(db, emailRows);

    // 4. Batch update all registration states (1 round-trip instead of N)
    await batchStatements(
      db,
      tokenData.map((t) =>
        db
          .prepare(
            `UPDATE registrations
             SET confirmation_reminder_sent_at = ?,
                 confirmation_token_hash = ?,
                 confirmation_token_expires_at = ?
             WHERE id = ?`,
          )
          .bind(now, t.hash, t.expiresAt, t.id),
      ),
    );
  }

  return {
    inviteRemindersQueued,
    speakerInviteRemindersQueued,
    presentationRemindersQueued,
    confirmationRemindersQueued,
    processed:
      inviteRemindersQueued + speakerInviteRemindersQueued + presentationRemindersQueued + confirmationRemindersQueued,
    preview: {
      attendeeInvites,
      speakerInvites,
      coSpeakerInvites,
      presentationUploads,
      registrationConfirmations,
    },
  };
}
