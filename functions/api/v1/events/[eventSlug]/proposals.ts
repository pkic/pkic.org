import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import {
  buildEventEmailVariables,
  getEventBySlug,
  getRequiredTerms,
  updateEventBasePath,
} from "../../../../_lib/services/events";
import {
  createProposal,
  addProposalSpeaker,
  buildProposalInviteEmailContext,
} from "../../../../_lib/services/proposals";
import { validateCustomAnswersByPurpose } from "../../../../_lib/services/forms";
import { createReferralCode } from "../../../../_lib/services/referrals";
import { trySeedGravatarThenPrerender } from "../../../../_lib/services/og-badge-prerender";
import { findInviteByToken, acceptInvite } from "../../../../_lib/services/invites";
import { findOrCreateUser } from "../../../../_lib/services/users";
import { persistConsents, validateRequiredConsents } from "../../../../_lib/services/consent";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { proposalManagePageUrl, speakerManagePageUrl } from "../../../../_lib/services/frontend-links";
import { proposalCreateSchema } from "../../../../../assets/shared/schemas/api";
import { eventProposalCreateRouteSchema } from "../../../../../assets/shared/schemas/route-contracts";
import { requireInternalSecret } from "../../../../_lib/request";

export async function onRequestPost(c: any): Promise<Response> {
  const config = getConfig(c.env, c.req.raw);
  const signingSecret = requireInternalSecret(c.env);
  const body = await parseJsonBody(c.req, proposalCreateSchema);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  // Record the Hugo page URL sent by the browser so base_path is always the
  // real event page location, not a hardcoded pattern.
  await updateEventBasePath(c.env.DB, event.id, c.req.raw.headers.get("x-event-base-path"));

  let inviteId: string | null = null;
  if (body.inviteToken) {
    const invite = await findInviteByToken(c.env.DB, body.inviteToken, body.inviteId);
    if (invite.event_id !== event.id || invite.invite_type !== "speaker") {
      return json({ error: { code: "INVITE_INVALID", message: "Invalid speaker invite" } }, 400);
    }
    // Accept the invite regardless of whether the proposer email matches the
    // invitee email. A colleague may submit on someone else's behalf (delegation),
    // and we want the invite to be consumed so reminders stop going to the invitee.
    inviteId = invite.id;
  }

  const proposer = await findOrCreateUser(c.env.DB, {
    email: body.proposer.email,
    firstName: body.proposer.firstName,
    lastName: body.proposer.lastName,
    organizationName: body.proposer.organizationName,
    jobTitle: body.proposer.jobTitle,
    biography: body.proposer.bio,
    linksJson: body.proposer.links.length > 0 ? JSON.stringify(body.proposer.links) : undefined,
  });

  const requiredTerms = await getRequiredTerms(c.env.DB, event.id, "speaker");
  await validateRequiredConsents(requiredTerms, body.consents);
  const proposalDetails = await validateCustomAnswersByPurpose(c.env.DB, {
    eventId: event.id,
    purpose: "proposal_submission",
    customAnswers: body.proposal.details,
  });

  const created = await createProposal(c.env.DB, {
    eventId: event.id,
    proposerUserId: proposer.id,
    proposalType: body.proposal.type,
    title: body.proposal.title,
    abstract: body.proposal.abstract,
    detailsJson: Object.keys(proposalDetails).length > 0 ? JSON.stringify(proposalDetails) : null,
    referredByCode: body.referralCode,
  });

  await addProposalSpeaker(c.env.DB, {
    proposalId: created.proposal.id,
    userId: proposer.id,
    role: body.proposer.role,
  });

  // Add co-speakers and email each one to confirm participation.
  const outboxIds: string[] = [];
  for (const speaker of body.speakers) {
    const speakerUser = await findOrCreateUser(c.env.DB, {
      email: speaker.email,
      firstName: speaker.firstName,
      lastName: speaker.lastName,
      organizationName: speaker.organizationName,
      jobTitle: speaker.jobTitle,
      biography: speaker.bio,
      linksJson: speaker.links.length > 0 ? JSON.stringify(speaker.links) : undefined,
    });

    const { manageToken: speakerToken } = await addProposalSpeaker(c.env.DB, {
      proposalId: created.proposal.id,
      userId: speakerUser.id,
      role: speaker.role,
    });

    if (speakerToken) {
      const speakerManageUrl = speakerManagePageUrl(appBaseUrl, event, speakerToken);
      const inviteContext = await buildProposalInviteEmailContext(c.env.DB, {
        proposalId: created.proposal.id,
        inviterUserId: proposer.id,
      });
      const id = await queueEmail(c.env.DB, {
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
          invitedByDisplay: inviteContext.invitedByDisplay,
          proposalTitle: inviteContext.proposalTitle,
          proposalAbstract: inviteContext.proposalAbstract,
          speakerLineupText: inviteContext.speakerLineupText,
          manageUrl: speakerManageUrl,
        },
      });
      outboxIds.push(id);
    }
  }

  await persistConsents(c.env.DB, {
    proposalId: created.proposal.id,
    eventId: event.id,
    userId: proposer.id,
    audienceType: "speaker",
    accepted: body.consents,
    ip: c.req.raw.headers.get("cf-connecting-ip"),
    userAgent: c.req.raw.headers.get("user-agent"),
    secret: signingSecret,
  });

  if (inviteId) {
    await acceptInvite(c.env.DB, inviteId);
  }

  const referralCode = await createReferralCode(c.env.DB, {
    eventId: event.id,
    ownerType: "proposal",
    ownerId: created.proposal.id,
    createdByUserId: proposer.id,
    length: config.referralCodeLength,
  });

  c.executionCtx.waitUntil(trySeedGravatarThenPrerender(proposer.id, proposer.email, referralCode, c.env, appBaseUrl));

  const manageUrl = proposalManagePageUrl(appBaseUrl, event, created.manageToken);

  const inviteContext = await buildProposalInviteEmailContext(c.env.DB, {
    proposalId: created.proposal.id,
    inviterUserId: proposer.id,
  });

  const outboxId = await queueEmail(c.env.DB, {
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
      proposalAbstract: created.proposal.abstract,
      proposalType: created.proposal.proposal_type,
      speakerLineupText: inviteContext.speakerLineupText,
      manageToken: created.manageToken,
      manageUrl,
      shareUrl: `${appBaseUrl}/r/${referralCode}`,
    },
  });

  for (const id of [...outboxIds, outboxId]) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, id));
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

export class EventsEventSlugProposalsPost extends OpenAPIRoute {
  schema = eventProposalCreateRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
