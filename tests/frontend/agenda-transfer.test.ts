import { describe, it, expect } from "vitest";
import { normalizeAgendaTransfer, agendaTransferDigest } from "../../assets/shared/event-agenda-transfer";
import { transferPrepareSchema } from "../../assets/shared/schemas/event-agenda-transfer";
const user = crypto.randomUUID(),
  room = crypto.randomUUID(),
  secondRoom = crypto.randomUUID();
function input() {
  return transferPrepareSchema.parse({
    expectedRevision: 0,
    mode: "archive",
    resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
    document: {
      format: "pkic-agenda",
      version: 1,
      source: {
        kind: "portable",
        eventRef: "conference",
        exportedAt: "2026-10-04T10:00:00.000Z",
        sourceDigest: "a".repeat(64),
      },
      people: [{ ref: "person", label: "Alex", canonicalUserId: user, actingIdentityId: null, role: "moderator" }],
      rooms: [
        { ref: "main", label: "Main", canonicalRoomId: room },
        { ref: "overflow", label: "Overflow", canonicalRoomId: secondRoom },
      ],
      occurrences: [
        {
          ref: "talk",
          sourceKey: "portable:talk",
          sourceAnchor: "2026-talk",
          sourcePath: "/events/conference/",
          fields: {
            title: "Talk",
            speakerUserIds: [],
            kind: "session",
            visibility: "public",
            admissionPolicy: "reservation",
            capacity: 30,
          },
          timing: {
            timeZone: "Europe/Amsterdam",
            authoredDate: "2026-10-04",
            authoredStart: "12:00",
            startAt: "2026-10-04T10:00:00.000Z",
            endAt: "2026-10-04T11:00:00.000Z",
            endSource: "explicit",
            transitionMinutes: 0,
            transitionSource: "none",
          },
          roomRefs: ["main", "overflow"],
          personRefs: ["person"],
          media: [],
          archive: null,
        },
      ],
    },
  });
}
describe("reviewed agenda transfer", () => {
  it("retains multi-room placement and canonical moderator identity", () => {
    const result = normalizeAgendaTransfer(input());
    expect(result.findings).toEqual([]);
    expect(result.occurrences[0]).toMatchObject({
      roomId: room,
      additionalRoomIds: [secondRoom],
      speakerUserIds: [user],
      speakerRoles: { [user]: "moderator" },
    });
  });
  it("preserves a person's different credit roles in distinct occurrences", () => {
    const value = input();
    const original = value.document.occurrences[0]!;
    expect(original.personRoles).toEqual({});
    original.personRoles = { person: "speaker" };
    value.document.occurrences.push({
      ...structuredClone(original),
      ref: "panel",
      sourceKey: "portable:panel",
      sourceAnchor: "2026-panel",
      personRoles: { person: "moderator" },
    });
    const result = normalizeAgendaTransfer(value);
    expect(result.findings).toEqual([]);
    expect(result.occurrences.map((row) => row.speakerRoles)).toEqual([{ [user]: "speaker" }, { [user]: "moderator" }]);
  });
  it("rejects a credit role attached to a person absent from the occurrence", () => {
    const value = input();
    value.document.occurrences[0]!.personRoles = { absent: "moderator" };
    expect(normalizeAgendaTransfer(value)).toMatchObject({
      occurrences: [],
      findings: [expect.objectContaining({ code: "invalid_reference", field: "absent", severity: "blocking" })],
    });
  });
  it("keeps unresolved rows in the document but blocks normalization until explicitly mapped", () => {
    const value = input();
    value.document.people[0]!.canonicalUserId = null;
    expect(normalizeAgendaTransfer(value)).toMatchObject({
      occurrences: [],
      findings: [expect.objectContaining({ code: "person_unresolved", severity: "blocking" })],
    });
    value.resolutions.people.person = { userId: user, actingIdentityId: null };
    expect(normalizeAgendaTransfer(value).occurrences).toHaveLength(1);
  });
  it("copies substantive credits while clearing operational and publication authority", () => {
    const value = input();
    value.mode = "copy_as_new";
    expect(normalizeAgendaTransfer(value).occurrences[0]).toMatchObject({
      visibility: "private",
      startAt: null,
      endAt: null,
      roomId: null,
      additionalRoomIds: [],
      capacity: null,
      admissionPolicy: "preference",
      speakerUserIds: [user],
    });
  });
  it("requires reviewed inferred timing and allows explicit row skip", () => {
    const value = input();
    value.document.occurrences[0]!.timing.endSource = "next_start";
    expect(normalizeAgendaTransfer(value).findings[0]).toMatchObject({ code: "timing_inferred", severity: "review" });
    value.resolutions.rows.talk = "skip";
    expect(normalizeAgendaTransfer(value).occurrences).toHaveLength(0);
  });
  it("binds review digest to mapping and revision", async () => {
    const value = input(),
      before = await agendaTransferDigest(value);
    value.expectedRevision++;
    expect(await agendaTransferDigest(value)).not.toBe(before);
  });
});
