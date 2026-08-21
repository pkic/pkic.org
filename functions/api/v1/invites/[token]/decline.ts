import { parseJsonBody } from "../../../../_lib/validation";
import { dispatchRequestMethod, json } from "../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { declineAndForwardInvite as executeInviteDecline } from "../../../../_lib/services/invite-decline";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { inviteDeclineSchema } from "../../../../../assets/shared/schemas/registration";
import {
  inviteCapabilityQuerySchema,
  inviteDeclineRedirectRouteSchema,
  inviteDeclineRouteSchema,
} from "../../../../../assets/shared/schemas/invites";
import { requireInternalSecret } from "../../../../_lib/request";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";
import type { z } from "zod";

type InviteDeclineBody = z.infer<typeof inviteDeclineSchema>;

// ── GET: Redirect to the Hugo-managed decline page ───────────────────────────
// The form UI lives at the event-specific /invite/decline/ Hugo page driven by
// assets/ts/invite-decline.ts.  This endpoint is a safety redirect for any
// old API-URL links; all new invite emails use the event-specific URL produced
// by inviteDeclineUrl(appBaseUrl, event, token).

function redirectInviteDecline(c: AdminContext, token: string, inviteId?: string): Response {
  c.set?.("sensitive", true);
  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  const url = new URL("/invite/decline/", origin);
  url.searchParams.set("token", token);
  if (inviteId) {
    url.searchParams.set("id", inviteId);
  }
  return Response.redirect(url.toString(), 302);
}

export const InviteDeclineGet = openApiRoute(inviteDeclineRedirectRouteSchema, (c: AdminContext, data) =>
  redirectInviteDecline(c, data.params.token, data.query.id),
);

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const query = inviteCapabilityQuerySchema.parse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  return redirectInviteDecline(c, c.req.param("token"), query.id);
}

// ── POST: Decline (with optional forwarding) ──────────────────────────────────

async function handleInviteDecline(
  c: AdminContext,
  token: string,
  inviteId: string | undefined,
  body: InviteDeclineBody,
): Promise<Response> {
  c.set?.("sensitive", true);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const result = await executeInviteDecline(c.env.DB, {
    token,
    inviteId,
    body,
    signingSecret: requireInternalSecret(c.env),
    appBaseUrl,
  });

  for (const outboxId of result.outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
  }

  return json({ success: true, forwarded: result.forwardedEmails });
}

export const InviteDeclinePost = openApiRoute(inviteDeclineRouteSchema, (c: AdminContext, data) =>
  handleInviteDecline(c, data.params.token, data.query.id, data.body),
);

/** Compatibility export for direct endpoint tests. */
export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, inviteDeclineSchema);
  const query = inviteCapabilityQuerySchema.parse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  return handleInviteDecline(c, c.req.param("token"), query.id, body);
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchRequestMethod(c, { GET: onRequestGet, POST: onRequestPost });
}
