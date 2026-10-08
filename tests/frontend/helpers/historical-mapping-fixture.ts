import { agendaHistoricalMetadataReviewSchema } from "../../../assets/shared/schemas/event-agenda-historical-review";

export const HISTORICAL_PERSON_ID = "33333333-3333-4333-8333-333333333333";
export const HISTORICAL_IDENTITY_ID = "44444444-4444-4444-8444-444444444444";

export function historicalMappingFixture() {
  const originalSource = {
    sourceRef: "source-speaker",
    sourcePath: "/events/archive/source.md",
    sourceDigest: "a".repeat(64),
  };
  return agendaHistoricalMetadataReviewSchema.parse({
    occurrenceId: "55555555-5555-4555-8555-555555555555",
    sourceKey: "archive:session",
    ...originalSource,
    sourceDigest: "b".repeat(64),
    originalSource,
    expectedHistoryDigest: "c".repeat(64),
    expectedProvenanceDigest: "d".repeat(64),
    originalMetadata: {
      archivalCredits: [
        {
          ...originalSource,
          provenance: "authored_public",
          displayName: "Authored Speaker",
          role: "speaker",
          organizationName: "Historical Organization",
          jobTitle: "Historical Role",
          biography: "Authored historical biography",
          photoUrl: null,
        },
      ],
      sourceDecisions: [
        {
          kind: "title",
          ...originalSource,
          sourceLocator: "session/title",
          authoredValue: null,
          decision: "title_not_recorded",
          resolvedValue: "Title not recorded",
          reviewedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      legacyPaths: ["/events/archive/session/"],
    },
    incomingMetadata: {
      appearances: [
        {
          userId: HISTORICAL_PERSON_ID,
          actingIdentityId: HISTORICAL_IDENTITY_ID,
          displayName: "Verified Historical Speaker",
          organizationName: "Verified Historical Organization",
          jobTitle: "Verified Historical Role",
          biography: "Verified source biography",
          photoUrl: null,
          approvedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      sourceDecisions: [
        {
          kind: "title",
          ...originalSource,
          sourceDigest: "b".repeat(64),
          sourceLocator: "session/title",
          authoredValue: null,
          decision: "reviewed_title",
          resolvedValue: "Verified historical title",
          reviewedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      legacyPaths: ["/events/archive/session/"],
    },
    people: [{ sourceRef: "source-speaker", userId: HISTORICAL_PERSON_ID, actingIdentityId: HISTORICAL_IDENTITY_ID }],
    reviewIssues: [],
  });
}
