import { describe, it, expect } from "vitest";
import { prepareLegacyAgendaImport } from "../../scripts/lib/legacy-agenda-import.mjs";
import { agendaTransferSchema } from "../../assets/shared/schemas/event-agenda-transfer";
import {
  legacyAgendaSourcePath,
  readLegacyAgendaSource,
  legacyAgendaDocuments,
  legacyAgendaEventReport,
} from "../../scripts/lib/legacy-agenda-preparation.mjs";
import { agendaImportSchema } from "../../assets/shared/schemas/event-agenda";
const source = {
  timezone: "Europe/Amsterdam",
  agenda: {
    "2026-12-01": [
      {
        time: "09:00",
        durationMinutes: 30,
        sessions: [{ title: "Talk", locations: ["main"], speakers: ["Speaker *"], description: "Summary" }],
      },
    ],
  },
};
describe("explicit legacy agenda migration", () => {
  it("reports unmapped people and rooms rather than creating identities", () => {
    const result = prepareLegacyAgendaImport(source, { sourcePath: "conference/_index.md" });
    expect(result.ready).toBe(false);
    expect(result.payload.occurrences).toHaveLength(0);
    expect(result.unresolved.map((item) => item.kind).sort()).toEqual(["room", "speaker"]);
  });
  it("uses canonical IDs, shared timezone conversion and stable source keys", () => {
    const config = {
      sourcePath: "conference/_index.md",
      roomIds: { main: "11111111-1111-4111-8111-111111111111" },
      speakerUserIds: { Speaker: "22222222-2222-4222-8222-222222222222" },
    };
    const result = prepareLegacyAgendaImport(source, config);
    expect(result.ready).toBe(true);
    expect(agendaImportSchema.parse(result.payload).occurrences[0]).toMatchObject({
      startAt: "2026-12-01T08:00:00.000Z",
      endAt: "2026-12-01T08:30:00.000Z",
      roomId: "11111111-1111-4111-8111-111111111111",
      speakerUserIds: ["22222222-2222-4222-8222-222222222222"],
    });
    const edited = {
      ...source,
      agenda: {
        "2026-12-01": [
          {
            ...source.agenda["2026-12-01"][0],
            sessions: [{ ...source.agenda["2026-12-01"][0].sessions[0], title: "Edited title" }],
          },
        ],
      },
    };
    expect(prepareLegacyAgendaImport(edited, config).payload.occurrences[0].sourceKey).toBe(
      result.payload.occurrences[0].sourceKey,
    );
  });
});

it("preserves explicitly mapped slides and recording URLs", () => {
  const withMedia = {
    ...source,
    agenda: {
      "2026-12-01": [
        {
          ...source.agenda["2026-12-01"][0],
          sessions: [
            { ...source.agenda["2026-12-01"][0].sessions[0], presentation: "slides/*.pdf", youtube: "abcdefghijk" },
          ],
        },
      ],
    },
  };
  const result = prepareLegacyAgendaImport(withMedia, {
    sourcePath: "conference/_index.md",
    roomIds: { main: "11111111-1111-4111-8111-111111111111" },
    speakerUserIds: { Speaker: "22222222-2222-4222-8222-222222222222" },
    presentationUrls: { "slides/*.pdf": "/events/conference/slides/talk.pdf" },
  });
  expect(result.ready).toBe(true);
  expect(agendaImportSchema.parse(result.payload).occurrences[0]).toMatchObject({
    presentationUrl: "/events/conference/slides/talk.pdf",
    recordingUrl: "https://www.youtube.com/watch?v=abcdefghijk",
  });
});

it("retains unresolved source rows for reviewed mapping and supports multiple mapped rooms", () => {
  const multi = {
    ...source,
    agenda: {
      "2026-12-01": [
        {
          ...source.agenda["2026-12-01"][0],
          sessions: [
            { ...source.agenda["2026-12-01"][0].sessions[0], id: "2026-talk", locations: ["main", "overflow"] },
          ],
        },
      ],
    },
  };
  const unresolved = prepareLegacyAgendaImport(multi, { sourcePath: "conference/_index.md" });
  expect(unresolved.document.occurrences).toHaveLength(1);
  expect(unresolved.document.people[0].canonicalUserId).toBeNull();
  const mapped = prepareLegacyAgendaImport(multi, {
    sourcePath: "conference/_index.md",
    roomIds: { main: "11111111-1111-4111-8111-111111111111", overflow: "33333333-3333-4333-8333-333333333333" },
    speakerUserIds: { Speaker: "22222222-2222-4222-8222-222222222222" },
  });
  expect(mapped.payload.occurrences[0]).toMatchObject({
    roomId: "11111111-1111-4111-8111-111111111111",
    additionalRoomIds: ["33333333-3333-4333-8333-333333333333"],
  });
  expect(mapped.document.occurrences[0]).toMatchObject({
    sourceAnchor: "2026-talk",
    timing: { timeZone: "Europe/Amsterdam", endSource: "duration" },
  });
});

