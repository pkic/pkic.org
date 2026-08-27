import type { ValidatedData } from "chanfana";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { getEventBySlug, getRequiredTerms, recordHugoEventBasePath } from "../../../../_lib/services/events";
import { validateCustomAnswersForSubmission } from "../../../../_lib/services/forms";
import { seedGravatarAndProcessBadgeRenderJob } from "../../../../_lib/services/registration-badge-regeneration";
import { findInviteByToken, type InviteRecord } from "../../../../_lib/services/invites";
import { validateRequiredConsents } from "../../../../_lib/services/consent";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { eventProposalCreateRouteSchema } from "../../../../../assets/shared/schemas/route-contracts";
import { requireInternalSecret } from "../../../../_lib/request";
import { submitProposal } from "../../../../_lib/services/proposal-submission";

async function handleProposalCreate(
  c: any,
  data: ValidatedData<typeof eventProposalCreateRouteSchema>,
): Promise<Response> {
  const config = getConfig(c.env, c.req.raw);
  const signingSecret = requireInternalSecret(c.env);
  const body = data.body;
  const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  // Hugo publication pages may record their real path. Portal-owned routes
  // are platform-derived and the shared service ignores this browser header.
  await recordHugoEventBasePath(c.env.DB, event, c.req.raw.headers.get("x-event-base-path"));

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
  const validatedForm = await validateCustomAnswersForSubmission(c.env.DB, {
    eventId: event.id,
    purpose: "proposal_submission",
    customAnswers: body.proposal.details,
  });
  const proposalDetails = validatedForm.answers;

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
    formDefinition: validatedForm.form,
  });

  c.executionCtx.waitUntil(
    seedGravatarAndProcessBadgeRenderJob(c.env.DB, c.env, {
      userId: submitted.proposer.id,
      email: submitted.proposer.email,
      jobId: submitted.badgeRenderJobId,
    }),
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

export const EventsEventSlugProposalsPost = openApiRoute(eventProposalCreateRouteSchema, handleProposalCreate);
