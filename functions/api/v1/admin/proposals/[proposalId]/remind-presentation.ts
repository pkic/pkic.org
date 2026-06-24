/**
 * POST /api/v1/admin/proposals/:proposalId/remind-presentation
 *
 * Sends a presentation upload reminder to all confirmed speakers on the
 * proposal. Only valid for accepted proposals with requires_presentation set.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { refreshSpeakerManageToken } from "../../../../../_lib/services/proposals";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { queueEmail } from "../../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { speakerPresentationPageUrl } from "../../../../../_lib/services/frontend-links";
import { buildEventEmailVariables } from "../../../../../_lib/services/events";
import { first, all } from "../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{ id: string; title: string; event_id: string; decision_status?: string }>(
    requestDb(c),
    `SELECT sp.id, sp.title, sp.event_id, pd.final_status AS decision_status
     FROM session_proposals sp
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [proposalId],
  );
  if (!proposal) return json({ error: { message: "Proposal not found" } }, 404);

  if (proposal.decision_status !== "accepted") {
    return json(
      { error: { code: "PROPOSAL_NOT_ACCEPTED", message: "Presentation reminders can only be sent for accepted proposals" } },
      409,
    );
  }

  const event = await first<any>(requestDb(c), "SELECT * FROM events WHERE id = ?", [proposal.event_id]);
  if (!event) return json({ error: { message: "Event not found" } }, 404);

  const speakers = await all<any>(
    requestDb(c),
    `SELECT ps.id AS proposal_speaker_id, ps.user_id, u.email, u.first_name,
            sp.presentation_r2_key
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     JOIN session_proposals sp ON sp.id = ps.proposal_id
     WHERE ps.proposal_id = ? AND ps.status = 'confirmed'`,
    [proposalId],
  );

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  let queued = 0;

  for (const speaker of speakers) {
    const freshToken = await refreshSpeakerManageToken(requestDb(c), proposalId, speaker.user_id);
    const uploadUrl = speakerPresentationPageUrl(appBaseUrl, event, freshToken);

    await queueEmail(requestDb(c), {
      eventId: event.id,
      templateKey: "presentation_upload_request",
      recipientEmail: speaker.email,
      recipientUserId: speaker.user_id,
      subject: `Action required: upload your presentation — ${event.name}`,
      messageType: "transactional",
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: speaker.first_name ?? "",
        proposalTitle: proposal.title,
        uploadUrl,
        hasPresentation: speaker.presentation_r2_key ? "true" : "",
      },
    });

    await writeAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "presentation_upload_request_sent",
      "proposal_speaker",
      speaker.proposal_speaker_id,
      { proposalId, speakerUserId: speaker.user_id, recipientEmail: speaker.email, bulk: true },
    );

    queued++;
  }

  return json({ success: true, queued });
}
