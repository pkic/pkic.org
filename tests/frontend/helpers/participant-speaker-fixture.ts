import { speakerSelfServiceReadResponseSchema } from "../../../assets/shared/schemas/speaker-self-service";

export function participantSpeakerFixture() {
  const id = "00000000-0000-4000-8000-000000000041";
  return speakerSelfServiceReadResponseSchema.parse({
    speaker: {
      userId: id,
      role: "speaker",
      status: "invited",
      confirmedAt: null,
      declinedAt: null,
      termsAcceptedAt: null,
    },
    proposal: {
      id,
      title: "Speaker session",
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
      email: "ada@example.test",
      firstName: "Ada",
      lastName: "Lovelace",
      organizationName: null,
      jobTitle: null,
      biography: null,
      links: [],
      headshotUploaded: false,
      headshotUpdatedAt: null,
      headshotUrl: null,
      personalDetailsEditable: true,
      actingIdentityId: null,
      actingIdentitySelectedAt: null,
      actingIdentitySelection: "unrecorded",
    },
    currentRepresentation: null,
    presentationTerms: [],
    acceptedConsents: [],
  });
}