it("preserves authored historical credits for explicit approval without inferring an employer", () => {
  const authored = {
    ...source,
    speakers: [
      {
        name: "Speaker",
        title: "Engineer at Past Employer",
        bio: "Original biography",
        social: { linkedin: "https://example.test/original" },
      },
    ],
  };
  const mappings = {
    sourcePath: "content/events/conference/_index.md",
    roomIds: { main: "11111111-1111-4111-8111-111111111111" },
    speakerUserIds: { Speaker: "22222222-2222-4222-8222-222222222222" },
  };
  const pending = prepareLegacyAgendaImport(authored, mappings);
  expect(pending.ready).toBe(false);
  expect(pending.historicalCandidates[0]).toMatchObject({
    appearance: {
      jobTitle: "Engineer at Past Employer",
      organizationName: null,
      biography: "Original biography",
      approvedAt: null,
    },
    authored: { social: { linkedin: "https://example.test/original" } },
  });
  expect(pending.document.occurrences[0].archive).toBeNull();
  const reviewed = prepareLegacyAgendaImport(authored, {
    ...mappings,
    historicalPeople: {
      Speaker: {
        userId: "22222222-2222-4222-8222-222222222222",
        actingIdentityId: "44444444-4444-4444-8444-444444444444",
        organizationName: "Past Employer",
        approvedAt: "2026-12-02T00:00:00.000Z",
      },
    },
  });
  expect(reviewed.ready).toBe(true);
  expect(reviewed.document.people[0].actingIdentityId).toBe("44444444-4444-4444-8444-444444444444");
  expect(reviewed.document.occurrences[0].archive?.appearances[0]).toMatchObject({
    organizationName: "Past Employer",
    biography: "Original biography",
    approvedAt: "2026-12-02T00:00:00.000Z",
  });
});

it("blocks invalid canonical mappings and empty agenda documents", () => {
  const invalid = prepareLegacyAgendaImport(source, {
    sourcePath: "conference/_index.md",
    roomIds: { main: "invented-room" },
    speakerUserIds: { Speaker: "invented-person" },
  });
  expect(invalid.ready).toBe(false);
  expect(invalid.unresolved.some((finding) => finding.kind === "contract")).toBe(true);
  expect(
    prepareLegacyAgendaImport({ timezone: "Europe/Amsterdam" }, { sourcePath: "conference/_index.md" }).ready,
  ).toBe(false);
});

it("unwraps Markdown and standalone YAML consistently and normalizes absolute provenance", () => {
  const yaml = "title: Historical conference\ndata:\n  timezone: Europe/Amsterdam\n  agenda: {}\n";
  expect(readLegacyAgendaSource(`---\n${yaml}---\nBody`, "index.md").source).toEqual(
    readLegacyAgendaSource(yaml, "event.yaml").source,
  );
  expect(readLegacyAgendaSource("timezone: Europe/Amsterdam\nagenda: {}\n", "event.yaml").source).toEqual({
    timezone: "Europe/Amsterdam",
    agenda: {},
  });
  expect(legacyAgendaSourcePath(`${process.cwd()}/content/events/conference/index.md`, process.cwd())).toBe(
    "content/events/conference/index.md",
  );
  expect(() => legacyAgendaSourcePath("/outside/event.md", process.cwd())).toThrow("repository root");
});

it("splits large historical preparation into independently valid bounded documents", () => {
  const many = {
    ...source,
    agenda: {
      "2026-12-01": Array.from({ length: 101 }, (_, index) => ({
        ...source.agenda["2026-12-01"][0],
        sessions: [{ ...source.agenda["2026-12-01"][0].sessions[0], id: `talk-${index}` }],
      })),
    },
  };
  const result = prepareLegacyAgendaImport(many, {
    sourcePath: "conference/index.md",
    roomIds: { main: "11111111-1111-4111-8111-111111111111" },
    speakerUserIds: { Speaker: "22222222-2222-4222-8222-222222222222" },
  });
  expect(result.ready).toBe(true);
  const parts = legacyAgendaDocuments(result.document).map((part) => agendaTransferSchema.parse(part));
  expect(parts.map((part) => part.occurrences.length)).toEqual([100, 1]);
  expect(new Set(parts.flatMap((part) => part.occurrences.map((row) => row.sourceKey))).size).toBe(101);
});

