import { describe, expect, it } from "vitest";
import { agendaMovedSpeakers } from "../../assets/shared/event-agenda-rooms";
import { agendaConflicts } from "../../assets/shared/event-agenda-policy";
import { agendaOccurrenceSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { scheduleSwap } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/schedule-proposals";
const first = agendaOccurrenceSchema.parse({
  id: "first",
  title: "First",
  description: "",
  startAt: "2026-12-01T10:00:00.000Z",
  endAt: "2026-12-01T10:45:00.000Z",
  roomId: "primary",
  additionalRoomIds: ["overflow"],
  speakers: [{ userId: "speaker", displayName: "Speaker", attendanceMode: "physical", roomId: "overflow" }],
});
const second = agendaOccurrenceSchema.parse({
  ...first,
  id: "second",
  title: "Second",
  startAt: "2026-12-01T10:50:00.000Z",
  endAt: "2026-12-01T11:20:00.000Z",
  additionalRoomIds: [],
  speakers: [{ ...first.speakers[0], roomId: "primary" }],
});
describe("individual placement scheduling", () => {
  it("requires travel between actual rooms even when sessions share the primary room", () => {
    expect(agendaConflicts([first, second], 15)).toContain("First and Second need speaker travel time");
  });
  it("allows the same actual room and keeps remote time conflicts without physical travel", () => {
    expect(agendaConflicts([first, { ...second, speakers: first.speakers }], 15)).toEqual([]);
    const remote = {
      ...second,
      speakers: [{ ...second.speakers[0], attendanceMode: "remote" as const, roomId: null }],
    };
    expect(agendaConflicts([first, remote], 15)).toEqual([]);
    expect(agendaConflicts([first, { ...remote, startAt: "2026-12-01T10:40:00.000Z" }], 15)).toContain(
      "First and Second share a speaker at the same time",
    );
  });
  it("moves primary placements and preserves deliberate additional placements", () => {
    expect(
      agendaMovedSpeakers(
        {
          ...first,
          speakers: [
            { ...first.speakers[0], roomId: "primary" },
            { ...first.speakers[0], userId: "other" },
          ],
        },
        "overflow",
      ).map((speaker) => speaker.roomId),
    ).toEqual(["overflow", "overflow"]);
  });
  it("keeps each session duration through unequal swaps and inverse swaps", () => {
    const snapshot = agendaSnapshotSchema.parse({
      eventSlug: "event",
      timeZone: "Europe/Amsterdam",
      revision: 1,
      publishedRevision: null,
      rooms: [],
      occurrences: [first, second],
      blocks: [],
      assignments: [],
      roleMembers: [],
    });
    const proposal = scheduleSwap(snapshot, first, second);
    expect(proposal.changes[0].endAt).toBe("2026-12-01T11:35:00.000Z");
    expect(proposal.changes[1].endAt).toBe("2026-12-01T10:30:00.000Z");
    const next = {
      ...snapshot,
      revision: 2,
      occurrences: snapshot.occurrences.map((item) => ({
        ...item,
        ...proposal.changes.find((change) => change.id === item.id),
      })),
    };
    const inverse = scheduleSwap(next, next.occurrences[0], next.occurrences[1]);
    expect(inverse.changes.map(({ startAt, endAt }) => ({ startAt, endAt }))).toEqual(
      [first, second].map(({ startAt, endAt }) => ({ startAt, endAt })),
    );
  });
});
