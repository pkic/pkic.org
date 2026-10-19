import { describe, expect, it } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import {
  defaultLiveSession,
  liveSessionDays,
  liveRoomChoices,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-session-choices";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";

function session(id: string, title: string, startAt: string, endAt: string, roomId: string, extra = {}) {
  return { id, title, description: "", startAt, endAt, roomId, speakers: [], ...extra };
}

const program = agendaSnapshotSchema.parse({
  ...approvedAgendaSnapshot,
  rooms: [
    { id: "hall", name: "Main hall", capacity: 100 },
    { id: "annex", name: "Annex", capacity: 40 },
  ],
  occurrences: [
    session("opening", "Opening", "2026-12-01T09:00:00.000Z", "2026-12-01T10:00:00.000Z", "hall"),
    session("lunch", "Lunch", "2026-12-01T11:00:00.000Z", "2026-12-01T12:00:00.000Z", "hall", { kind: "break" }),
    session("tba", "To be announced", "2026-12-01T13:00:00.000Z", "2026-12-01T13:25:00.000Z", "hall", {
      placeholder: true,
    }),
    session("workshop", "Workshop", "2026-12-01T13:00:00.000Z", "2026-12-01T14:00:00.000Z", "annex"),
    // Listed after the annex workshop at the same time; the picker still follows the room order.
    session("talk", "Talk", "2026-12-01T13:00:00.000Z", "2026-12-01T14:00:00.000Z", "hall"),
    session("closing", "Closing", "2026-12-02T15:00:00.000Z", "2026-12-02T16:00:00.000Z", "hall"),
  ],
});

describe("live control room session picker", () => {
  it("groups sessions under their weekday, by time and then room order, without placeholders or breaks", () => {
    const days = liveSessionDays(program);
    expect(days.map((day) => day.date)).toEqual(["2026-12-01", "2026-12-02"]);
    expect(days.map((day) => day.label)).toEqual(["Tue Dec 1", "Wed Dec 2"]);
    expect(days.map((day) => day.choices.map((choice) => choice.label))).toEqual([
      ["Main hall · 10:00 · Opening", "Main hall · 14:00 · Talk", "Annex · 14:00 · Workshop"],
      ["Main hall · 16:00 · Closing"],
    ]);
  });

  it("opens on the session on now, or next, in the operator's room", () => {
    const days = liveSessionDays(program);
    const duringOpening = Date.parse("2026-12-01T09:30:00.000Z");
    expect(defaultLiveSession(days, duringOpening, null)?.id).toBe("opening");
    expect(defaultLiveSession(days, duringOpening, "annex")?.id).toBe("workshop");
    expect(defaultLiveSession(days, Date.parse("2026-12-01T12:00:00.000Z"), "hall")?.id).toBe("talk");
    expect(defaultLiveSession(days, Date.parse("2026-12-01T14:30:00.000Z"), "hall")?.id).toBe("closing");
    expect(defaultLiveSession(days, Date.parse("2026-12-03T00:00:00.000Z"), null)).toBeUndefined();
  });
  it("offers now and next first within the selected room", () => {
    const groups = liveRoomChoices(liveSessionDays(program), "hall", Date.parse("2026-12-01T09:30:00Z"));
    expect(groups.map((group) => group.label)).toEqual(["Now", "Next", "Other sessions"]);
    expect(groups.flatMap((group) => group.choices.map((choice) => choice.id))).toEqual(["opening", "talk", "closing"]);
  });
  it("finds a combined-room session from either participating room", () => {
    const choice = {
      id: "combined",
      roomId: "hall",
      roomIds: ["hall", "annex"],
      title: "Combined",
      label: "Combined",
      startsAt: "2026-12-01T09:00:00Z",
      endsAt: "2026-12-01T10:00:00Z",
    };
    const days = [{ date: "2026-12-01", label: "Tuesday", choices: [choice] }];
    expect(liveRoomChoices(days, "annex", Date.parse("2026-12-01T09:30:00Z"))[0].choices[0].id).toBe("combined");
    expect(defaultLiveSession(days, Date.parse("2026-12-01T09:30:00Z"), "annex")?.id).toBe("combined");
  });
});
