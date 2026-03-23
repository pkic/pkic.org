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
import type { PagesContext } from "../../../../../../_lib/types";
import type { EventRecord } from "../../../../../../_lib/services/events";
import { nowIso } from "../../../../../../_lib/utils/time";

const schema = z.object({ userId: z.string().min(1) });

export async function onRequestPost(context: PagesContext<{ token: string }>): Promise<Response> {
  const body = await parseJsonBody(context.request, schema);
  const proposal = await getProposalByManageToken(context.env.DB, context.params.token);

  if (proposal.status === "withdrawn" || proposal.status === "rejected") {
    return json(
      { error: { code: "PROPOSAL_CLOSED", message: "Cannot send reminders for a closed proposal" } },
      400,
    );
  }

  const event = await first<EventRecord>(
    context.env.DB,
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
    context.env.DB,
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
  const appBaseUrl = resolveAppBaseUrl(context.env);
  const newToken = await refreshSpeakerManageToken(
    context.env.DB,
    proposal.id,
    speakerRow.user_id,
  );

  const speakerManageUrl = speakerManagePageUrl(appBaseUrl, event, newToken);

  const proposer = await first<{ first_name: string | null }>(
    context.env.DB,
    "SELECT first_name FROM users WHERE id = ?",
    [proposal.proposer_user_id],
  );

  const inviteContext = await buildProposalInviteEmailContext(context.env.DB, {
    proposalId: proposal.id,
    inviterUserId: proposal.proposer_user_id,
  });

  const outboxId = await queueEmail(context.env.DB, {
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

  context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));

  await run(
    context.env.DB,
    `UPDATE proposal_speakers
     SET speaker_invite_reminder_count = speaker_invite_reminder_count + 1,
         speaker_invite_last_communication_at = ?,
         speaker_invite_reminders_paused_until = NULL
     WHERE proposal_id = ? AND user_id = ?`,
    [nowIso(), proposal.id, speakerRow.user_id],
  );

  return json({ success: true });
}

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
