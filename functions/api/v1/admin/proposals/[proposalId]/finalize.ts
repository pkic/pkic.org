import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { finalizeProposalDecision } from "../../../../../_lib/services/proposals";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { processOutboxByIdBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { first, run } from "../../../../../_lib/db/queries";
import { proposalManagePageUrl, speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { finalizeProposalSchema } from "../../../../../../assets/shared/schemas/api";
import { buildProposalDecisionEmailPlan } from "./decision-emails";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const accessCheckProposal = await first<{ event_id: string }>(
    requestDb(c),
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!accessCheckProposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), accessCheckProposal.event_id, admin);
  if (!access.canFinalize) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to finalize proposals" } }, 403);
  }

  const body = await parseJsonBody(c.req, finalizeProposalSchema);
  const config = getConfig(c.env, c.req.raw);
  const previousDecision = await first<{ final_status: string | null; decision_note: string | null }>(
    requestDb(c),
    `SELECT final_status, decision_note
     FROM proposal_decisions
     WHERE proposal_id = ?
     ORDER BY decided_at DESC
     LIMIT 1`,
    [proposalId],
  );

  const minReviewsRequired = config.minProposalReviews;

  const finalized = await finalizeProposalDecision(requestDb(c), {
    proposalId,
    decidedByUserId: admin.id,
    finalStatus: body.finalStatus,
    decisionNote: body.decisionNote,
    minReviewsRequired,
  });

  // Store the presentation deadline on the proposal when accepting.
  if (body.finalStatus === "accepted" && body.presentationDeadline) {
    await run(
      requestDb(c),
      "UPDATE session_proposals SET presentation_deadline = ?, updated_at = datetime('now') WHERE id = ?",
      [body.presentationDeadline, proposalId],
    );
  }

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const plan = await buildProposalDecisionEmailPlan(
    requestDb(c),
    {
      proposalId,
      finalStatus: body.finalStatus,
      decisionNote: body.decisionNote,
      presentationDeadline: body.presentationDeadline,
    },
    {
      appBaseUrl,
      resolveSpeakerManageUrl: async (speaker, event) =>
        speakerManagePageUrl(appBaseUrl, event, speaker.manage_token_hash ?? ""),
      resolveProposalManageUrl: async (event, proposalManageToken) =>
        proposalManagePageUrl(appBaseUrl, event, proposalManageToken),
    },
  );

  for (const message of plan.messages) {
    const outboxId = await queueEmail(requestDb(c), {
      eventId: plan.proposal.event_id,
      templateKey: message.templateKey,
      recipientEmail: message.recipientEmail,
      recipientUserId: message.recipientUserId,
      subject: message.fallbackSubject,
      messageType: "transactional",
      data: message.data,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outboxId));

    await writeAuditLog(requestDb(c), "admin", admin.id, "proposal_decision_email_queued", "proposal", proposalId, {
      templateKey: { from: null, to: message.templateKey },
      recipientEmail: { from: null, to: message.recipientEmail },
      recipientUserId: { from: null, to: message.recipientUserId },
    });
  }

  for (const userId of plan.presentationReminderUserIds) {
    await run(
      requestDb(c),
      `UPDATE proposal_speakers
       SET presentation_last_communication_at = ?,
           presentation_reminders_paused_until = NULL
       WHERE proposal_id = ? AND user_id = ?`,
      [new Date().toISOString(), proposalId, userId],
    );
  }

  await writeAuditLog(requestDb(c), "admin", admin.id, "proposal_decision_recorded", "proposal", proposalId, {
    adminEmail: { from: null, to: admin.email },
    finalStatus: { from: previousDecision?.final_status ?? null, to: body.finalStatus },
    decisionNote: { from: previousDecision?.decision_note ?? null, to: body.decisionNote ?? null },
    queuedEmailCount: { from: 0, to: plan.messages.length },
    manageLinkPolicy: { from: "rotated", to: "reused_existing" },
  });

  return json({ success: true, ...finalized, minReviewsRequired });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
