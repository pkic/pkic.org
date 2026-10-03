import { describe, expect, it } from "vitest";
import { applyApprovedAgenda } from "../../functions/_lib/services/site-approved-agenda";
import { publishedConferenceProgram } from "../../functions/_lib/services/site-conference-program";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { conferenceAgendaCalendar } from "../../functions/_lib/services/site-conference-calendar";

describe("approved agenda static projection", () => {
  it("uses frozen public occurrences consistently in public data and calendar, retaining speaker assets", () => {
    const authored = publishedConferenceProgram(
      {
        name: "Conference",
        timezone: "Europe/Amsterdam",
        agenda: {},
        locations: { oldHall: { name: "Main hall", color: "navy" } },
        speakers: [{ name: "Speaker" }],
      },
      () => ["/speaker.jpg"],
    );
    const snapshot = agendaSnapshotSchema.parse({
      eventSlug: "conference",
      timeZone: "Europe/Amsterdam",
      revision: 4,
      publishedRevision: 4,
      rooms: [{ id: "hall", name: "Main hall", capacity: 500 }],
      blocks: [],
      assignments: [],
      roleMembers: [],
      occurrences: [
        {
          id: "public",
          title: "Approved workshop",
          presentationUrl: "/slides.pdf",
          recordingUrl: "https://example.test/recording",
          description: "Description",
          startAt: "2026-10-03T07:00:00.000Z",
          endAt: "2026-10-03T08:00:00.000Z",
          roomId: "hall",
          speakers: [{ userId: "speaker", displayName: "Speaker" }],
        },
        {
          id: "private",
          title: "Private draft",
          visibility: "private",
          startAt: "2026-10-03T08:00:00.000Z",
          endAt: "2026-10-03T09:00:00.000Z",
          roomId: "hall",
          speakers: [],
        },
        { id: "unscheduled", title: "Unscheduled draft", startAt: null, endAt: null, roomId: null, speakers: [] },
      ],
    });
    const program = applyApprovedAgenda(authored, snapshot);
    expect(program.agenda["2026-10-03"]?.[0]?.time).toBe("09:00");
    expect(program.agenda["2026-10-03"]?.[0]?.sessions[0]).toMatchObject({
      id: "public",
      title: "Approved workshop",
      presentation: "/slides.pdf",
      recordingUrl: "https://example.test/recording",
      endsAt: "2026-10-03T08:00:00.000Z",
    });
    expect(program.locations.hall).toEqual({ name: "Main hall", color: "navy" });
    expect(program.speakers[0]?.headshot?.x250).toBe("/speaker.jpg");
    const calendar = conferenceAgendaCalendar(program, "https://example.test/conference/", "2026-10-03T00:00:00.000Z");
    expect(calendar).toContain("Approved workshop");
    expect(calendar).not.toContain("Private draft");
    expect(calendar).not.toContain("Unscheduled draft");
    expect(applyApprovedAgenda(authored)).toBe(authored);
  });
});