it("reports event mapping as unverified preparation and never database completion", () => {
  const missing = legacyAgendaEventReport(
    { title: "Historical conference" },
    source,
    "content/events/conference/index.md",
    {},
  );
  expect(missing).toMatchObject({
    state: "mapping_required",
    applied: false,
    authored: { title: "Historical conference", firstAgendaDate: "2026-12-01" },
  });
  const mapped = legacyAgendaEventReport({}, source, "content/events/conference/index.md", {
    event: { eventId: "11111111-1111-4111-8111-111111111111", eventSlug: "conference" },
  });
  expect(mapped).toMatchObject({ state: "mapped_unverified", applied: false });
});

it("retains explicitly selected public source credits without inventing identities or approvals", () => {
  const historical = { ...source, speakers: [{ name: "Speaker", title: "Original role", bio: "Original bio" }] };
  const result = prepareLegacyAgendaImport(historical, {
    sourcePath: "conference/index.md",
    archivePublicSource: true,
    historicalPeople: { Speaker: { photoUrl: "/content-media/events/source/speakers/speaker.jpg" } },
    roomIds: { main: "11111111-1111-4111-8111-111111111111" },
  });
  const document = agendaTransferSchema.parse(result.document);
  expect(document.people[0]!.canonicalUserId).toBeNull();
  expect(document.occurrences[0]!.archive!.appearances).toEqual([]);
  expect(document.occurrences[0]!.archive!.archivalCredits[0]).toMatchObject({
    sourceRef: "Speaker",
    role: "moderator",
    photoUrl: "/content-media/events/source/speakers/speaker.jpg",
    displayName: "Speaker",
    jobTitle: "Original role",
    biography: "Original bio",
    sourcePath: "conference/index.md",
    sourceDigest: document.source.sourceDigest,
    provenance: "authored_public",
  });
  expect(document.occurrences[0]!.archive!.archivalCredits[0]).not.toHaveProperty("approvedAt");
  expect(result.unresolved).toEqual([]);
});

it("preserves an explicitly selected historical source start without inventing a final duration", () => {
  const historical = {
    timezone: "America/Toronto",
    agenda: { "2023-03-03": [{ time: "15:30", title: "Networking" }] },
  };
  const result = prepareLegacyAgendaImport(historical, {
    sourcePath: "conference/index.md",
    archivePublicSource: true,
  });
  const row = agendaTransferSchema.parse(result.document).occurrences[0]!;
  expect(row.timing.endAt).toBeNull();
  expect(row.timing.endSource).toBe("unresolved");
  expect(row.archive!.archivalTiming).toMatchObject({
    startAt: "2023-03-03T20:30:00.000Z",
    endAt: null,
    timeZone: "America/Toronto",
    sourceDigest: result.document.source.sourceDigest,
  });
  expect(result.unresolved).toEqual([]);
});

it("requires reviewed row decisions for null and whitespace titles and placeholder credits", () => {
  const authored = {
    timezone: "Europe/Amsterdam",
    agenda: {
      "2023-11-07": [
        {
          time: "11:20",
          durationMinutes: 20,
          sessions: [
            { title: " ", speakers: ["None"] },
            { title: null, speakers: [] },
          ],
        },
      ],
    },
  };
  const config = { sourcePath: "conference/index.md", archivePublicSource: true };
  const pending = prepareLegacyAgendaImport(authored, config);
  expect(pending.ready).toBe(false);
  expect(pending.unresolved.filter((finding) => finding.kind === "source_decision")).toHaveLength(2);
  const sourceDigest = pending.document.source.sourceDigest;
  const reviewed = prepareLegacyAgendaImport(authored, {
    ...config,
    sourceRows: {
      "2023-11-07:0:0": {
        sourceDigest,
        title: { decision: "title_not_recorded", reviewedAt: "2026-10-04T00:00:00.000Z" },
        credits: { None: { decision: "credit_not_recorded", reviewedAt: "2026-10-04T00:00:00.000Z" } },
      },
      "2023-11-07:0:1": {
        sourceDigest,
        title: { decision: "reviewed_title", value: "Reviewed continuation", reviewedAt: "2026-10-04T00:00:00.000Z" },
      },
    },
  });
  expect(reviewed.ready).toBe(true);
  expect(reviewed.document.people).toEqual([]);
  expect(reviewed.document.occurrences.map((row) => row.sourceKey)).toEqual(
    pending.document.occurrences.map((row) => row.sourceKey),
  );
  expect(reviewed.sourceDecisions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ authoredValue: " ", decision: "title_not_recorded" }),
      expect.objectContaining({ authoredValue: "None", resolvedValue: null, decision: "credit_not_recorded" }),
    ]),
  );
  expect(agendaTransferSchema.parse(reviewed.document).occurrences[0]!.fields.title).toBe("Title not recorded");
  const stale = prepareLegacyAgendaImport(authored, {
    ...config,
    sourceRows: {
      "2023-11-07:0:0": {
        sourceDigest: "0".repeat(64),
        title: { decision: "title_not_recorded", reviewedAt: "2026-10-04T00:00:00.000Z" },
      },
    },
  });
  expect(stale.ready).toBe(false);
});

