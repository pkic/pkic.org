import { parseJsonBody } from "../../../../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { bulkCreateAttendeesAdmin } from "../../../../../../../_lib/services/invites";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { registrationPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import {
  computeAdminInviteDigest,
  requireValidAdminInvitePreview,
} from "../../../../../../../_lib/services/admin-invite-preview";
import {
  adminBulkAttendeeInvitesSchema,
  adminBulkInviteResponseSchema,
} from "../../../../../../../../assets/shared/schemas/admin-events";
import { adminBulkAttendeeInvitesRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import type { ValidatedData } from "chanfana";

// Outcome buckets returned to the admin UI.
type BulkItemResult = { email: string };

export async function onRequestPost(
  c: AdminContext,
  data?: ValidatedData<typeof adminBulkAttendeeInvitesRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = data?.body ?? (await parseJsonBody(c.req, adminBulkAttendeeInvitesSchema));
  const eventSlug = data?.params.eventSlug ?? c.req.param("eventSlug");
  const event = await getEventBySlug(requestDb(c), eventSlug);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const secret = requireInternalSecret(c.env);

  // When sending a large list in chunks the frontend supplies the digest of the
  // full invite list (matching what was committed at preview time).  For single-
  // batch sends the digest is computed directly from the current invites.
  const inviteDigest = body.inviteDigest ?? (await computeAdminInviteDigest(body.invites));
  await requireValidAdminInvitePreview({
    secret,
    token: body.previewToken,
    eventId: event.id,
    adminId: admin.id,
    inviteType: "attendee",
    inviteDigest,
  });

  const sharedEmailVars = buildEventEmailVariables(event, appBaseUrl);

  // Invite creation and its durable email intent commit as one aggregate.
  const outcomes = await bulkCreateAttendeesAdmin(requestDb(c), {
    event,
    invites: body.invites.map((i) => ({
      inviteeEmail: i.email,
      inviteeFirstName: i.firstName ?? null,
      inviteeLastName: i.lastName ?? null,
      sourceType: i.sourceType,
    })),
    buildEmailRow: ({ email, inviteId, token }) => {
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
        data: {
          ...sharedEmailVars,
          registrationUrl,
          declineUrl,
        },
      };
    },
  });

  const created: BulkItemResult[] = outcomes.filter((o) => o.status === "created").map((o) => ({ email: o.email }));
  const endorsed: BulkItemResult[] = outcomes.filter((o) => o.status === "endorsed").map((o) => ({ email: o.email }));
  const skipped: BulkItemResult[] = outcomes.filter((o) => o.status === "skipped").map((o) => ({ email: o.email }));

  return json(adminBulkInviteResponseSchema.parse({ success: true, created, endorsed, skipped }));
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
