import { describe, it, expect } from "vitest";
import { prepareLegacyAgendaImport } from "../../scripts/lib/legacy-agenda-import.mjs";
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
    expect(result.unresolved.map((item) => item.kind)).toEqual(["room", "speaker"]);
  });
  it("uses canonical IDs, shared timezone conversion and stable source keys", () => {
    const config = {
      sourcePath: "conference/_index.md",
      roomIds: { main: "canonical-room" },
      speakerUserIds: { Speaker: "canonical-person" },
    };
    const result = prepareLegacyAgendaImport(source, config);
    expect(result.ready).toBe(true);
    expect(agendaImportSchema.parse(result.payload).occurrences[0]).toMatchObject({
      startAt: "2026-12-01T08:00:00.000Z",
      endAt: "2026-12-01T08:30:00.000Z",
      roomId: "canonical-room",
      speakerUserIds: ["canonical-person"],
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
    roomIds: { main: "room" },
    speakerUserIds: { Speaker: "person" },
    presentationUrls: { "slides/*.pdf": "/events/conference/slides/talk.pdf" },
  });
  expect(result.ready).toBe(true);
  expect(agendaImportSchema.parse(result.payload).occurrences[0]).toMatchObject({
    presentationUrl: "/events/conference/slides/talk.pdf",
    recordingUrl: "https://www.youtube.com/watch?v=abcdefghijk",
  });
});
