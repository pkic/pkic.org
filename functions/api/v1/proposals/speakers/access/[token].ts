import { assertInvitedSpeakerClaimSelection } from "../../../../../_lib/services/event-proposal-proof-redemption";
/**
 * Proposal-speaker capability endpoint.
 *
 * GET  /api/v1/proposals/speakers/access/[token]
 *   Returns the speaker's participation status, proposal details, and profile.
 *
 * PATCH /api/v1/proposals/speakers/access/[token]/participation
 *   Body: { status: "confirmed", consents } or { status: "declined", reason? }
 *
 * PATCH /api/v1/proposals/speakers/access/[token]/profile
 *   Body: names and the identity the speaker speaks as. The identity's own
 *   profile (title, biography, links) is edited on the identity:
 *   PATCH /api/v1/events/[eventSlug]/proposals/proof/identities/[identityId]
 *
 * For headshot and presentation file uploads see:
 *   PUT /api/v1/proposals/speakers/access/[token]/headshot
 *   PUT /api/v1/proposals/speakers/access/[token]/presentation
 */
import { declineSpeakerParticipation } from "../../../../../_lib/services/proposal-speaker-decline";
import { AppError } from "../../../../../_lib/errors";
import { requireIdentityFromRequest, resolveOptionalIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { handleError, json } from "../../../../../_lib/http";
import type { ParticipantRouteData } from "../../../../../_lib/routes/participant-authority";
import { getSpeakerByManageToken } from "../../../../../_lib/services/proposals";
import {
  speakerSelfServiceProfileReadModel,
  type SpeakerWithContext,
} from "../../../../../_lib/services/proposals-speaker-capability";
import {
  updateSpeakerProfile,
  getProposalCoSpeakers,
  getPresentationUploader,
} from "../../../../../_lib/services/proposals-speaker-profile";
import { confirmSpeakerParticipation } from "../../../../../_lib/services/proposal-speaker-confirmation";
import { getRequiredTerms } from "../../../../../_lib/services/events";
import { speakerPresentationPageUrl } from "../../../../../_lib/services/frontend-links";
import { processSelectedOutboxBackground } from "../../../../../_lib/email/outbox";
import { requireInternalSecret } from "../../../../../_lib/request";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { isProposalSpeakerRosterEditableStatus } from "../../../../../../assets/shared/schemas/proposal-status";
import { getEventById } from "../../../../../_lib/services/events";
import { requestDb } from "../../../../../_lib/db/context";
import { requiredTermReadModel } from "../../../../../_lib/services/event-read-models";
import {
  speakerParticipationResponseSchema,
  speakerProfileUpdateResponseSchema,
  speakerSelfServiceReadResponseSchema,
} from "../../../../../../assets/shared/schemas/speaker-self-service";
import {
  proposalSpeakerParticipationRouteSchema,
  proposalSpeakerProfileUpdateRouteSchema,
  proposalSpeakerSelfServiceReadRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { proposalSpeakerAccessPath } from "../../../../../../assets/shared/proposal-access-paths";
import {
  resolveSpeakerAccountAuthority,
  speakerAccountAuthority,
  speakerAccountSignInRequiredError,
} from "../../../../../_lib/services/proposal-speaker-account-authority";

export async function onRequestGet(
  c: any,
  data: ParticipantRouteData<typeof proposalSpeakerSelfServiceReadRouteSchema>,
): Promise<Response> {
  try {
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const db = requestDb(c);
    const token = data.params.token;
    const context = await getSpeakerByManageToken(db, token, requireInternalSecret(c.env));
    const { speaker, proposal } = context;

    const [coSpeakers, presentationUploader, presentationTerms, event, accountAuthority] = await Promise.all([
      getProposalCoSpeakers(db, proposal.id, speaker.user_id),
      getPresentationUploader(db, proposal.id),
      getRequiredTerms(db, proposal.event_id, "presentation"),
      getEventById(db, proposal.event_id),
      resolveSpeakerAccountAuthority(db, c.req.raw, c.env, {
        authority: token,
        userId: context.user.id,
        accountClaimed: context.user.account_claimed,
      }),
    ]);

    const presentationUrl =
      event && typeof token === "string" ? speakerPresentationPageUrl(appBaseUrl, event, token) : null;

    return json(
      speakerSelfServiceReadResponseSchema.parse({
        speaker: {
          userId: speaker.user_id,
          role: speaker.role,
          status: speaker.status,
          confirmedAt: speaker.confirmed_at,
          declinedAt: speaker.declined_at,
          termsAcceptedAt: speaker.terms_accepted_at,
        },
        proposal: {
          id: proposal.id,
          eventId: proposal.event_id,
          title: proposal.title,
          proposalType: proposal.proposal_type,
          status: proposal.status,
          presentationDeadline: proposal.presentation_deadline ?? null,
          presentationUploaded: Boolean(presentationUploader),
          presentationUploadedAt: presentationUploader?.uploadedAt ?? null,
          presentationUploader: presentationUploader,
          coSpeakers,
          presentationUrl,
        },
        presentationTerms: presentationTerms.map(requiredTermReadModel),
        profile: speakerProfileView(context, token, appBaseUrl, Boolean(accountAuthority)),
        currentRepresentation: context.currentRepresentation,
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestParticipationPatch(
  c: any,
  data: ParticipantRouteData<typeof proposalSpeakerParticipationRouteSchema>,
): Promise<Response> {
  try {
    const body = data.body;
    const token = data.params.token;

    if (body.status === "confirmed") {
      await confirmSpeakerParticipation(requestDb(c), token, requireInternalSecret(c.env), {
        consents: body.consents,
        ip: c.req.raw.headers.get("cf-connecting-ip"),
        userAgent: c.req.raw.headers.get("user-agent"),
      });
      return json(speakerParticipationResponseSchema.parse({ success: true, status: "confirmed" }));
    }

    const declined = await declineSpeakerParticipation(requestDb(c), token, requireInternalSecret(c.env), {
      reason: body.reason ?? null,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    });
    if (declined.outboxIds.length > 0)
      c.executionCtx.waitUntil(processSelectedOutboxBackground(c.env.DB, c.env, declined.outboxIds));
    return json(speakerParticipationResponseSchema.parse({ success: true, status: "declined" }));
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestProfilePatch(
  c: any,
  data: ParticipantRouteData<typeof proposalSpeakerProfileUpdateRouteSchema>,
): Promise<Response> {
  try {
    const body = data.body;
    const token = data.params.token;
    const { speaker, proposal, user } = await getSpeakerByManageToken(
      requestDb(c),
      token,
      requireInternalSecret(c.env),
    );

    if (speaker.status === "declined") {
      return json({ error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } }, 403);
    }
    if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
      return json(
        { error: { code: "PROPOSAL_CLOSED", message: "Speaker profiles cannot be changed on a closed proposal." } },
        409,
      );
    }

    // An invited guest proves their address with the confirmation token, so a session the server no
    // longer accepts is the same as none; selecting an identity without that proof needs a live one.
    const selectionAuthority =
      body.continuationToken !== undefined
        ? await resolveOptionalIdentityFromRequest(requestDb(c), c.req.raw, c.env)
        : body.actingIdentityId !== undefined
          ? await requireIdentityFromRequest(requestDb(c), c.req.raw, c.env)
          : undefined;
    // The link speaks for this proposal; the person's own name changes only with their session, a
    // mailbox proof, or while no mailbox of the account was ever proved.
    const accountInput = { authority: token, userId: user.id, accountClaimed: user.account_claimed };
    const accountAuthority =
      (body.firstName !== undefined || body.lastName !== undefined) && body.continuationToken === undefined
        ? selectionAuthority
          ? speakerAccountAuthority({ ...accountInput, session: selectionAuthority })
          : await resolveSpeakerAccountAuthority(requestDb(c), c.req.raw, c.env, accountInput)
        : undefined;
    if (accountAuthority === null) throw speakerAccountSignInRequiredError();
    if (selectionAuthority && selectionAuthority.userId !== speaker.user_id) {
      if (!body.continuationToken)
        throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "Select only your own speaker representation.");
      await assertInvitedSpeakerClaimSelection(requestDb(c), {
        continuationToken: body.continuationToken,
        signingSecret: requireInternalSecret(c.env),
        eventId: proposal.event_id,
        speakerId: speaker.id,
        actor: selectionAuthority,
      });
    }

    await updateSpeakerProfile(
      requestDb(c),
      {
        actingIdentityId: body.actingIdentityId,
        continuationToken: body.continuationToken,
        unaffiliatedAttestation: body.unaffiliatedAttestation,
        independentCapacity: body.independentCapacity,
        consents: body.consents,
        organizationName: body.organizationName,
        jobTitle: body.jobTitle,
        firstName: body.firstName === undefined ? undefined : body.firstName || null,
        lastName: body.lastName === undefined ? undefined : body.lastName || null,
      },
      {
        proposalSpeakerId: speaker.id,
        proposalId: proposal.id,
        proposalStatus: proposal.status,
        proposalUpdatedAt: proposal.updated_at,
        userId: user.id,
        currentStatus: speaker.status,
        inviteGeneration: speaker.invite_generation,
        expectedActingIdentityId: speaker.acting_identity_id,
        expectedActingIdentitySelectedAt: speaker.acting_identity_selected_at,
        authority: token,
        selectionAuthority,
        signingSecret: requireInternalSecret(c.env),
        expectedManageLinkSecret: speaker.manage_link_secret,
        accountAuthority,
      },
    );

    const saved = await getSpeakerByManageToken(requestDb(c), token, requireInternalSecret(c.env));
    const personalDetailsEditable = Boolean(
      accountAuthority ??
      speakerAccountAuthority({
        authority: token,
        session: selectionAuthority,
        userId: saved.user.id,
        accountClaimed: saved.user.account_claimed,
      }),
    );
    return json(
      speakerProfileUpdateResponseSchema.parse({
        success: true,
        profile: speakerProfileView(saved, token, resolveAppBaseUrl(c.env, c.req.raw), personalDetailsEditable),
        currentRepresentation: saved.currentRepresentation,
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}

function speakerProfileView(
  context: SpeakerWithContext,
  token: ParticipantRouteData<typeof proposalSpeakerSelfServiceReadRouteSchema>["params"]["token"],
  appBaseUrl: string,
  personalDetailsEditable: boolean,
) {
  const { user } = context;
  return speakerSelfServiceProfileReadModel(
    context,
    user.headshot_r2_key
      ? `${proposalSpeakerAccessPath(`${appBaseUrl}/api/v1`, token, "headshot")}?v=${encodeURIComponent(user.headshot_updated_at ?? "")}`
      : null,
    personalDetailsEditable,
  );
}

function markSensitive(c: any): void {
  c.set("sensitive", true);
}

export const ProposalSpeakerAccessGet = openApiRoute(
  proposalSpeakerSelfServiceReadRouteSchema,
  onRequestGet,
  markSensitive,
);
export const ProposalSpeakerAccessParticipationPatch = openApiRoute(
  proposalSpeakerParticipationRouteSchema,
  onRequestParticipationPatch,
  markSensitive,
);
export const ProposalSpeakerAccessProfilePatch = openApiRoute(
  proposalSpeakerProfileUpdateRouteSchema,
  onRequestProfilePatch,
  markSensitive,
);
