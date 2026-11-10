import { isLateSpeakerResponseAwaitingReview } from "../../../assets/shared/proposal-speaker-acceptance";
import type { SpeakerSelfServiceReadResponse } from "../../../assets/shared/schemas/speaker-self-service";
import { proposalSpeakerAccessPath } from "../../../assets/shared/proposal-access-paths";
import { batchRows, batchFirst } from "../db/pagination";
import type { ConsentItem } from "../../../assets/shared/schemas/registration";
import type { DatabaseLike } from "../types";
import type { ParticipantAuthority } from "./participant-authority";
import { speakerSelfServiceProfileReadModel, type SpeakerWithContext } from "./proposals-speaker-capability";
import {
  prepareProposalCoSpeakers,
  proposalCoSpeakersReadModel,
  preparePresentationUploader,
  type ProposalCoSpeakerRow,
  type PresentationUploaderRow,
} from "./proposals-speaker-profile";
import { prepareRequiredTerms, prepareEventById, type EventRecord, type EventTermRecord } from "./events";
import { requiredTermReadModel } from "./event-read-models";
import { speakerPresentationPageUrl } from "./frontend-links";
import { prepareCurrentSpeakerConsents } from "./proposal-speaker-consent";
import { AppError } from "../errors";

export async function loadSpeakerParticipationView(
  db: DatabaseLike,
  context: SpeakerWithContext,
  { token, appBaseUrl }: { token: ParticipantAuthority; appBaseUrl: string },
): Promise<Omit<SpeakerSelfServiceReadResponse, "profile">> {
  const { speaker, proposal } = context;
  const [coSpeakersResult, uploaderResult, termsResult, eventResult, consentsResult] = await db.batch([
    prepareProposalCoSpeakers(db, proposal.id, speaker.user_id),
    preparePresentationUploader(db, proposal.id),
    prepareRequiredTerms(db, proposal.event_id, "presentation"),
    prepareEventById(db, proposal.event_id),
    prepareCurrentSpeakerConsents(db, proposal.event_id, speaker.user_id),
  ]);
  const coSpeakers = proposalCoSpeakersReadModel(batchRows<ProposalCoSpeakerRow>(coSpeakersResult));
  const presentationUploader = batchFirst<PresentationUploaderRow>(uploaderResult);
  const presentationTerms = batchRows<EventTermRecord>(termsResult);
  const event = batchFirst<EventRecord>(eventResult);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const acceptedConsents = batchRows<ConsentItem>(consentsResult);
  const presentationUrl = typeof token === "string" ? speakerPresentationPageUrl(appBaseUrl, event, token) : null;
  return {
    speaker: {
      userId: speaker.user_id,
      role: speaker.role,
      status: speaker.status,
      confirmedAt: speaker.confirmed_at,
      declinedAt: speaker.declined_at,
      termsAcceptedAt: speaker.terms_accepted_at,
      awaitingReview: isLateSpeakerResponseAwaitingReview(
        speaker.status,
        speaker.response_invite_generation,
        speaker.invite_generation,
      ),
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
    acceptedConsents,
    currentRepresentation: context.currentRepresentation,
  };
}

export function speakerProfileView(
  context: SpeakerWithContext,
  token: ParticipantAuthority,
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
