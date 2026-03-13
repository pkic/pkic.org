import { parseJsonBody } from "../../../../_lib/validation";
import { json, markSensitive } from "../../../../_lib/http";
import { buildEventEmailVariables, getEventBySlug, getRequiredTerms, updateEventBasePath } from "../../../../_lib/services/events";
import { createProposal, addProposalSpeaker } from "../../../../_lib/services/proposals";
import { validateCustomAnswersByPurpose } from "../../../../_lib/services/forms";
import { createReferralCode } from "../../../../_lib/services/referrals";
import { trySeedGravatarThenPrerender } from "../../../../_lib/services/og-badge-prerender";
import { findInviteByToken, acceptInvite } from "../../../../_lib/services/invites";
import { findOrCreateUser } from "../../../../_lib/services/users";
import { persistConsents, validateRequiredConsents } from "../../../../_lib/services/consent";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { proposalManagePageUrl, speakerManagePageUrl } from "../../../../_lib/services/frontend-links";
import type { PagesContext } from "../../../../_lib/types";
import { proposalCreateSchema } from "../../../../../shared/schemas/api";
import { requireInternalSecret } from "../../../../_lib/request";

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const config = getConfig(context.env, context.request);
  const signingSecret = requireInternalSecret(context.env);
  const body = await parseJsonBody(context.request, proposalCreateSchema);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const appBaseUrl = resolveAppBaseUrl(context.env);

  // Record the Hugo page URL sent by the browser so base_path is always the
  // real event page location, not a hardcoded pattern.
  await updateEventBasePath(
    context.env.DB,
    event.id,
    context.request.headers.get("x-event-base-path"),
  );

  let inviteId: string | null = null;
  if (body.inviteToken) {
    const invite = await findInviteByToken(context.env.DB, body.inviteToken);
    if (invite.event_id !== event.id || invite.invite_type !== "speaker") {
      return json({ error: { code: "INVITE_INVALID", message: "Invalid speaker invite" } }, 400);
    }
    if (invite.invitee_email !== body.proposer.email) {
      return json({ error: { code: "EMAIL_MISMATCH", message: "Invite email must match proposer email" } }, 400);
    }
    inviteId = invite.id;
  }

  const proposer = await findOrCreateUser(context.env.DB, {
    email: body.proposer.email,
    firstName: body.proposer.firstName,
    lastName: body.proposer.lastName,
    organizationName: body.proposer.organizationName,
    jobTitle: body.proposer.jobTitle,
    biography: body.proposer.bio ?? null,
    linksJson: body.proposer.links.length > 0 ? JSON.stringify(body.proposer.links) : null,
  });

  const requiredTerms = await getRequiredTerms(context.env.DB, event.id, "speaker");
  await validateRequiredConsents(requiredTerms, body.consents);
  const proposalDetails = await validateCustomAnswersByPurpose(context.env.DB, {
    eventId: event.id,
    purpose: "proposal_submission",
    customAnswers: body.proposal.details,
  });

  const created = await createProposal(context.env.DB, {
    eventId: event.id,
    proposerUserId: proposer.id,
    proposalType: body.proposal.type,
    title: body.proposal.title,
    abstract: body.proposal.abstract,
    detailsJson: Object.keys(proposalDetails).length > 0 ? JSON.stringify(proposalDetails) : null,
    referredByCode: body.referralCode,
  });

  await addProposalSpeaker(context.env.DB, {
    proposalId: created.proposal.id,
    userId: proposer.id,
    role: "proposer",
  });

  // Add co-speakers and email each one to confirm participation.
  const outboxIds: string[] = [];
  for (const speaker of body.speakers) {
    const speakerUser = await findOrCreateUser(context.env.DB, {
      email: speaker.email,
      firstName: speaker.firstName,
      lastName: speaker.lastName,
      organizationName: speaker.organizationName,
      jobTitle: speaker.jobTitle,
      biography: speaker.bio,
      linksJson: speaker.links.length > 0 ? JSON.stringify(speaker.links) : null,
    });

    const { manageToken: speakerToken } = await addProposalSpeaker(context.env.DB, {
      proposalId: created.proposal.id,
      userId: speakerUser.id,
      role: speaker.role,
    });

    if (speakerToken) {
      const speakerManageUrl = speakerManagePageUrl(appBaseUrl, event, speakerToken);
      const id = await queueEmail(context.env.DB, {
        eventId: event.id,
        templateKey: "co_speaker_invite",
        recipientEmail: speakerUser.email,
        recipientUserId: speakerUser.id,
        messageType: "transactional",
        subject: `You have been added as a speaker — ${event.name}`,
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          firstName: speakerUser.first_name ?? "",
          lastName: speakerUser.last_name ?? "",
          proposerFirstName: proposer.first_name ?? "",
          proposalTitle: created.proposal.title,
          manageUrl: speakerManageUrl,
        },
      });
      outboxIds.push(id);
    }
  }

  await persistConsents(context.env.DB, {
    proposalId: created.proposal.id,
    eventId: event.id,
    userId: proposer.id,
    audienceType: "speaker",
    accepted: body.consents,
    ip: context.request.headers.get("cf-connecting-ip"),
    userAgent: context.request.headers.get("user-agent"),
    secret: signingSecret,
  });

  if (inviteId) {
    await acceptInvite(context.env.DB, inviteId);
  }

  const referralCode = await createReferralCode(context.env.DB, {
    eventId: event.id,
    ownerType: "proposal",
    ownerId: created.proposal.id,
    createdByUserId: proposer.id,
    length: config.referralCodeLength,
  });

  context.waitUntil(trySeedGravatarThenPrerender(proposer.id, proposer.email, referralCode, context.env, appBaseUrl));

  const manageUrl = proposalManagePageUrl(appBaseUrl, event, created.manageToken);

  const outboxId = await queueEmail(context.env.DB, {
    eventId: event.id,
    templateKey: "proposal_submitted",
    recipientEmail: proposer.email,
    recipientUserId: proposer.id,
    messageType: "transactional",
    subject: `Proposal submitted: ${created.proposal.title}`,
    data: {
      ...buildEventEmailVariables(event, appBaseUrl),
      firstName: proposer.first_name ?? "",
      lastName: proposer.last_name ?? "",
      proposalTitle: created.proposal.title,
      manageToken: created.manageToken,
      manageUrl,
      shareUrl: `${appBaseUrl}/r/${referralCode}`,
    },
  });

  for (const id of [...outboxIds, outboxId]) {
    context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, id));
  }

  return json({
    success: true,
    proposalId: created.proposal.id,
    status: created.proposal.status,
    manageToken: created.manageToken,
    manageUrl,
    shareUrl: `${config.appBaseUrl}/r/${referralCode}`,
  });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}
