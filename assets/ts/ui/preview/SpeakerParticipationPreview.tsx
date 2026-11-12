import { ProposalSpeakerCard } from "../../components/proposals/ProposalSpeakerCard";
import { proposalSpeakerSchema } from "../../../shared/schemas/proposal-speakers";
import { ParticipantSpeaker } from "../../components/events/ParticipantSpeaker";
import { speakerSelfServiceReadResponseSchema } from "../../../shared/schemas/speaker-self-service";

const id = "00000000-0000-4000-8000-000000000041";
const at = "2026-11-05T00:00:00.000Z";

/** The production participation screen with a selected, synthetic individual identity. */
function speakerParticipationData(late: boolean) {
  const selection = { actingIdentityId: null, actingIdentitySelection: "individual", actingIdentitySelectedAt: at };
  const data = speakerSelfServiceReadResponseSchema.parse({
    speaker: {
      userId: id,
      role: "speaker",
      status: late ? "pending" : "invited",
      confirmedAt: null,
      declinedAt: null,
      termsAcceptedAt: late ? at : null,
      awaitingReview: late,
    },
    proposal: {
      id,
      title: "Practical certificate migration",
      proposalType: "talk",
      status: "submitted",
      presentationDeadline: null,
      presentationUploaded: false,
      presentationUploadedAt: null,
      presentationUploader: null,
      coSpeakers: [],
      presentationUrl: null,
    },
    profile: {
      ...selection,
      email: "casey@example.test",
      firstName: "Casey",
      lastName: "Speaker",
      organizationName: null,
      jobTitle: null,
      biography: "Independent certificate researcher.",
      links: [],
      headshotUploaded: false,
      headshotUpdatedAt: null,
      headshotUrl: null,
      personalDetailsEditable: true,
    },
    currentRepresentation: {
      ...selection,
      identityId: id,
      emailId: null,
      email: "casey@example.test",
      organizationId: null,
      organizationName: null,
      jobTitle: null,
      biography: "Independent certificate researcher.",
      links: [],
      updatedAt: at,
    },
    presentationTerms: [],
    acceptedConsents: [],
  });
  return data;
}

export function SpeakerParticipationPreview({ late = false }: { late?: boolean }) {
  const data = speakerParticipationData(late);
  return <ParticipantSpeaker data={data} eventSlug="example-event" terms={[]} reload={async () => {}} />;
}

export function ConfirmedSpeakerPreview({ proposer = false }: { proposer?: boolean }) {
  const data = speakerParticipationData(false);
  const speaker = proposalSpeakerSchema.parse({
    ...data.profile,
    userId: id,
    role: "speaker",
    status: "confirmed",
    confirmedAt: at,
    declinedAt: null,
    declineReason: null,
    termsAcceptedAt: at,
    inviteExpiresAt: null,
    addedAt: at,
    profileComplete: false,
    hasHeadshot: false,
    hasBio: true,
  });
  return (
    <div class="pk-speaker-portrait-grid">
      <ProposalSpeakerCard
        speaker={speaker}
        proposalId={id}
        isCurrentProposer={proposer}
        replacementSpeakers={[]}
        endpoints={{ speakerPath: () => `/api/v1/proposals/${id}/speakers/${id}` }}
        onSaved={() => {}}
        onRemoved={() => {}}
      />
    </div>
  );
}