it("requires distinct reviewed keys for same-start source rows and preserves inferred unknown archival ends", () => {
  const authored = {
    timezone: "Asia/Kuala_Lumpur",
    agenda: {
      "2025-10-30": [
        { time: "17:00", sessions: [{ title: "Closing" }] },
        { time: "17:00", title: "End of day" },
      ],
    },
  };
  const config = { sourcePath: "conference/index.md", archivePublicSource: true };
  const pending = prepareLegacyAgendaImport(authored, config);
  expect(pending.unresolved.some((finding) => finding.kind === "source_key")).toBe(true);
  const mapped = prepareLegacyAgendaImport(authored, {
    ...config,
    sourceRows: {
      "2025-10-30:1:0": {
        sourceDigest: pending.document.source.sourceDigest,
        sourceKey: "legacy:reviewed-end-of-day",
        reviewedAt: "2026-10-04T00:00:00.000Z",
      },
    },
  });
  expect(mapped.ready).toBe(true);
  expect(mapped.document.occurrences[0]!.sourceKey).toBe(pending.document.occurrences[0]!.sourceKey);
  expect(
    mapped.document.occurrences.every(
      (row) =>
        row.timing.endAt === null &&
        row.timing.endSource === "unresolved" &&
        row.archive?.archivalTiming?.endAt === null,
    ),
  ).toBe(true);
  const explicitZero = {
    ...authored,
    agenda: { "2025-10-30": [{ time: "17:00", durationMinutes: 0, sessions: [{ title: "Closing" }] }] },
  };
  expect(
    prepareLegacyAgendaImport(explicitZero, config).unresolved.some((finding) => finding.kind === "duration"),
  ).toBe(true);
});

it("retains an explicitly reviewed source-only agenda credit without a fabricated speaker record", () => {
  const authored = {
    timezone: "Asia/Kuala_Lumpur",
    agenda: {
      "2025-10-28": [
        { time: "09:00", durationMinutes: 30, sessions: [{ title: "Workshop", speakers: ["Robert Grapes"] }] },
      ],
    },
  };
  const config = { sourcePath: "conference/index.md", archivePublicSource: true };
  const pending = prepareLegacyAgendaImport(authored, config);
  expect(pending.ready).toBe(false);
  const result = prepareLegacyAgendaImport(authored, {
    ...config,
    sourceRows: {
      "2025-10-28:0:0": {
        sourceDigest: pending.document.source.sourceDigest,
        credits: { "Robert Grapes": { decision: "retain_source_credit", reviewedAt: "2026-10-04T00:00:00.000Z" } },
      },
    },
  });
  expect(result.ready).toBe(true);
  expect(result.document.people[0]!.canonicalUserId).toBeNull();
  expect(result.document.occurrences[0]!.archive!.archivalCredits[0]).toMatchObject({
    displayName: "Robert Grapes",
    biography: "",
    jobTitle: null,
  });
});

