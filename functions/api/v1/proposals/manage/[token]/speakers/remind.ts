/**
 * POST /api/v1/proposals/manage/[token]/speakers/remind
 *
 * Proposer-only: re-sends the invitation email to a co-speaker who has not
 * yet confirmed or declined. Rotates the speaker's manage token so the fresh
 * link in the reminder is guaranteed to work.
 *
 * Body: { userId: string }
 * Auth: proposal manage token proves proposer identity.
 */
import { z } from "zod";
import { json, markSensitive } from "../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../_lib/validation";
import {
  getProposalByManageToken,
  refreshSpeakerManageToken,
  buildProposalInviteEmailContext,
} from "../../../../../../_lib/services/proposals";
import { buildEventEmailVariables } from "../../../../../../_lib/services/events";
import { queueEmail, processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { speakerManagePageUrl } from "../../../../../../_lib/services/frontend-links";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { AppError } from "../../../../../../_lib/errors";
import { first, run } from "../../../../../../_lib/db/queries";
import type { EventRecord } from "../../../../../../_lib/services/events";
import { nowIso } from "../../../../../../_lib/utils/time";

const schema = z.object({ userId: z.string().min(1) });

export async function onRequestPost(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, schema);
  const proposal = await getProposalByManageToken(c.env.DB, c.req.param("token"));

  if (proposal.status === "withdrawn" || proposal.status === "rejected") {
    return json(
      { error: { code: "PROPOSAL_CLOSED", message: "Cannot send reminders for a closed proposal" } },
      400,
    );
  }

  const event = await first<EventRecord>(
    c.env.DB,
    "SELECT * FROM events WHERE id = ?",
    [proposal.event_id],
  );
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");

  const speakerRow = await first<{
    user_id: string;
    role: string;
    status: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
  }>(
    c.env.DB,
    `SELECT ps.user_id, ps.role, ps.status, u.email, u.first_name, u.last_name
     FROM   proposal_speakers ps
     JOIN   users u ON u.id = ps.user_id
     WHERE  ps.proposal_id = ? AND ps.user_id = ?`,
    [proposal.id, body.userId],
  );

  if (!speakerRow) {
    throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  }

  if (speakerRow.status === "confirmed" || speakerRow.status === "declined") {
    return json(
      { error: { code: "ALREADY_RESPONDED", message: `Speaker has already ${speakerRow.status}` } },
      400,
    );
  }

  // Rotate the manage token — we cannot reconstruct the original from its hash.
  const appBaseUrl = resolveAppBaseUrl(c.env);
  const newToken = await refreshSpeakerManageToken(
    c.env.DB,
    proposal.id,
    speakerRow.user_id,
  );

  const speakerManageUrl = speakerManagePageUrl(appBaseUrl, event, newToken);

  const proposer = await first<{ first_name: string | null }>(
    c.env.DB,
    "SELECT first_name FROM users WHERE id = ?",
    [proposal.proposer_user_id],
  );

  const inviteContext = await buildProposalInviteEmailContext(c.env.DB, {
    proposalId: proposal.id,
    inviterUserId: proposal.proposer_user_id,
  });

  const outboxId = await queueEmail(c.env.DB, {
    eventId: event.id,
    templateKey: "co_speaker_invite",
    recipientEmail: speakerRow.email,
    recipientUserId: speakerRow.user_id,
    messageType: "transactional",
    subject: `Reminder: confirm your participation — ${event.name}`,
    data: {
      ...buildEventEmailVariables(event, appBaseUrl),
      firstName: speakerRow.first_name ?? "",
      lastName: speakerRow.last_name ?? "",
      proposerFirstName: proposer?.first_name ?? "",
      invitedByDisplay: inviteContext.invitedByDisplay,
      proposalTitle: inviteContext.proposalTitle,
      proposalAbstract: inviteContext.proposalAbstract,
      speakerLineupText: inviteContext.speakerLineupText,
      manageUrl: speakerManageUrl,
      isReminder: true,
    },
  });

  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));

  await run(
    c.env.DB,
    `UPDATE proposal_speakers
     SET speaker_invite_reminder_count = speaker_invite_reminder_count + 1,
         speaker_invite_last_communication_at = ?,
         speaker_invite_reminders_paused_until = NULL
     WHERE proposal_id = ? AND user_id = ?`,
    [nowIso(), proposal.id, speakerRow.user_id],
  );

  return json({ success: true });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
