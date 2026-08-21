import { dispatchRequestMethod, json } from "../../../../_lib/http";
import { proposalPageUrl, registrationPageUrl } from "../../../../_lib/services/frontend-links";
import { loadPublicInviteView } from "../../../../_lib/routes/public-invite-view";
import {
  inviteCapabilityQuerySchema,
  inviteDeclineInfoRouteSchema,
} from "../../../../../assets/shared/schemas/invites";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";

/**
 * GET /api/v1/invites/:token/decline-info
 *
 * Returns JSON describing the invite state so the Hugo decline page can render
 * the correct UI without ever serving raw HTML from the backend.
 */
async function getInviteDeclineInfo(c: AdminContext, token: string, inviteId?: string): Promise<Response> {
  const resolved = await loadPublicInviteView(c, token, inviteId);
  if (resolved instanceof Response) return resolved;
  const { invite, event, appBaseUrl } = resolved;

  // Valid invite — fetch event details to build the registration URL
  const registrationUrl =
    invite.invite_type === "attendee"
      ? registrationPageUrl(appBaseUrl, event, { source: "decline-virtual-pivot" })
      : null;
  const proposalUrl =
    invite.invite_type === "speaker"
      ? proposalPageUrl(appBaseUrl, event, { source: "speaker_invite_decline_reconsider" })
      : null;

  return json({
    ...resolved.summary,
    registrationUrl,
    proposalUrl,
  });
}

export const InviteDeclineInfoGet = openApiRoute(inviteDeclineInfoRouteSchema, (c: AdminContext, data) =>
  getInviteDeclineInfo(c, data.params.token, data.query.id),
);

/** Compatibility export for direct endpoint tests. */
export async function onRequestGet(c: AdminContext): Promise<Response> {
  const query = inviteCapabilityQuerySchema.parse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  return getInviteDeclineInfo(c, c.req.param("token"), query.id);
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
