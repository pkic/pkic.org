import { describe, expect, it } from "vitest";
import { prepareLegacyAgendaImport } from "../../scripts/lib/legacy-agenda-import.mjs";
import { agendaImportSchema } from "../../assets/shared/schemas/event-agenda";
import { agendaTransferSchema } from "../../assets/shared/schemas/event-agenda-transfer";

describe("authored legacy session track preservation", () => {
  it("retains only supplied subject labels in canonical and portable fields, independently of room and type", () => {
    const source = {
      timezone: "Europe/Amsterdam",
      agenda: {
        "2026-12-01": [
          {
            time: "09:00",
            durationMinutes: 30,
            sessions: [{ title: "Tracked session", speakers: [], locations: [], track: "  Governance  " }],
          },
          {
            time: "10:00",
            durationMinutes: 30,
            sessions: [{ title: "No authored track", speakers: [], locations: [] }],
          },
        ],
      },
    };
    const result = prepareLegacyAgendaImport(source, { sourcePath: "content/events/track-fixture/index.md" });
    expect(result.ready).toBe(true);
    const canonical = agendaImportSchema.parse(result.payload).occurrences;
    const portable = agendaTransferSchema.parse(result.document).occurrences;
    expect(canonical.map((row) => row.track)).toEqual(["Governance", null]);
    expect(portable.map((row) => row.fields.track)).toEqual(["Governance", null]);
    expect(canonical.every((row) => row.roomId === null && row.kind === "session")).toBe(true);
    expect(portable.every((row) => row.roomRefs.length === 0 && row.fields.kind === "session")).toBe(true);
  });
});
