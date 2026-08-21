import { parseJsonBody } from "../../../../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { bulkCreateSpeakersAdmin } from "../../../../../../../_lib/services/invites";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { proposalPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { adminBulkSpeakerInvitesSchema } from "../../../../../../../../assets/shared/schemas/admin-events";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import {
  computeAdminInviteDigest,
  requireValidAdminInvitePreview,
} from "../../../../../../../_lib/services/admin-invite-preview";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminBulkSpeakerInvitesSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const inviteDigest = body.inviteDigest ?? (await computeAdminInviteDigest(body.invites));
  await requireValidAdminInvitePreview({
    secret: requireInternalSecret(c.env),
    token: body.previewToken,
    eventId: event.id,
    adminId: admin.id,
    inviteType: "speaker",
    inviteDigest,
  });
  const sharedEmailVars = buildEventEmailVariables(event, appBaseUrl);
  const subject = `Speaker invitation: ${event.name}`;

  const outcomes = await bulkCreateSpeakersAdmin(requestDb(c), {
    event,
    invites: body.invites.map((item) => ({
      inviteeEmail: item.email,
      inviteeFirstName: item.firstName,
      inviteeLastName: item.lastName,
      sourceType: item.sourceType,
    })),
    buildEmailRow: ({ email, inviteId, token, invite }) => {
      const proposalUrl = proposalPageUrl(appBaseUrl, event, {
        invite: token,
        inviteId,
        source: "speaker_invite",
      });
      const declineUrl = inviteDeclineUrl(appBaseUrl, event, token, inviteId);
      return {
        eventId: event.id,
        recipientEmail: email,
        templateKey: "speaker_invite",
        subject,
        capabilityLinkValues: [proposalUrl, declineUrl],
        data: {
          ...sharedEmailVars,
          firstName: invite.inviteeFirstName ?? "",
          lastName: invite.inviteeLastName ?? "",
          proposalUrl,
          declineUrl,
        },
      };
    },
  });

  const created: Array<{ email: string }> = [];
  const endorsed: Array<{ email: string }> = [];
  const skipped: Array<{ email: string }> = [];
  for (const o of outcomes) {
    if (o.status === "created") {
      created.push({ email: o.email });
    } else if (o.status === "endorsed") {
      endorsed.push({ email: o.email });
    } else {
      skipped.push({ email: o.email });
    }
  }

  return json({ success: true, created, endorsed, skipped });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
