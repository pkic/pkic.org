import { json } from "../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { proposalPageUrl, registrationPageUrl } from "../../../../_lib/services/frontend-links";
import { resolvePublicInvite } from "../../../../_lib/services/invite-public-info";
import { requireInternalSecret } from "../../../../_lib/request";
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
  c.set?.("sensitive", true);
  const resolved = await resolvePublicInvite(c.env.DB, requireInternalSecret(c.env), token, inviteId);
  if (resolved.status !== "valid") return json({ status: resolved.status });
  const { invite, event } = resolved;

  // Valid invite — fetch event details to build the registration URL
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const registrationUrl =
    invite.invite_type === "attendee"
      ? registrationPageUrl(appBaseUrl, event, { source: "decline-virtual-pivot" })
      : null;
  const proposalUrl =
    invite.invite_type === "speaker"
      ? proposalPageUrl(appBaseUrl, event, { source: "speaker_invite_decline_reconsider" })
      : null;

  return json({
    status: "valid",
    eventName: event.name,
    inviteeFirstName: invite.invitee_first_name ?? null,
    inviteType: invite.invite_type,
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
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
