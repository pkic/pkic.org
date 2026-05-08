import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { finalizeProposalDecision, refreshSpeakerManageToken } from "../../../../../_lib/services/proposals";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { queueEmail } from "../../../../../_lib/email/outbox";
import { first, run } from "../../../../../_lib/db/queries";
import { speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { finalizeProposalSchema } from "../../../../../../assets/shared/schemas/api";
import { buildProposalDecisionEmailPlan } from "./decision-emails";

export async function onRequestPost(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const proposalId = c.req.param("proposalId");

  const accessCheckProposal = await first<{ event_id: string }>(
    c.env.DB,
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!accessCheckProposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(c.env.DB, accessCheckProposal.event_id, admin);
  if (!access.canFinalize) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to finalize proposals" } }, 403);
  }

  const body = await parseJsonBody(c.req, finalizeProposalSchema);
  const config = getConfig(c.env, c.req.raw);

  const minReviewsRequired = config.minProposalReviews;

  const finalized = await finalizeProposalDecision(c.env.DB, {
    proposalId,
    decidedByUserId: admin.id,
    finalStatus: body.finalStatus,
    decisionNote: body.decisionNote,
    minReviewsRequired,
  });

  // Store the presentation deadline on the proposal when accepting.
  if (body.finalStatus === "accepted" && body.presentationDeadline) {
    await run(
      c.env.DB,
      "UPDATE session_proposals SET presentation_deadline = ?, updated_at = datetime('now') WHERE id = ?",
      [body.presentationDeadline, proposalId],
    );
  }

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const plan = await buildProposalDecisionEmailPlan(
    c.env.DB,
    {
      proposalId,
      finalStatus: body.finalStatus,
      decisionNote: body.decisionNote,
      presentationDeadline: body.presentationDeadline,
    },
    {
      appBaseUrl,
      resolveSpeakerManageUrl: async (speaker, event) => {
        const freshToken = await refreshSpeakerManageToken(c.env.DB, proposalId, speaker.user_id);
        return speakerManagePageUrl(appBaseUrl, event, freshToken);
      },
    },
  );

  for (const message of plan.messages) {
    await queueEmail(c.env.DB, {
      eventId: plan.proposal.event_id,
      templateKey: message.templateKey,
      recipientEmail: message.recipientEmail,
      recipientUserId: message.recipientUserId,
      subject: message.fallbackSubject,
      messageType: "transactional",
      data: message.data,
    });
  }

  for (const userId of plan.presentationReminderUserIds) {
    await run(
      c.env.DB,
      `UPDATE proposal_speakers
       SET presentation_last_communication_at = ?,
           presentation_reminders_paused_until = NULL
       WHERE proposal_id = ? AND user_id = ?`,
      [new Date().toISOString(), proposalId, userId],
    );
  }

  await writeAuditLog(c.env.DB, "admin", admin.id, "proposal_decision_recorded", "proposal", proposalId, {
    adminEmail: admin.email,
    finalStatus: body.finalStatus,
    decisionNote: body.decisionNote ?? null,
  });

  return json({ success: true, ...finalized, minReviewsRequired });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
