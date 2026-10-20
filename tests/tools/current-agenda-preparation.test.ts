import { describe, expect, it } from "vitest";
import { prepareLegacyAgendaImport } from "../../scripts/lib/legacy-agenda-import.mjs";
import { agendaTransferSchema } from "../../assets/shared/schemas/event-agenda-transfer";

const userId = "22222222-2222-4222-8222-222222222222";
const identityId = "33333333-3333-4333-8333-333333333333";
const source = {
  timezone: "Europe/Amsterdam",
  speakers: [{ name: "Speaker", title: "Authored title", bio: "An authored biography is not current approval." }],
  agenda: {
    "2026-12-01": [
      { time: "09:00", durationMinutes: 30, sessions: [{ title: "Current talk", speakers: ["Speaker"] }] },
    ],
  },
};
const mappings = {
  mode: "current",
  sourcePath: "content/events/current/_index.md",
  people: { Speaker: { userId, actingIdentityId: identityId } },
};

describe("current agenda preparation", () => {
  it.each([identityId, null])(
    "retains the explicit acting identity %s without granting historical approval",
    (actingIdentityId) => {
      const result = prepareLegacyAgendaImport(source, {
        ...mappings,
        people: { Speaker: { userId, actingIdentityId } },
      });
      expect(result.ready).toBe(true);
      const document = agendaTransferSchema.parse(result.document);
      expect(document.people).toEqual([
        { ref: "Speaker", label: "Speaker", canonicalUserId: userId, actingIdentityId, role: "speaker" },
      ]);
      expect(document.occurrences[0].archive).toBeNull();
      expect(result.historicalCandidates).toEqual([]);
      expect(result.payload.occurrences[0].speakerUserIds).toEqual([userId]);
    },
  );

  it("requires an explicit current mapping even when an old approved appearance exists", () => {
    const result = prepareLegacyAgendaImport(source, {
      ...mappings,
      people: {},
      historicalPeople: {
        Speaker: { userId, actingIdentityId: identityId, approvedAt: "2023-01-01T00:00:00.000Z" },
      },
    });
    expect(result.ready).toBe(false);
    expect(result.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "speaker" })]));
    expect(result.document.people[0].canonicalUserId).toBeNull();
    expect(result.document.occurrences[0].archive).toBeNull();
  });

  it("rejects a current mapping that omits the acting-identity decision", () => {
    expect(() => prepareLegacyAgendaImport(source, { ...mappings, people: { Speaker: { userId } } })).toThrow();
  });

  it("preserves historical approval requirements for archive preparation", () => {
    const result = prepareLegacyAgendaImport(source, {
      ...mappings,
      mode: "archive",
      speakerUserIds: { Speaker: userId },
    });
    expect(result.ready).toBe(false);
    expect(result.unresolved).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "historical_representation" })]),
    );
  });
});
