import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { refreshSpeakerManageToken } from "../../../../../../../_lib/services/proposals";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { queueEmail } from "../../../../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { speakerPresentationPageUrl } from "../../../../../../../_lib/services/frontend-links";
import { buildEventEmailVariables } from "../../../../../../../_lib/services/events";
import { first } from "../../../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");
  const userId = c.req.param("userId");

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
      {
        error: {
          code: "PROPOSAL_NOT_ACCEPTED",
          message: "Presentation reminders can only be sent for accepted proposals",
        },
      },
      409,
    );
  }

  const event = await first<any>(requestDb(c), "SELECT * FROM events WHERE id = ?", [proposal.event_id]);
  if (!event) return json({ error: { message: "Event not found" } }, 404);

  const speaker = await first<any>(
    requestDb(c),
    `SELECT
       ps.id AS proposal_speaker_id,
       u.*,
       pv.id AS pv_id
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     LEFT JOIN presentation_versions pv ON pv.proposal_id = ps.proposal_id AND pv.is_current = 1 AND pv.deleted_at IS NULL
     WHERE ps.proposal_id = ? AND ps.user_id = ?`,
    [proposalId, userId],
  );
  if (!speaker) return json({ error: { message: "Speaker not found on this proposal" } }, 404);

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const freshToken = await refreshSpeakerManageToken(requestDb(c), proposalId, userId);
  const uploadUrl = speakerPresentationPageUrl(appBaseUrl, event, freshToken);

  await queueEmail(requestDb(c), {
    eventId: event.id,
    templateKey: "presentation_upload_request",
    recipientEmail: speaker.email,
    recipientUserId: speaker.id,
    subject: `Action required: upload your presentation — ${event.name}`,
    messageType: "transactional",
    data: {
      ...buildEventEmailVariables(event, appBaseUrl),
      firstName: speaker.first_name ?? "",
      proposalTitle: proposal.title,
      uploadUrl,
      hasPresentation: speaker.pv_id ? "true" : "",
    },
  });

  await writeAuditLog(
    requestDb(c),
    "admin",
    admin.id,
    "presentation_upload_request_sent",
    "proposal_speaker",
    speaker.proposal_speaker_id,
    {
      proposalId,
      speakerUserId: userId,
      recipientEmail: speaker.email,
      templateKey: "presentation_upload_request",
    },
  );

  return json({ success: true });
}
