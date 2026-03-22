import { parseJsonBody } from "../../../../_lib/validation";
import { json, markSensitive } from "../../../../_lib/http";
import { buildEventEmailVariables, getEventBySlug } from "../../../../_lib/services/events";
import { getRegistrationByManageToken } from "../../../../_lib/services/registrations";
import { countInvitesByInviter, createInvite } from "../../../../_lib/services/invites";
import { first } from "../../../../_lib/db/queries";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { proposalPageUrl, inviteDeclineUrl } from "../../../../_lib/services/frontend-links";
import { AppError } from "../../../../_lib/errors";
import type { PagesContext } from "../../../../_lib/types";
import { registrationInviteCreateSchema } from "../../../../../assets/shared/schemas/api";

function getManageTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

/**
 * POST /api/v1/events/:eventSlug/speaker-invites
 *
 * Allows a registered attendee (authenticated via their manage token) to
 * nominate speakers for the event.  The nominator's name appears in the
 * speaker invite email — "Paul van Brouwershaven has personally nominated you
 * to speak at …" — which leverages the same social-proof psychology as the
 * attendee peer-invite flow.
 *
 * Duplicate invites are handled by createInvite: if the nominee already has an
 * active invite the nominator is recorded as a co-inviter and no second email
 * is sent.  If the nominee is already registered or has an active proposal the
 * invite is silently skipped.
 */
export async function onRequestPost(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  const token = getManageTokenFromRequest(context.request);
  if (!token) {
    return json({ error: { code: "AUTH_REQUIRED", message: "Registration manage token required" } }, 401);
  }

  const body = await parseJsonBody(context.request, registrationInviteCreateSchema);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const registration = await getRegistrationByManageToken(context.env.DB, token);

  if (registration.event_id !== event.id) {
    return json({ error: { code: "EVENT_MISMATCH", message: "Token is not valid for this event" } }, 403);
  }

  const config = getConfig(context.env, context.request);
  const appBaseUrl = resolveAppBaseUrl(context.env);
  const maxAllowed = event.invite_limit_speaker_nomination ?? config.inviteLimitSpeakerNomination;

  // Look up nominator's full name — the key social-proof ingredient.
  const nominatorUser = await first<{ first_name: string | null; last_name: string | null; organization_name: string | null }>(
    context.env.DB,
    "SELECT first_name, last_name, organization_name FROM users WHERE id = ?",
    [registration.user_id],
  );
  const nominatorBaseName = nominatorUser
    ? [nominatorUser.first_name, nominatorUser.last_name].filter(Boolean).join(" ")
    : "";
  const inviterName = nominatorBaseName && nominatorUser?.organization_name
    ? `${nominatorBaseName} (${nominatorUser.organization_name})`
    : nominatorBaseName;

  let nominationCount = await countInvitesByInviter(
    context.env.DB,
    event.id,
    registration.user_id,
    "speaker",
  );

  const created: Array<{ email: string }> = [];
  const endorsed: Array<{ email: string }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];

  for (const item of body.invites) {
    if (nominationCount + 1 > maxAllowed) {
      skipped.push({ email: item.email, reason: "invite_limit_exceeded" });
      continue;
    }

    try {
      const { invite, token: inviteToken, isNew } = await createInvite(context.env.DB, {
        eventId: event.id,
        inviterUserId: registration.user_id,
        inviterRegistrationId: registration.id,
        inviteeEmail: item.email,
        inviteeFirstName: item.firstName,
        inviteeLastName: item.lastName,
        inviteType: "speaker",
        sourceType: "peer-nomination",
        ttlHours: 24 * 21,
      });

      if (isNew) {
        nominationCount++;
        const proposalUrl = proposalPageUrl(appBaseUrl, event, {
          invite: inviteToken,
          source: "speaker_peer_nomination",
        });
        const declineUrl = inviteDeclineUrl(appBaseUrl, event, inviteToken);
        const outboxId = await queueEmail(context.env.DB, {
          eventId: event.id,
          templateKey: "speaker_invite",
          recipientEmail: invite.invitee_email,
          messageType: "transactional",
          subject: `Invitation to speak at ${event.name}`,
          data: {
            ...buildEventEmailVariables(event, appBaseUrl),
            firstName: invite.invitee_first_name ?? "",
            lastName: invite.invitee_last_name ?? "",
            inviterName,
            proposalUrl,
            declineUrl,
          },
        });
        context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));
        created.push({ email: invite.invitee_email });
      } else {
        endorsed.push({ email: invite.invitee_email });
      }
    } catch (err) {
      if (err instanceof AppError && (
        err.code === "INVITEE_ALREADY_REGISTERED"
        || err.code === "INVITEE_ALREADY_PROPOSED"
        || err.code === "INVITEE_UNSUBSCRIBED"
      )) {
        skipped.push({ email: item.email, reason: err.code.toLowerCase() });
      } else {
        throw err;
      }
    }
  }

  return json({ success: true, created, endorsed, skipped });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
