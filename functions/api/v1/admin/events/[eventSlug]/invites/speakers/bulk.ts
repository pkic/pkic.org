import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { bulkCreateSpeakersAdmin } from "../../../../../../../_lib/services/invites";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { bulkQueueInviteEmails } from "../../../../../../../_lib/email/outbox";
import { proposalPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { adminBulkSpeakerInvitesSchema } from "../../../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminBulkSpeakerInvitesSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const outcomes = await bulkCreateSpeakersAdmin(requestDb(c), {
    event,
    invites: body.invites.map((item) => ({
      inviteeEmail: item.email,
      inviteeFirstName: item.firstName,
      inviteeLastName: item.lastName,
      sourceType: item.sourceType,
    })),
  });

  const created: Array<{ email: string; inviteToken: string }> = [];
  const endorsed: Array<{ email: string }> = [];
  const skipped: Array<{ email: string }> = [];
  const emailRows: Array<{
    eventId: string;
    recipientEmail: string;
    templateKey: string;
    subject: string;
    data: Record<string, unknown>;
  }> = [];

  const sharedEmailVars = buildEventEmailVariables(event, appBaseUrl);
  const subject = `Speaker invitation: ${event.name}`;

  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    const item = body.invites[i];

    if (o.status === "created") {
      created.push({ email: o.email, inviteToken: o.token! });
      const proposalUrl = proposalPageUrl(appBaseUrl, event, {
        invite: o.token!,
        source: "speaker_invite",
      });
      const declineUrl = inviteDeclineUrl(appBaseUrl, event, o.token!);
      emailRows.push({
        eventId: event.id,
        recipientEmail: o.email,
        templateKey: "speaker_invite",
        subject,
        data: {
          ...sharedEmailVars,
          firstName: item.firstName ?? "",
          lastName: item.lastName ?? "",
          proposalUrl,
          declineUrl,
        },
      });
    } else if (o.status === "endorsed") {
      endorsed.push({ email: o.email });
    } else {
      skipped.push({ email: o.email });
    }
  }

  if (emailRows.length > 0) {
    await bulkQueueInviteEmails(requestDb(c), emailRows);
  }

  return json({ success: true, created, endorsed, skipped });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}
