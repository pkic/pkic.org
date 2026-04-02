/**
 * POST /api/v1/events/:eventSlug/proposals/resend-speaker-manage-link
 *
 * Sends a fresh speaker-management link to the provided email if it matches
 * an invited/confirmed speaker on an active proposal for this event.
 *
 * Always responds with { success: true } to prevent account enumeration.
 */
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../_lib/services/events";
import { first } from "../../../../../_lib/db/queries";
import { queueEmail, processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { buildProposalInviteEmailContext, refreshSpeakerManageToken } from "../../../../../_lib/services/proposals";
import { normalizedEmailSchema } from "../../../../../../assets/shared/schemas/api";
const schema = z.object({
  email: normalizedEmailSchema,
});

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);

  const body = await parseJsonBody(c.req, schema);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env);

  const row = await first<{
    proposal_id: string;
    user_id: string;
    proposer_user_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
  }>(
    c.env.DB,
    `SELECT
       ps.proposal_id,
       ps.user_id,
       sp.proposer_user_id,
       u.email,
       u.first_name,
       u.last_name
     FROM proposal_speakers ps
     JOIN session_proposals sp ON sp.id = ps.proposal_id
     JOIN users u ON u.id = ps.user_id
     WHERE sp.event_id = ?
       AND lower(u.email) = lower(?)
       AND ps.role <> 'proposer'
       AND ps.status IN ('invited', 'confirmed')
       AND sp.status NOT IN ('rejected', 'withdrawn')
     ORDER BY ps.created_at DESC
     LIMIT 1`,
    [event.id, body.email],
  );

  if (row) {
    const token = await refreshSpeakerManageToken(c.env.DB, row.proposal_id, row.user_id);
    const manageUrl = speakerManagePageUrl(appBaseUrl, event, token);

    const inviteContext = await buildProposalInviteEmailContext(c.env.DB, {
      proposalId: row.proposal_id,
      inviterUserId: row.proposer_user_id,
    });

    const outboxId = await queueEmail(c.env.DB, {
      eventId: event.id,
      templateKey: "co_speaker_invite",
      recipientEmail: row.email,
      recipientUserId: row.user_id,
      messageType: "transactional",
      subject: `Your speaker management link for ${event.name}`,
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: row.first_name ?? "",
        lastName: row.last_name ?? "",
        invitedByDisplay: inviteContext.invitedByDisplay,
        proposalTitle: inviteContext.proposalTitle,
        proposalAbstract: inviteContext.proposalAbstract,
        speakerLineupText: inviteContext.speakerLineupText,
        manageUrl,
        isReminder: true,
      },
    });

    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
  }

  return json({ success: true });
}

export class EventsEventSlugProposalsResendSpeakerManageLinkPost extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    return onRequestPost(c);
  }
}
