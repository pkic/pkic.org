import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { declineInvite, findInviteByToken, createInvite } from "../../../../_lib/services/invites";
import { buildEventEmailVariables } from "../../../../_lib/services/events";
import { first } from "../../../../_lib/db/queries";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { proposalPageUrl, registrationPageUrl, inviteDeclineUrl } from "../../../../_lib/services/frontend-links";
import { inviteDeclineSchema } from "../../../../../assets/shared/schemas/api";

// ── GET: Redirect to the Hugo-managed decline page ───────────────────────────
// The form UI lives at the event-specific /invite/decline/ Hugo page driven by
// assets/ts/invite-decline.ts.  This endpoint is a safety redirect for any
// old API-URL links; all new invite emails use the event-specific URL produced
// by inviteDeclineUrl(appBaseUrl, event, token).

export async function onRequestGet(c: any): Promise<Response> {
  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  const url = new URL("/invite/decline/", origin);
  url.searchParams.set("token", c.req.param("token"));
  const inviteId = new URL(c.req.raw.url).searchParams.get("id");
  if (inviteId) {
    url.searchParams.set("id", inviteId);
  }
  return Response.redirect(url.toString(), 302);
}

// ── POST: Decline (with optional forwarding) ──────────────────────────────────

export async function onRequestPost(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, inviteDeclineSchema);
  const inviteId = new URL(c.req.raw.url).searchParams.get("id");
  const invite = await findInviteByToken(c.env.DB, c.req.param("token"), inviteId);

  // Forward the invite to nominated contacts before declining
  const forwardedEmails: string[] = [];
  if (body.forwards && body.forwards.length > 0) {
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

    const event = await first<{
      id: string;
      name: string;
      slug: string;
      base_path: string | null;
      starts_at: string | null;
      settings_json: string;
    }>(c.env.DB, "SELECT id, name, slug, base_path, starts_at, settings_json FROM events WHERE id = ?", [
      invite.event_id,
    ]);

    if (event) {
      for (const contact of body.forwards) {
        try {
          const {
            invite: newInvite,
            token: inviteToken,
            isNew,
          } = await createInvite(c.env.DB, {
            eventId: invite.event_id,
            inviteeEmail: contact.email,
            inviteeFirstName: contact.firstName ?? null,
            inviteeLastName: contact.lastName ?? null,
            inviteType: invite.invite_type,
            sourceType: "declined-forward",
          });

          // Do not send a new email if the contact already has an active invite.
          if (!isNew) continue;
          const registrationUrl =
            invite.invite_type === "attendee"
              ? registrationPageUrl(appBaseUrl, event, {
                  invite: inviteToken,
                  inviteId: newInvite.id,
                  source: "invite",
                })
              : undefined;
          const proposalUrl =
            invite.invite_type === "speaker"
              ? proposalPageUrl(appBaseUrl, event, {
                  invite: inviteToken,
                  inviteId: newInvite.id,
                  source: "speaker_invite_forward",
                })
              : undefined;
          const declineUrl = inviteDeclineUrl(appBaseUrl, event, inviteToken, newInvite.id);

          const outboxId = await queueEmail(c.env.DB, {
            eventId: event.id,
            templateKey: invite.invite_type === "speaker" ? "speaker_invite" : "attendee_invite",
            recipientEmail: newInvite.invitee_email,
            messageType: "transactional",
            subject:
              invite.invite_type === "speaker" ? `Speaker invitation: ${event.name}` : `Invitation: ${event.name}`,
            data: {
              ...buildEventEmailVariables(event, appBaseUrl),
              firstName: newInvite.invitee_first_name ?? "",
              lastName: newInvite.invitee_last_name ?? "",
              registrationUrl,
              proposalUrl,
              declineUrl,
            },
          });

          c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
          forwardedEmails.push(contact.email);
        } catch {
          // Skip contacts that are unsubscribed or already have active invites — continue with the rest
        }
      }
    }
  }

  await declineInvite(c.env.DB, {
    inviteId: invite.id,
    reasonCode: body.reasonCode,
    reasonNote: body.reasonNote,
    unsubscribeFuture: body.unsubscribeFuture,
    npsScore: body.npsScore,
  });

  return json({ success: true, forwarded: forwardedEmails });
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
