import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { bulkCreateSpeakerInvites } from "../../../../../../../_lib/services/invites";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { proposalPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { adminBulkInviteResponseSchema } from "../../../../../../../../assets/shared/schemas/admin-events";
import { adminBulkSpeakerInvitesRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { requireValidEventInviteRecipientBatch } from "../../../../../../../_lib/services/admin-invite-preview";
import { resolveEventInviteExpiry } from "../../../../../../../_lib/invite-validity";
import { buildEventInviteRecipientVariables } from "../../../../../../../_lib/services/event-invite-email-variables";

export const AdminEventsEventSlugInvitesSpeakersBulkPost = openApiRoute(
  adminBulkSpeakerInvitesRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof adminBulkSpeakerInvitesRouteSchema>) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const body = data.body;
    const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const expiresAt = resolveEventInviteExpiry(event, body.expiresAt);
    await requireValidEventInviteRecipientBatch({
      secret: requireInternalSecret(c.env),
      token: body.previewToken,
      eventId: event.id,
      adminId: admin.id,
      inviteType: "speaker",
      invites: body.invites,
      expiresAt,
      inviteDigest: body.inviteDigest,
    });
    const sharedEmailVars = buildEventEmailVariables(event, appBaseUrl);
    const subject = `Speaker invitation: ${event.name}`;

    const outcomes = await bulkCreateSpeakerInvites(requestDb(c), {
      event,
      expiresAt,
      invites: body.invites.map((item) => ({
        inviteeEmail: item.email,
        inviteeFirstName: item.firstName,
        inviteeLastName: item.lastName,
        sourceType: item.sourceType,
      })),
      buildEmailRow: ({ email, inviteId, token, invite, linkSecretFingerprint }) => {
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
          linkSecretFingerprint,
          data: {
            ...sharedEmailVars,
            ...buildEventInviteRecipientVariables(
              { firstName: invite.inviteeFirstName, lastName: invite.inviteeLastName },
              "Speaker",
            ),
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

    return json(adminBulkInviteResponseSchema.parse({ success: true, created, endorsed, skipped }));
  },
);
