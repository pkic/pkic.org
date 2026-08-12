/**
 * POST /api/v1/invites/resend-link
 *
 * Sends fresh links for pending or expired invitations matching the supplied
 * email. The response is generic to prevent invitation enumeration.
 */
import { OpenAPIRoute } from "chanfana";
import { all, run } from "../../../_lib/db/queries";
import { queueEmail, processOutboxByIdBackground } from "../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { json } from "../../../_lib/http";
import { getClientIp } from "../../../_lib/request";
import { enforceRateLimit } from "../../../_lib/rate-limit";
import { queuedCapabilityToken } from "../../../_lib/services/capability-links";
import { buildEventEmailVariables, getEventBySlug } from "../../../_lib/services/events";
import { inviteDeclineUrl, proposalPageUrl, registrationPageUrl } from "../../../_lib/services/frontend-links";
import { nowIso } from "../../../_lib/utils/time";
import { parseJsonBody } from "../../../_lib/validation";
import { inviteResendLinkSchema } from "../../../../assets/shared/schemas/api";
import { inviteResendLinkRouteSchema } from "../../../../assets/shared/schemas/route-contracts";

interface InviteMatch {
  id: string;
  event_slug: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: "attendee" | "speaker";
}

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);
  const body = await parseJsonBody(c.req, inviteResendLinkSchema);
  await enforceRateLimit({
    binding: c.env.EMAIL_RATE_LIMITER,
    namespace: "invite-resend-link:email",
    key: body.email,
  });
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "invite-resend-link:ip",
    key: getClientIp(c.req.raw),
  });

  const invites = await all<InviteMatch>(
    c.env.DB,
    `SELECT
       i.id,
       e.slug AS event_slug,
       i.invitee_email,
       i.invitee_first_name,
       i.invitee_last_name,
       i.invite_type
     FROM invites i
     JOIN events e ON e.id = i.event_id
     WHERE lower(i.invitee_email) = lower(?)
       AND i.status IN ('sent', 'expired')
     ORDER BY i.created_at DESC
     LIMIT 20`,
    [body.email],
  );
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  for (const invite of invites) {
    const event = await getEventBySlug(c.env.DB, invite.event_slug);
    const token = queuedCapabilityToken("invite", invite.id);
    const declineUrl = inviteDeclineUrl(appBaseUrl, event, token, invite.id);
    const actionUrl =
      invite.invite_type === "attendee"
        ? registrationPageUrl(appBaseUrl, event, { invite: token, inviteId: invite.id, source: "invite_recovery" })
        : proposalPageUrl(appBaseUrl, event, {
            invite: token,
            inviteId: invite.id,
            source: "speaker_invite_recovery",
          });
    const now = nowIso();
    await run(
      c.env.DB,
      `UPDATE invites
       SET status = 'sent', expires_at = NULL, last_communication_at = ?
       WHERE id = ? AND status IN ('sent', 'expired')`,
      [now, invite.id],
    );
    const outboxId = await queueEmail(c.env.DB, {
      eventId: event.id,
      templateKey: invite.invite_type === "attendee" ? "attendee_invite" : "speaker_invite",
      recipientEmail: invite.invitee_email,
      messageType: "transactional",
      subject: invite.invite_type === "attendee" ? `Invitation: ${event.name}` : `Speaker invitation: ${event.name}`,
      capabilityLinkValues: [actionUrl, declineUrl],
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: invite.invitee_first_name ?? "",
        lastName: invite.invitee_last_name ?? "",
        registrationUrl: invite.invite_type === "attendee" ? actionUrl : undefined,
        proposalUrl: invite.invite_type === "speaker" ? actionUrl : undefined,
        declineUrl,
        isReminder: true,
        reminderCount: "recovery",
      },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
  }

  return json({ success: true });
}

export class InvitesResendLinkPost extends OpenAPIRoute {
  schema = inviteResendLinkRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
