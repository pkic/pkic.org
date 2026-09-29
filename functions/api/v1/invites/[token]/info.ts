import { dispatchRequestMethod, json } from "../../../../_lib/http";
import { getInviteInviterSummary } from "../../../../_lib/services/invites";
import { proposalPageUrl, registrationPageUrl } from "../../../../_lib/services/frontend-links";
import { loadPublicInviteView } from "../../../../_lib/routes/public-invite-view";
import { inviteCapabilityQuerySchema, inviteInfoRouteSchema } from "../../../../../assets/shared/schemas/invites";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";

/**
 * GET /api/v1/invites/:token/info
 *
 * Returns invite metadata together with the full list of inviters so the
 * registration / proposal landing page can display social-proof copy such as:
 *
 *   "You have been personally invited by Paul van Brouwershaven, Sven Rajala,
 *    Chris Bailey and 4 others."
 *
 * Only first/last names are returned – no email addresses or internal IDs.
 */
async function getInviteInfo(c: AdminContext, token: string, inviteId?: string): Promise<Response> {
  const resolved = await loadPublicInviteView(c, token, inviteId);
  if (resolved instanceof Response) return resolved;
  const { invite, event, appBaseUrl } = resolved;

  // Valid invite — build URLs and social-proof inviter list.
  const registrationUrl =
    invite.invite_type === "attendee"
      ? registrationPageUrl(appBaseUrl, event, { invite: token, inviteId: invite.id, source: "invite" })
      : null;
  const proposalUrl =
    invite.invite_type === "speaker"
      ? proposalPageUrl(appBaseUrl, event, {
          invite: token,
          inviteId: invite.id,
          source: "speaker_invite",
        })
      : null;

  // Fetch all named inviters for social proof.  Only expose first/last name.
  const inviterSummary = await getInviteInviterSummary(c.env.DB, invite.id);
  const inviters = inviterSummary.inviters.map((i) => ({
    firstName: i.firstName,
    lastName: i.lastName,
    organizationName: i.organizationName,
  }));

  return json({
    ...resolved.summary,
    registrationUrl,
    proposalUrl,
    inviters,
    totalInviters: inviterSummary.total,
  });
}

export const InviteInfoGet = openApiRoute(inviteInfoRouteSchema, (c: AdminContext, data) =>
  getInviteInfo(c, data.params.token, data.query.id),
);

/** Compatibility export for direct endpoint tests. */
export async function onRequestGet(c: AdminContext): Promise<Response> {
  const query = inviteCapabilityQuerySchema.parse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  return getInviteInfo(c, c.req.param("token"), query.id);
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
