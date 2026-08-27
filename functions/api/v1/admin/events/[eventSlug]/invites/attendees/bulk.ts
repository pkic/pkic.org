import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { bulkCreateAttendeeInvites } from "../../../../../../../_lib/services/invites";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { registrationPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { requireValidEventInviteRecipientBatch } from "../../../../../../../_lib/services/admin-invite-preview";
import { eventInviteBulkResponseSchema } from "../../../../../../../../assets/shared/schemas/event-invite-bulk";
import { adminBulkAttendeeInvitesRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";
import { resolveEventInviteExpiry } from "../../../../../../../_lib/invite-validity";
import { buildEventInviteRecipientVariables } from "../../../../../../../_lib/services/event-invite-email-variables";

// Outcome buckets returned to the admin UI.
type BulkItemResult = { email: string };

export const AdminEventsEventSlugInvitesAttendeesBulkPost = openApiRoute(
  adminBulkAttendeeInvitesRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof adminBulkAttendeeInvitesRouteSchema>) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const body = data.body;
    const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const secret = requireInternalSecret(c.env);

    const expiresAt = resolveEventInviteExpiry(event, body.expiresAt);
    await requireValidEventInviteRecipientBatch({
      secret,
      token: body.previewToken,
      eventId: event.id,
      adminId: admin.id,
      inviteType: "attendee",
      invites: body.invites,
      expiresAt,
      inviteDigest: body.inviteDigest,
    });

    const sharedEmailVars = buildEventEmailVariables(event, appBaseUrl);

    // Invite creation and its durable email intent commit as one aggregate.
    const outcomes = await bulkCreateAttendeeInvites(requestDb(c), {
      event,
      expiresAt,
      invites: body.invites.map((i) => ({
        inviteeEmail: i.email,
        inviteeFirstName: i.firstName ?? null,
        inviteeLastName: i.lastName ?? null,
        sourceType: i.sourceType,
      })),
      buildEmailRow: ({ email, inviteId, token, invite, linkSecretFingerprint }) => {
        const registrationUrl = registrationPageUrl(appBaseUrl, event, {
          invite: token,
          inviteId,
          source: "invite",
        });
        const declineUrl = inviteDeclineUrl(appBaseUrl, event, token, inviteId);
        return {
          eventId: event.id,
          recipientEmail: email,
          templateKey: "attendee_invite",
          subject: `Invitation: ${event.name}`,
          capabilityLinkValues: [registrationUrl, declineUrl],
          linkSecretFingerprint,
          data: {
            ...sharedEmailVars,
            ...buildEventInviteRecipientVariables(
              { firstName: invite.inviteeFirstName, lastName: invite.inviteeLastName },
              "Attendee",
            ),
            registrationUrl,
            declineUrl,
          },
        };
      },
    });

    const created: BulkItemResult[] = outcomes.filter((o) => o.status === "created").map((o) => ({ email: o.email }));
    const endorsed: BulkItemResult[] = outcomes.filter((o) => o.status === "endorsed").map((o) => ({ email: o.email }));
    const skipped: BulkItemResult[] = outcomes.filter((o) => o.status === "skipped").map((o) => ({ email: o.email }));

    return json(eventInviteBulkResponseSchema.parse({ success: true, created, endorsed, skipped }));
  },
);
