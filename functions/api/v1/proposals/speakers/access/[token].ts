import {
  loadSpeakerSelfServiceView,
  speakerProfileView,
} from "../../../../../_lib/services/proposal-speaker-self-view";
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
import { AppError } from "../../../../../_lib/errors";
import { requireIdentityFromRequest, resolveOptionalIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { handleError, json } from "../../../../../_lib/http";
import type { ParticipantRouteData } from "../../../../../_lib/routes/participant-authority";
import { getSpeakerByManageToken } from "../../../../../_lib/services/proposals";
import {
  updateSpeakerProfile,
  isSpeakerIdentitySelectionOnly,
} from "../../../../../_lib/services/proposals-speaker-profile";
import { requireInternalSecret } from "../../../../../_lib/request";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { isProposalSpeakerRosterEditableStatus } from "../../../../../../assets/shared/schemas/proposal-status";
import { requestDb } from "../../../../../_lib/db/context";
import { speakerProfileUpdateResponseSchema } from "../../../../../../assets/shared/schemas/speaker-self-service";
import {
  proposalSpeakerProfileUpdateRouteSchema,
  proposalSpeakerSelfServiceReadRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { openApiRoute } from "../../../../../_lib/openapi/route";
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
    const context = await getSpeakerByManageToken(db, token, requireInternalSecret(c.env), {
      allowExpiredSession: true,
    });
    const accountAuthority = await resolveSpeakerAccountAuthority(db, c.req.raw, c.env, {
      authority: token,
      userId: context.user.id,
      accountClaimed: context.user.account_claimed,
    });
    return json(
      await loadSpeakerSelfServiceView(db, context, {
        token,
        appBaseUrl,
        personalDetailsEditable: Boolean(accountAuthority),
      }),
    );
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
    const selectingIdentity = isSpeakerIdentitySelectionOnly(body);
    const { speaker, proposal, user } = await getSpeakerByManageToken(
      requestDb(c),
      token,
      requireInternalSecret(c.env),
      { allowExpiredSession: selectingIdentity },
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
        responseInviteGeneration: speaker.response_invite_generation,
      },
    );

    const saved = await getSpeakerByManageToken(requestDb(c), token, requireInternalSecret(c.env), {
      allowExpiredSession: selectingIdentity,
    });
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

function markSensitive(c: any): void {
  c.set("sensitive", true);
}

export const ProposalSpeakerAccessGet = openApiRoute(
  proposalSpeakerSelfServiceReadRouteSchema,
  onRequestGet,
  markSensitive,
);
export const ProposalSpeakerAccessProfilePatch = openApiRoute(
  proposalSpeakerProfileUpdateRouteSchema,
  onRequestProfilePatch,
  markSensitive,
);