it.each(["None", "TBC", "TBD", "", " "])(
  "resolves verified placeholder %j to an approved historical person without losing provenance",
  (placeholder) => {
    const authored = {
      timezone: "Europe/Amsterdam",
      agenda: {
        "2023-11-07": [
          {
            time: "09:00",
            durationMinutes: 30,
            sessions: [{ title: "Recorded session", speakers: [`${placeholder} *`] }],
          },
        ],
      },
    };
    const config = { sourcePath: "conference/index.md", archivePublicSource: true };
    const pending = prepareLegacyAgendaImport(authored, config);
    const result = prepareLegacyAgendaImport(authored, {
      ...config,
      sourceRows: {
        "2023-11-07:0:0": {
          sourceDigest: pending.document.source.sourceDigest,
          credits: {
            [placeholder]: {
              decision: "reviewed_credit",
              resolvedValue: "Verified speaker",
              reviewedAt: "2026-10-04T00:00:00.000Z",
            },
          },
        },
      },
      historicalPeople: {
        "Verified speaker": {
          userId: "22222222-2222-4222-8222-222222222222",
          actingIdentityId: null,
          displayName: "Approved historical name",
          organizationName: "Verified historical organization",
          approvedAt: "2026-10-03T00:00:00.000Z",
        },
      },
    });
    expect(result.ready).toBe(true);
    const row = agendaTransferSchema.parse(result.document).occurrences[0]!;
    expect(row.personRefs).toEqual(["Verified speaker"]);
    expect(row.sourceKey).toBe(pending.document.occurrences[0]!.sourceKey);
    expect(result.document.people).toEqual([
      expect.objectContaining({
        ref: "Verified speaker",
        canonicalUserId: "22222222-2222-4222-8222-222222222222",
        actingIdentityId: null,
        role: "moderator",
      }),
    ]);
    expect(row.archive!.appearances[0]).toMatchObject({
      displayName: "Approved historical name",
      userId: "22222222-2222-4222-8222-222222222222",
      actingIdentityId: null,
      approvedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(row.archive!.sourceDecisions[0]).toMatchObject({
      kind: "credit",
      authoredValue: placeholder,
      decision: "reviewed_credit",
      resolvedValue: "Verified speaker",
      sourceLocator: row.ref,
      sourcePath: config.sourcePath,
      sourceDigest: result.document.source.sourceDigest,
    });
  },
);

it("refuses verified credit mappings without explicit valid canonical approval evidence", () => {
  const authored = {
    timezone: "Europe/Amsterdam",
    agenda: {
      "2023-11-07": [
        { time: "09:00", durationMinutes: 30, sessions: [{ title: "Recorded session", speakers: ["None"] }] },
      ],
    },
  };
  const config = { sourcePath: "conference/index.md", archivePublicSource: true };
  const sourceDigest = prepareLegacyAgendaImport(authored, config).document.source.sourceDigest;
  const approved = {
    userId: "22222222-2222-4222-8222-222222222222",
    actingIdentityId: null,
    approvedAt: "2026-10-03T00:00:00.000Z",
  };
  const invalidPeople = [
    undefined,
    { userId: approved.userId, approvedAt: approved.approvedAt },
    { ...approved, userId: "invented" },
    { ...approved, actingIdentityId: "invented" },
    { ...approved, approvedAt: "2026-10-03" },
    { ...approved, approvedAt: "2099-01-01T00:00:00.000Z" },
  ];
  for (const person of invalidPeople) {
    const result = prepareLegacyAgendaImport(authored, {
      ...config,
      sourceRows: {
        "2023-11-07:0:0": {
          sourceDigest,
          credits: {
            None: {
              decision: "reviewed_credit",
              resolvedValue: "Verified speaker",
              reviewedAt: "2026-10-04T00:00:00.000Z",
            },
          },
        },
      },
      historicalPeople: { "Verified speaker": person },
    });
    expect(result.ready).toBe(false);
    expect(result.document.occurrences[0]!.personRefs).toEqual(["None"]);
    expect(result.document.occurrences[0]!.archive?.sourceDecisions ?? []).toEqual([]);
    expect(result.unresolved.some((finding) => finding.kind === "source_decision")).toBe(true);
  }
});

it("retains each authored speaker role independently of the last global person entry", () => {
  const authored = {
    timezone: "Europe/Amsterdam",
    speakers: [{ name: "Speaker" }],
    agenda: {
      "2023-11-07": [
        { time: "09:00", durationMinutes: 30, sessions: [{ title: "Presentation", speakers: ["Speaker"] }] },
        { time: "10:00", durationMinutes: 30, sessions: [{ title: "Moderated discussion", speakers: ["Speaker *"] }] },
      ],
    },
  };
  const result = prepareLegacyAgendaImport(authored, { sourcePath: "conference/index.md", archivePublicSource: true });
  expect(result.ready).toBe(true);
  const document = agendaTransferSchema.parse(result.document);
  expect(document.people[0]!.role).toBe("moderator");
  expect(document.occurrences.map((row) => row.personRoles)).toEqual([
    { Speaker: "speaker" },
    { Speaker: "moderator" },
  ]);
  expect(document.occurrences.map((row) => row.archive!.archivalCredits[0]!.role)).toEqual(["speaker", "moderator"]);
});
