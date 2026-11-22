import { json } from "../../../../_lib/http";
import { findInviteByToken, acceptInvite } from "../../../../_lib/services/invites";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { proposalPageUrl } from "../../../../_lib/services/frontend-links";
import { inviteAcceptRouteSchema } from "../../../../../assets/shared/schemas/invites";
import { requireInternalSecret } from "../../../../_lib/request";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { getEventById } from "../../../../_lib/services/events";
import { requestDb } from "../../../../_lib/db/context";

async function acceptInviteRequest(c: AdminContext, token: string, inviteId: string | undefined): Promise<Response> {
  c.set?.("sensitive", true);
  const signingSecret = requireInternalSecret(c.env);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const db = requestDb(c);
  const invite = await findInviteByToken(db, token, signingSecret, inviteId ?? null);
  // An attendee accepts an invitation by registering while signed in, which consumes the invitation.
  if (invite.invite_type !== "speaker") {
    throw new AppError(400, "INVITE_INVALID", "Register for the event to accept this invitation.");
  }
  const event = await getEventById(db, invite.event_id);
  await acceptInvite(db, invite.id);
  return json({
    success: true,
    inviteType: "speaker",
    next: proposalPageUrl(appBaseUrl, event, { source: "speaker_invite_accept" }),
  });
}

export const InviteAcceptPost = openApiRoute(
  inviteAcceptRouteSchema,
  (c: AdminContext, data) => acceptInviteRequest(c, data.params.token, data.query.id),
  (c: AdminContext) => c.set?.("sensitive", true),
);
