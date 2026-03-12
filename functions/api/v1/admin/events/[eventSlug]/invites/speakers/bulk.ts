import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { createInvite } from "../../../../../../../_lib/services/invites";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground, queueEmail } from "../../../../../../../_lib/email/outbox";
import { proposalPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import type { PagesContext } from "../../../../../../../_lib/types";
import { adminBulkSpeakerInvitesSchema } from "../../../../../../../../shared/schemas/api";

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request);
  const body = await parseJsonBody(context.request, adminBulkSpeakerInvitesSchema);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const config = getConfig(context.env, context.request);
  const appBaseUrl = resolveAppBaseUrl(context.env, context.request);

  const created: Array<{ email: string; inviteToken: string }> = [];
  for (const item of body.invites) {
    const { invite, token } = await createInvite(context.env.DB, {
      eventId: event.id,
      inviteeEmail: item.email,
      inviteeFirstName: item.firstName,
      inviteeLastName: item.lastName,
      inviteType: "speaker",
      sourceType: item.sourceType,
      ttlHours: 24 * 21,
    });

    const proposalUrl = proposalPageUrl(appBaseUrl, event, {
      invite: token,
      source: "speaker_invite",
    });
    const declineUrl = inviteDeclineUrl(appBaseUrl, event, token);
    const outboxId = await queueEmail(context.env.DB, {
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

    context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));
    created.push({ email: invite.invitee_email, inviteToken: token });
  }

  return json({ success: true, created });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}
