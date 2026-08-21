import type { z } from "zod";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { getEventBySlug, getRequiredTerms, updateEventBasePath } from "../../../../_lib/services/events";
import { validateCustomAnswersByPurpose } from "../../../../_lib/services/forms";
import { trySeedGravatarThenPrerender } from "../../../../_lib/services/og-badge-prerender";
import { findInviteByToken, type InviteRecord } from "../../../../_lib/services/invites";
import { validateRequiredConsents } from "../../../../_lib/services/consent";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { proposalCreateSchema } from "../../../../../assets/shared/schemas/proposal-management";
import { eventProposalCreateRouteSchema } from "../../../../../assets/shared/schemas/route-contracts";
import { requireInternalSecret } from "../../../../_lib/request";
import { submitProposal } from "../../../../_lib/services/proposal-submission";

export async function onRequestPost(c: any, data?: { body: z.infer<typeof proposalCreateSchema> }): Promise<Response> {
  const config = getConfig(c.env, c.req.raw);
  const signingSecret = requireInternalSecret(c.env);
  const body = data?.body ?? (await parseJsonBody(c.req, proposalCreateSchema));
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  // Record the Hugo page URL sent by the browser so base_path is always the
  // real event page location, not a hardcoded pattern.
  await updateEventBasePath(c.env.DB, event.id, c.req.raw.headers.get("x-event-base-path"));

  let acceptedInvite: InviteRecord | null = null;
  if (body.inviteToken) {
    const invite = await findInviteByToken(c.env.DB, body.inviteToken, signingSecret, body.inviteId);
    if (invite.event_id !== event.id || invite.invite_type !== "speaker") {
      return json({ error: { code: "INVITE_INVALID", message: "Invalid speaker invite" } }, 400);
    }
    // Accept the invite regardless of whether the proposer email matches the
    // invitee email. A colleague may submit on someone else's behalf (delegation),
    // and we want the invite to be consumed so reminders stop going to the invitee.
    acceptedInvite = invite;
  }

  const requiredTerms = await getRequiredTerms(c.env.DB, event.id, "speaker");
  await validateRequiredConsents(requiredTerms, body.consents);
  const proposalDetails = await validateCustomAnswersByPurpose(c.env.DB, {
    eventId: event.id,
    purpose: "proposal_submission",
    customAnswers: body.proposal.details,
  });

  const submitted = await submitProposal(c.env.DB, {
    event,
    body,
    appBaseUrl,
    signingSecret,
    referralCodeLength: config.referralCodeLength,
    proposalDetails,
    acceptedInvite,
    ip: c.req.raw.headers.get("cf-connecting-ip"),
    userAgent: c.req.raw.headers.get("user-agent"),
  });

  c.executionCtx.waitUntil(
    trySeedGravatarThenPrerender(
      submitted.proposer.id,
      submitted.proposer.email,
      submitted.referralCode,
      c.env,
      appBaseUrl,
    ),
  );
  for (const id of submitted.outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, id));
  }

  return json({
    success: true,
    proposalId: submitted.proposalId,
    status: submitted.status,
    manageToken: submitted.manageToken,
    manageUrl: submitted.manageUrl,
    shareUrl: submitted.shareUrl,
  });
}

export const EventsEventSlugProposalsPost = openApiRoute(eventProposalCreateRouteSchema, onRequestPost);
