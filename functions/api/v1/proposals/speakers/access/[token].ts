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
 *   Body: { biography?: string, links?: string[] }      — update speaker profile (bio / links)
 *
 * For headshot and presentation file uploads see:
 *   PUT /api/v1/proposals/speakers/access/[token]/headshot
 *   PUT /api/v1/proposals/speakers/access/[token]/presentation
 */
import { handleError, json } from "../../../../../_lib/http";
import type { ValidatedData } from "chanfana";
import { getSpeakerByManageToken } from "../../../../../_lib/services/proposals";
import {
  confirmSpeakerParticipation,
  declineSpeakerParticipation,
  updateSpeakerProfile,
  getProposalCoSpeakers,
  getPresentationUploader,
} from "../../../../../_lib/services/proposals-speaker-profile";
import { getRequiredTerms } from "../../../../../_lib/services/events";
import { speakerPresentationPageUrl } from "../../../../../_lib/services/frontend-links";
import { requireInternalSecret } from "../../../../../_lib/request";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { parseLinksJson, serializeLinks } from "../../../../../../assets/shared/schemas/links";
import { isProposalSpeakerRosterEditableStatus } from "../../../../../../assets/shared/schemas/proposal-status";
import { getEventById } from "../../../../../_lib/services/events";
import { requestDb } from "../../../../../_lib/db/context";
import { requiredTermReadModel } from "../../../../../_lib/services/event-read-models";
import {
  speakerParticipationResponseSchema,
  speakerSelfServiceReadResponseSchema,
} from "../../../../../../assets/shared/schemas/speaker-self-service";
import {
  proposalSpeakerParticipationRouteSchema,
  proposalSpeakerProfileUpdateRouteSchema,
  proposalSpeakerSelfServiceReadRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { successResponseSchema } from "../../../../../../assets/shared/schemas/api-common";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { proposalSpeakerAccessPath } from "../../../../../../assets/shared/proposal-access-paths";

export async function onRequestGet(
  c: any,
  data: ValidatedData<typeof proposalSpeakerSelfServiceReadRouteSchema>,
): Promise<Response> {
  try {
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const db = requestDb(c);
    const token = data.params.token;
    const { speaker, proposal, user } = await getSpeakerByManageToken(db, token, requireInternalSecret(c.env));

    const [coSpeakers, presentationUploader, presentationTerms, event] = await Promise.all([
      getProposalCoSpeakers(db, proposal.id, speaker.user_id),
      getPresentationUploader(db, proposal.id),
      getRequiredTerms(db, proposal.event_id, "presentation"),
      getEventById(db, proposal.event_id),
    ]);

    const presentationUrl = event ? speakerPresentationPageUrl(appBaseUrl, event, token) : null;

    return json(
      speakerSelfServiceReadResponseSchema.parse({
        speaker: {
          role: speaker.role,
          status: speaker.status,
          confirmedAt: speaker.confirmed_at,
          declinedAt: speaker.declined_at,
          termsAcceptedAt: speaker.terms_accepted_at,
        },
        proposal: {
          id: proposal.id,
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
        profile: {
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          organizationName: user.organization_name,
          jobTitle: user.job_title,
          biography: user.biography,
          links: parseLinksJson(user.links_json),
          headshotUploaded: Boolean(user.headshot_r2_key),
          headshotUpdatedAt: user.headshot_updated_at,
          headshotUrl: user.headshot_r2_key
            ? `${proposalSpeakerAccessPath(`${appBaseUrl}/api/v1`, token, "headshot")}?v=${encodeURIComponent(user.headshot_updated_at ?? "")}`
            : null,
        },
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestParticipationPatch(
  c: any,
  data: ValidatedData<typeof proposalSpeakerParticipationRouteSchema>,
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

    await declineSpeakerParticipation(requestDb(c), token, requireInternalSecret(c.env), {
      reason: body.reason ?? null,
    });
    return json(speakerParticipationResponseSchema.parse({ success: true, status: "declined" }));
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestProfilePatch(
  c: any,
  data: ValidatedData<typeof proposalSpeakerProfileUpdateRouteSchema>,
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

    await updateSpeakerProfile(
      requestDb(c),
      {
        firstName: body.firstName === undefined ? undefined : body.firstName || null,
        lastName: body.lastName === undefined ? undefined : body.lastName || null,
        organizationName: body.organizationName === undefined ? undefined : body.organizationName || null,
        jobTitle: body.jobTitle === undefined ? undefined : body.jobTitle || null,
        biography: body.biography === undefined ? undefined : body.biography || null,
        linksJson: body.links === undefined ? undefined : serializeLinks(body.links),
      },
      {
        proposalSpeakerId: speaker.id,
        proposalId: proposal.id,
        proposalStatus: proposal.status,
        proposalUpdatedAt: proposal.updated_at,
        userId: user.id,
        currentStatus: speaker.status,
        inviteGeneration: speaker.invite_generation,
        expectedProfileOverridesJson: user.proposalProfileOverridesJson,
      },
    );

    return json(successResponseSchema.parse({ success: true }));
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
