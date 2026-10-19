import { describe, expect, it } from "vitest";
import { resolveUpcomingRooms } from "../../assets/shared/live-session-schedule";
import {
  DEFAULT_LIVE_SCHEDULE_CONFIG,
  liveScheduleCommandSchema,
} from "../../assets/shared/schemas/live-session-schedule";
import { agendaOccurrenceSchema, agendaRoomSchema } from "../../assets/shared/schemas/event-agenda";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";

const time = (clock: string) => `2026-12-01T${clock}:00.000Z`;
function occurrence(
  id: string,
  roomId: string | null,
  start: string,
  end: string,
  extra: Record<string, unknown> = {},
) {
  return agendaOccurrenceSchema.parse({
    id,
    title: `Session ${id}`,
    startAt: time(start),
    endAt: time(end),
    roomId,
    speakers: [],
    ...extra,
  });
}
function agenda() {
  return {
    ...approvedAgendaSnapshot,
    rooms: ["a", "b", "finished"].map((id) => agendaRoomSchema.parse({ id, name: `Room ${id}`, capacity: null })),
    occurrences: [
      occurrence("current-a", "a", "09:00", "10:00"),
      occurrence("current-b", "b", "09:00", "09:40"),
      occurrence("next-a", "a", "10:00", "11:00"),
      occurrence("next-b", "b", "09:45", "10:10"),
      occurrence("later-b", "b", "10:10", "11:00"),
      occurrence("finished", "finished", "08:00", "09:00"),
    ],
  };
}
describe("independent approved room schedules", () => {
  it("uses each room's own running session end and retains a selected future opening", () => {
    const snapshot = agenda(),
      now = Date.parse(time("09:30"));
    const result = resolveUpcomingRooms(snapshot, "next-a", now, DEFAULT_LIVE_SCHEDULE_CONFIG);
    expect(result.rooms.map((room) => [room.roomId, room.occurrenceId, room.startAt])).toEqual([
      ["a", "next-a", time("10:00")],
      ["b", "next-b", time("09:45")],
    ]);
    expect(result.timeZone).toBe("Europe/Amsterdam");
    expect(result.resolvedAt).toBe(time("09:30"));
  });
  it("advances clocks independently without showing sessions that already started or ended rooms", () => {
    const result = resolveUpcomingRooms(agenda(), "current-a", Date.parse(time("09:50")), DEFAULT_LIVE_SCHEDULE_CONFIG);
    expect(result.rooms.map((room) => room.occurrenceId)).toEqual(["next-a", "later-b"]);
    expect(
      resolveUpcomingRooms(agenda(), "current-a", Date.parse(time("12:00")), DEFAULT_LIVE_SCHEDULE_CONFIG).rooms,
    ).toEqual([]);
  });
  it("uses actual this-room context with primary fallback, and never guesses a room for a global selection", () => {
    const config = { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "this-room" as const, layout: "list" as const },
      snapshot = agenda(),
      now = Date.parse(time("09:30"));
    expect(resolveUpcomingRooms(snapshot, "current-a", now, config, "b").rooms.map((room) => room.roomId)).toEqual([
      "b",
    ]);
    expect(resolveUpcomingRooms(snapshot, "current-a", now, config).rooms.map((room) => room.roomId)).toEqual(["a"]);
    snapshot.occurrences.push(occurrence("global", null, "11:00", "12:00", { kind: "plenary" }));
    expect(resolveUpcomingRooms(snapshot, "global", now, config).rooms).toEqual([]);
    expect(resolveUpcomingRooms(snapshot, "global", now, config, "b").rooms.map((room) => room.roomId)).toEqual(["b"]);
  });
  it("projects one global plenary against all rooms without manufacturing separate occurrence IDs", () => {
    const snapshot = agenda();
    snapshot.occurrences = snapshot.occurrences.filter((item) => item.id.startsWith("current"));
    snapshot.occurrences.push(occurrence("global", null, "10:15", "11:00", { kind: "plenary" }));
    const result = resolveUpcomingRooms(snapshot, "current-a", Date.parse(time("09:30")), DEFAULT_LIVE_SCHEDULE_CONFIG);
    expect(result.rooms.map((room) => room.occurrenceId)).toEqual(["global", "global", "global"]);
    expect(new Set(result.rooms.map((room) => room.roomId)).size).toBe(3);
  });
  it("skips private, placeholder, break and incomplete entries while preserving approved speaker names", () => {
    const snapshot = agenda();
    snapshot.occurrences = [
      occurrence("private", "a", "09:35", "09:40", { visibility: "private" }),
      occurrence("placeholder", "a", "09:40", "09:45", { placeholder: true }),
      occurrence("break", "a", "09:45", "09:50", { kind: "break" }),
      occurrence("incomplete", "a", "09:50", "09:55", { endAt: null }),
      {
        ...approvedAgendaSnapshot.occurrences[0]!,
        id: "approved",
        roomId: "a",
        startAt: time("10:00"),
        endAt: time("11:00"),
      },
    ];
    const result = resolveUpcomingRooms(snapshot, null, Date.parse(time("09:30")), DEFAULT_LIVE_SCHEDULE_CONFIG);
    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0]!.occurrenceId).toBe("approved");
    // The headshot is the one the public agenda shows for the approved appearance; nothing private comes along.
    expect(result.rooms[0]!.speakers).toEqual([
      { name: "Historical speaker", moderator: true, photoUrl: "/approved-photo.jpg" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/biography|private|profileCandidate/);
  });
  it("leaves out rooms with nothing in the next block of the program", () => {
    const snapshot = agenda();
    snapshot.rooms.push(agendaRoomSchema.parse({ id: "c", name: "Room c", capacity: null }));
    snapshot.occurrences.push(occurrence("afternoon-c", "c", "14:00", "15:00"));
    const result = resolveUpcomingRooms(snapshot, null, Date.parse(time("09:30")), DEFAULT_LIVE_SCHEDULE_CONFIG);
    expect(result.rooms.map((room) => room.roomId)).toEqual(["a", "b"]);
    // Once the morning is over, the afternoon is the next block and room c is in it.
    const later = resolveUpcomingRooms(snapshot, null, Date.parse(time("12:00")), DEFAULT_LIVE_SCHEDULE_CONFIG);
    expect(later.rooms.map((room) => room.occurrenceId)).toEqual(["afternoon-c"]);
  });
  it("gives a roster name without an approved appearance no headshot", () => {
    const snapshot = agenda();
    snapshot.occurrences = [
      occurrence("roster", "a", "10:00", "11:00", {
        speakers: [
          {
            userId: "speaker",
            displayName: "Roster speaker",
            profileCandidate: { biography: "Draft", photoUrl: "/draft-photo.jpg" },
          },
        ],
      }),
    ];
    const [room] = resolveUpcomingRooms(snapshot, null, Date.parse(time("09:30")), DEFAULT_LIVE_SCHEDULE_CONFIG).rooms;
    expect(room!.speakers).toEqual([{ name: "Roster speaker", moderator: false, photoUrl: null }]);
  });
  it("keeps stable start/id ties and a bounded room projection", () => {
    const snapshot = agenda();
    snapshot.rooms = Array.from({ length: 22 }, (_, index) =>
      agendaRoomSchema.parse({ id: `r${index}`, name: `Room ${index}`, capacity: null }),
    );
    snapshot.occurrences = snapshot.rooms.flatMap((room) => [
      occurrence(`z-${room.id}`, room.id, "10:00", "11:00"),
      occurrence(`a-${room.id}`, room.id, "10:00", "11:00"),
    ]);
    const result = resolveUpcomingRooms(snapshot, null, Date.parse(time("09:30")), DEFAULT_LIVE_SCHEDULE_CONFIG);
    expect(result.rooms).toHaveLength(20);
    expect(result.rooms.every((room) => room.occurrenceId === `a-${room.roomId}`)).toBe(true);
    expect(result.rooms[19]!.roomIndex).toBe(19);
  });
  it("distinguishes unavailable data from an empty approved schedule and rejects caller-projected text", () => {
    const now = Date.parse(time("09:30"));
    expect(resolveUpcomingRooms(null, null, now, DEFAULT_LIVE_SCHEDULE_CONFIG)).toMatchObject({
      available: false,
      timeZone: null,
      rooms: [],
    });
    expect(
      resolveUpcomingRooms({ ...agenda(), occurrences: [] }, null, now, DEFAULT_LIVE_SCHEDULE_CONFIG),
    ).toMatchObject({ available: true, timeZone: "Europe/Amsterdam", rooms: [] });
    expect(
      liveScheduleCommandSchema.safeParse({
        type: "stage.schedule",
        schedule: { ...DEFAULT_LIVE_SCHEDULE_CONFIG, rooms: [{ title: "invented" }] },
      }).success,
    ).toBe(false);
  });
});
