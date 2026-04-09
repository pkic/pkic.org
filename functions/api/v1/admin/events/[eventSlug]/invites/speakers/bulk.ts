import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { createInvite } from "../../../../../../../_lib/services/invites";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { queueEmail } from "../../../../../../../_lib/email/outbox";
import { proposalPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { adminBulkSpeakerInvitesSchema } from "../../../../../../../../assets/shared/schemas/api";

export async function onRequestPost(
  c: any,
): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw);
  const body = await parseJsonBody(c.req, adminBulkSpeakerInvitesSchema);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const config = getConfig(c.env, c.req.raw);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const created: Array<{ email: string; inviteToken: string }> = [];
  const endorsed: Array<{ email: string }> = [];
  const skipped: Array<{ email: string }> = [];

  for (const item of body.invites) {
    try {
      const { invite, token, isNew } = await createInvite(c.env.DB, {
        eventId: event.id,
        inviteeEmail: item.email,
        inviteeFirstName: item.firstName,
        inviteeLastName: item.lastName,
        inviteType: "speaker",
        sourceType: item.sourceType,
        ttlHours: 24 * 21,
      });

      if (isNew) {
        const proposalUrl = proposalPageUrl(appBaseUrl, event, {
          invite: token,
          source: "speaker_invite",
        });
        const declineUrl = inviteDeclineUrl(appBaseUrl, event, token);
        const outboxId = await queueEmail(c.env.DB, {
          eventId: event.id,
          templateKey: "speaker_invite",
          recipientEmail: invite.invitee_email,
          messageType: "transactional",
          subject: `Speaker invitation: ${event.name}`,
          data: {
            ...buildEventEmailVariables(event, appBaseUrl),
            firstName: item.firstName ?? "",
            lastName: item.lastName ?? "",
            proposalUrl,
            declineUrl,
          },
        });
        created.push({ email: invite.invitee_email, inviteToken: token });
      } else {
        endorsed.push({ email: invite.invitee_email });
      }
    } catch (err) {
      if (err instanceof AppError && (
        err.code === "INVITEE_ALREADY_REGISTERED"
        || err.code === "INVITEE_ALREADY_PROPOSED"
        || err.code === "INVITEE_UNSUBSCRIBED"
      )) {
        skipped.push({ email: item.email });
      } else {
        throw err;
      }
    }
  }

  return json({ success: true, created, endorsed, skipped });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}
