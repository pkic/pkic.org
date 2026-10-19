import { transferPrepareSchema } from "../../assets/shared/schemas/event-agenda-transfer";
import {
  sessionHistoryMetadataSchema,
  sessionSourceDecisionSchema,
} from "../../assets/shared/schemas/event-session-history";
import { individualAppearanceFixture } from "./agenda-appearances";

export function historicalAgendaReviewInput(
  {
    actor,
    sourcePath,
    sourceDigest,
    sourceLocator,
    approvedAt,
  }: {
    actor: string;
    sourcePath: string;
    sourceDigest: string;
    sourceLocator: string;
    approvedAt: string;
  },
  placeholder = false,
) {
  return transferPrepareSchema.parse({
    expectedRevision: 0,
    mode: "archive",
    resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
    document: {
      format: "pkic-agenda",
      version: 1,
      source: { kind: "hugo", eventRef: "historical", exportedAt: approvedAt, sourceDigest },
      rooms: [],
      people: [
        {
          ref: "moderator",
          label: "Original moderator",
          canonicalUserId: actor,
          actingIdentityId: null,
          role: "moderator",
        },
        ...(placeholder
          ? []
          : [
              {
                ref: "Authored speaker",
                label: "Authored speaker",
                canonicalUserId: null,
                actingIdentityId: null,
                role: "speaker",
              },
            ]),
      ],
      occurrences: [
        {
          ref: "talk",
          sourceKey: "legacy:historical:talk",
          sourcePath,
          sourceDigest,
          sourceAnchor: "historical-talk",
          fields: {
            title: placeholder ? "Title not recorded" : "Historical talk",
            description: "Authored abstract",
            visibility: "public",
          },
          timing: {
            timeZone: "UTC",
            authoredDate: "2023-04-01",
            authoredStart: "10:00",
            startAt: "2023-04-01T10:00:00.000Z",
            endAt: "2023-04-01T11:00:00.000Z",
            endSource: "explicit",
            transitionMinutes: 0,
            transitionSource: "none",
          },
          roomRefs: [],
          personRefs: placeholder ? ["moderator"] : ["moderator", "Authored speaker"],
          media: [],
          archive: sessionHistoryMetadataSchema.parse({
            appearances: [
              individualAppearanceFixture({ userId: actor, displayName: "Original moderator", approvedAt }),
            ],
            legacyPaths: ["/events/historical/old-talk/"],
            archivalCredits: placeholder
              ? []
              : [
                  {
                    sourceRef: "Authored speaker",
                    displayName: "Authored speaker",
                    jobTitle: "Authored title",
                    organizationName: null,
                    biography: "Authored biography",
                    photoUrl: null,
                    sourcePath,
                    sourceDigest,
                    provenance: "authored_public",
                  },
                ],
            sourceDecisions: placeholder
              ? [
                  {
                    kind: "title",
                    sourcePath,
                    sourceDigest,
                    sourceLocator,
                    authoredValue: " ",
                    decision: "title_not_recorded",
                    resolvedValue: "Title not recorded",
                    reviewedAt: approvedAt,
                  },
                  {
                    kind: "credit",
                    sourcePath,
                    sourceDigest,
                    sourceLocator,
                    authoredValue: "TBC",
                    decision: "credit_not_recorded",
                    resolvedValue: null,
                    reviewedAt: approvedAt,
                  },
                ]
              : [],
            materials: [
              {
                id: "slides",
                kind: "presentation",
                title: "Original slides",
                url: "https://example.test/slides.pdf",
                presentationVersionId: null,
                version: 1,
                rightsConfirmed: true,
                consentConfirmed: true,
                validated: true,
                status: "approved",
                approvedAt,
              },
            ],
          }),
        },
      ],
    },
  });
}
export function mapHistoricalAgendaSpeaker(
  value: ReturnType<typeof historicalAgendaReviewInput>,
  speaker: string,
  approvedAt: string,
  placeholder = false,
) {
  const ref = placeholder ? "Verified speaker ref" : "Authored speaker",
    row = value.document.occurrences[0];
  value.document.people = value.document.people.filter((person) => person.ref !== ref);
  value.document.people.push({
    ref,
    label: "Verified speaker",
    canonicalUserId: speaker,
    actingIdentityId: null,
    role: "speaker",
  });
  row.personRefs = ["moderator", ref];
  row.archive!.archivalCredits = [];
  row.archive!.appearances.push(
    individualAppearanceFixture({ userId: speaker, displayName: "Verified speaker", approvedAt }),
  );
  if (placeholder) {
    row.fields.title = "Verified historical title";
    row.archive!.sourceDecisions = row.archive!.sourceDecisions.map((decision) =>
      sessionSourceDecisionSchema.parse({
        ...decision,
        decision: decision.kind === "title" ? "reviewed_title" : "reviewed_credit",
        resolvedValue: decision.kind === "title" ? row.fields.title : ref,
      }),
    );
  }
}
