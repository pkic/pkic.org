import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import {
  bulkCreateInvites,
  findInviteByToken,
  isStaleInviteTransition,
  prepareDeclineInviteStatements,
} from "../../../../_lib/services/invites";
import { buildEventEmailVariables, getEventById } from "../../../../_lib/services/events";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { proposalPageUrl, registrationPageUrl, inviteDeclineUrl } from "../../../../_lib/services/frontend-links";
import { inviteDeclineSchema } from "../../../../../assets/shared/schemas/registration";
import {
  inviteCapabilityQuerySchema,
  inviteDeclineRedirectRouteSchema,
  inviteDeclineRouteSchema,
} from "../../../../../assets/shared/schemas/invites";
import { requireInternalSecret } from "../../../../_lib/request";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { AppError } from "../../../../_lib/errors";
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

async function declineAndForwardInvite(
  c: AdminContext,
  token: string,
  inviteId: string | undefined,
  body: InviteDeclineBody,
): Promise<Response> {
  c.set?.("sensitive", true);
  const signingSecret = requireInternalSecret(c.env);
  const invite = await findInviteByToken(c.env.DB, token, signingSecret, inviteId ?? null);

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const event = await getEventById(c.env.DB, invite.event_id);

  let outcomes;
  try {
    outcomes = await bulkCreateInvites(c.env.DB, invite.invite_type, {
      event,
      invites: (body.forwards ?? []).map((contact) => ({
        inviteeEmail: contact.email,
        inviteeFirstName: contact.firstName ?? null,
        inviteeLastName: contact.lastName ?? null,
        sourceType: "declined-forward",
      })),
      additionalStatements: prepareDeclineInviteStatements(c.env.DB, invite, {
        inviteId: invite.id,
        reasonCode: body.reasonCode,
        reasonNote: body.reasonNote,
        unsubscribeFuture: body.unsubscribeFuture,
        npsScore: body.npsScore,
      }),
      buildEmailRow: ({ inviteId: newInviteId, token: forwardedToken, email, invite: contact }) => {
        const registrationUrl =
          invite.invite_type === "attendee"
            ? registrationPageUrl(appBaseUrl, event, {
                invite: forwardedToken,
                inviteId: newInviteId,
                source: "invite",
              })
            : undefined;
        const proposalUrl =
          invite.invite_type === "speaker"
            ? proposalPageUrl(appBaseUrl, event, {
                invite: forwardedToken,
                inviteId: newInviteId,
                source: "speaker_invite_forward",
              })
            : undefined;
        const declineUrl = inviteDeclineUrl(appBaseUrl, event, forwardedToken, newInviteId);
        return {
          eventId: event.id,
          templateKey: invite.invite_type === "speaker" ? "speaker_invite" : "attendee_invite",
          recipientEmail: email,
          subject: invite.invite_type === "speaker" ? `Speaker invitation: ${event.name}` : `Invitation: ${event.name}`,
          capabilityLinkValues: [registrationUrl, proposalUrl, declineUrl],
          data: {
            ...buildEventEmailVariables(event, appBaseUrl),
            firstName: contact.inviteeFirstName ?? "",
            lastName: contact.inviteeLastName ?? "",
            registrationUrl,
            proposalUrl,
            declineUrl,
          },
        };
      },
    });
  } catch (error) {
    if (!isStaleInviteTransition(error)) throw error;
    throw new AppError(409, "INVITE_CHANGED", "Invite state changed; please retry");
  }

  for (const outcome of outcomes) {
    if (outcome.outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outcome.outboxId));
  }
  const forwardedEmails = outcomes.filter((outcome) => outcome.status === "created").map((outcome) => outcome.email);

  return json({ success: true, forwarded: forwardedEmails });
}

export const InviteDeclinePost = openApiRoute(inviteDeclineRouteSchema, (c: AdminContext, data) =>
  declineAndForwardInvite(c, data.params.token, data.query.id, data.body),
);

/** Compatibility export for direct endpoint tests. */
export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, inviteDeclineSchema);
  const query = inviteCapabilityQuerySchema.parse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  return declineAndForwardInvite(c, c.req.param("token"), query.id, body);
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method === "GET") {
    return onRequestGet(c);
  }
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
