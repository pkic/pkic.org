import { serializeStructuredData } from "../../assets/shared/site-structured-data";
import {
  sessionHistoryStructuredData,
  speakerHistoryStructuredData,
} from "../../functions/_lib/services/site-history-structured-data";
import { publicSessionMediaUrlSchema } from "../../assets/shared/schemas/event-session-history";
import { describe, it, expect } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import {
  publishedSessionHistory,
  publishedSpeakerHistory,
  sessionHistoryRedirects,
} from "../../functions/_lib/services/site-session-history";
import { publicSessionMaterials } from "../../assets/shared/schemas/event-session-history";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(new URL("../fixtures/site-publication.json", import.meta.url), "utf8"));
const appearance = (organizationName: string) => ({
  userId: "person",
  actingIdentityId: null,
  displayName: "Speaker",
  jobTitle: "Engineer",
  organizationName,
  biography: "Approved biography",
  photoUrl: null,
  approvedAt: "2026-10-03T00:00:00.000Z",
});
const session = (id: string, organizationName: string) => ({
  id,
  title: "Cryptographic operations",
  description: "An in-depth session about practical cryptographic operations and engineering.",
  startAt: "2026-10-03T09:00:00.000Z",
  endAt: "2026-10-03T10:00:00.000Z",
  roomId: null,
  speakers: [{ userId: "person", displayName: "Speaker" }],
  history: { appearances: [appearance(organizationName)], legacyPaths: [`/events/legacy/${id}/`] },
});
const agenda = (eventSlug: string, organization: string) =>
  agendaSnapshotSchema.parse({
    eventSlug,
    timeZone: "Europe/Amsterdam",
    revision: 1,
    publishedRevision: 1,
    rooms: [],
    blocks: [],
    roleMembers: [],
    assignments: [],
    occurrences: [
      session("session", organization),
      { ...session("private", organization), visibility: "private" },
      { ...session("break", organization), kind: "break" },
      { ...session("thin", organization), description: "" },
    ],
  });
describe("approved session archives", () => {
  it("emits script-safe structured data only for visible approved recordings and frozen people", () => {
    const current = agenda("first", "Historical employer");
    current.occurrences[0]!.title = "Title </script><script>bad()</script>";
    current.occurrences[0]!.history!.materials = [
      {
        id: "video",
        kind: "recording",
        title: "Approved recording",
        url: "/recording.mp4",
        presentationVersionId: null,
        legacyDownloadUrl: null,
        presentationSource: "proposal",
        version: 1,
        rightsConfirmed: true,
        consentConfirmed: true,
        validated: true,
        status: "approved",
        approvedAt: "2026-10-03T00:00:00.000Z",
      },
      {
        id: "private-video",
        kind: "recording",
        title: "Withdrawn recording",
        url: "/withdrawn.mp4",
        presentationVersionId: null,
        legacyDownloadUrl: null,
        presentationSource: "proposal",
        version: 1,
        rightsConfirmed: true,
        consentConfirmed: true,
        validated: true,
        status: "withdrawn",
        approvedAt: null,
      },
    ];
    const publication = sitePublicationSnapshotSchema.parse({ ...fixture, eventAgendas: { first: current } });
    const item = publishedSessionHistory(publication)[0]!;
    const graph = sessionHistoryStructuredData(item, "https://pkic.org");
    expect(graph["@graph"].filter((node) => node["@type"] === "VideoObject")).toHaveLength(1);
    expect(JSON.stringify(graph)).not.toContain("withdrawn.mp4");
    const serialized = serializeStructuredData(graph);
    expect(serialized).not.toContain("</script><script>bad");
    expect(serialized).toContain("\\u003c/script>");
    expect(JSON.parse(serialized)["@graph"][0].name).toBe(current.occurrences[0]!.title);
    expect(
      speakerHistoryStructuredData(publishedSpeakerHistory(publication)[0]!, "https://pkic.org").mainEntity.subjectOf,
    ).toHaveLength(1);
  });

  it("keeps two employer credits frozen across events without leaking private or thin sessions", () => {
    const publication = sitePublicationSnapshotSchema.parse({
      ...fixture,
      eventAgendas: { first: agenda("first", "Old employer"), second: agenda("second", "New employer") },
    });
    const sessions = publishedSessionHistory(publication);
    expect(sessions).toHaveLength(2);
    const person = publishedSpeakerHistory(publication)[0]!;
    expect(person.appearances.map((item) => item.appearances[0]?.organizationName)).toEqual([
      "Old employer",
      "New employer",
    ]);
    expect(person.route).toBe("/people/person/");
    expect(sessionHistoryRedirects(publication)).toHaveLength(2);
    expect(sessions[0]!.route).toBe("/events/first/sessions/session/");
  });
  it("requires approved version, rights, consent, validation and timestamp independently", () => {
    const material = {
      id: "material",
      kind: "presentation" as const,
      title: "Slides",
      url: "/slides.pdf",
      presentationVersionId: "version",
      legacyDownloadUrl: null,
      presentationSource: "proposal" as const,
      version: 1,
      rightsConfirmed: true,
      consentConfirmed: true,
      validated: true,
      status: "approved" as const,
      approvedAt: "2026-10-03T00:00:00.000Z",
    };
    expect(publicSessionMaterials([material])).toEqual([material]);
    for (const patch of [
      { rightsConfirmed: false },
      { consentConfirmed: false },
      { validated: false },
      { approvedAt: null },
      { status: "withdrawn" as const },
      { status: "failed" as const },
      { status: "draft" as const },
    ])
      expect(publicSessionMaterials([{ ...material, ...patch }])).toEqual([]);
  });
  it("rejects management/download capabilities in approved public media metadata", () => {
    for (const url of [
      "/portal/#/private",
      "/api/v1/private/file",
      "https://example.test/slides.pdf?token=secret",
      "https://example.test/slides.pdf?X-Amz-Signature=secret",
    ])
      expect(publicSessionMediaUrlSchema.safeParse(url).success).toBe(false);
    expect(publicSessionMediaUrlSchema.parse("/events/conference/slides.pdf")).toBe("/events/conference/slides.pdf");
    expect(publicSessionMediaUrlSchema.parse("https://youtube.com/watch?v=public")).toBe(
      "https://youtube.com/watch?v=public",
    );
  });
});
