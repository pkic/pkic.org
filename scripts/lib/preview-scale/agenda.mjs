import { dateTimeLocalToIso } from "../../../assets/shared/timezone.ts";
import { previewScaleId } from "../seed-ids.mjs";
import { inventAbstract, inventTitle } from "./text.mjs";

/**
 * A three-day conference program shaped like production's largest event:
 * eight rooms, a morning keynote, breaks between blocks, and parallel talks
 * and panels. Times are local wall-clock values resolved through the event's
 * IANA zone with the shared codec.
 */

/** The seeded rooms; `resolveRooms` reuses an existing room of the same name. */
export const ROOMS = [
  { key: "main", name: "Main hall", capacity: 900 },
  { key: "auditorium", name: "Auditorium", capacity: 400 },
  ...Array.from({ length: 6 }, (_, index) => ({ key: `room-${index + 1}`, name: `Room ${index + 1}`, capacity: 120 })),
].map((room) => ({ ...room, id: previewScaleId(`room:${room.key}`) }));

const KEYNOTE = { start: "08:00", end: "08:45" };
const BREAKS = [
  { start: "10:30", end: "11:00", title: "Coffee break" },
  { start: "12:30", end: "13:30", title: "Lunch" },
  { start: "15:00", end: "15:30", title: "Afternoon break" },
];
const SLOTS = [
  ["09:00", "09:40"],
  ["09:50", "10:30"],
  ["11:00", "11:40"],
  ["11:50", "12:30"],
  ["13:30", "14:10"],
  ["14:20", "15:00"],
  ["15:30", "16:10"],
  ["16:20", "17:00"],
];
const TRACKS = ["Migration", "Research", "Policy & standards", "Implementation", "Industry"];

/** Panels take three to four speakers; everything else takes one. */
function speakerCount(random, format) {
  return format === "panel" ? 3 + Math.floor(random() * 2) : 1;
}

/**
 * Assign speakers so nobody appears in two sessions at once and the load is
 * spread evenly: each session takes the least-used speakers free in its slot.
 */
function assignSpeakers(sessions, speakers, random) {
  const load = new Map(speakers.map((speaker) => [speaker.userId, 0]));
  const busy = new Map();
  for (const session of sessions) {
    if (session.kind === "break") continue;
    const taken = busy.get(session.startAt) ?? new Set();
    const free = speakers
      .filter((speaker) => !taken.has(speaker.userId))
      .sort((left, right) => load.get(left.userId) - load.get(right.userId) || random() - 0.5);
    session.speakerUserIds = free.slice(0, speakerCount(random, session.format)).map((speaker) => speaker.userId);
    for (const userId of session.speakerUserIds) {
      taken.add(userId);
      load.set(userId, load.get(userId) + 1);
    }
    busy.set(session.startAt, taken);
  }
}

/**
 * The room, time and content of every slot come from `random` before any
 * speaker is assigned, so a different speaker count changes only who speaks.
 * @param {{ days: string[], timeZone: string, rooms: Array<{id:string}>, speakers: Array<{userId:string}>, random: () => number, fill?: number }} options
 */
export function buildAgenda({ days, timeZone, rooms, speakers, random, fill = 0.55 }) {
  const at = (day, clock) => dateTimeLocalToIso(`${day}T${clock}`, timeZone);
  const sessions = [];
  const add = (key, fields) => sessions.push({ id: previewScaleId(`occurrence:${key}`), speakerUserIds: [], ...fields });
  days.forEach((day, dayIndex) => {
    add(`${day}:keynote`, {
      title: `${dayIndex === 0 ? "Opening keynote" : `Day ${dayIndex + 1} keynote`}: ${inventTitle(random)}`,
      kind: "session",
      format: "keynote",
      track: null,
      roomId: rooms[0].id,
      startAt: at(day, KEYNOTE.start),
      endAt: at(day, KEYNOTE.end),
    });
    for (const pause of BREAKS)
      add(`${day}:break:${pause.start}`, {
        title: pause.title,
        kind: "break",
        format: null,
        track: null,
        roomId: rooms[0].id,
        startAt: at(day, pause.start),
        endAt: at(day, pause.end),
      });
    SLOTS.forEach(([start, end], slotIndex) => {
      rooms.forEach((room, roomIndex) => {
        if (roomIndex > 1 && random() > fill) return;
        const format = roomIndex > 1 && slotIndex % 3 === 2 ? "panel" : "talk";
        add(`${day}:${start}:${room.key}`, {
          title: format === "panel" && random() < 0.4 ? `Panel: ${inventTitle(random)}` : inventTitle(random),
          kind: "session",
          format,
          track: TRACKS[roomIndex % TRACKS.length],
          roomId: room.id,
          startAt: at(day, start),
          endAt: at(day, end),
        });
      });
    });
  });
  for (const session of sessions) session.description = inventAbstract(random, session.kind);
  assignSpeakers(sessions, speakers, random);
  return sessions;
}

/** The seeded rooms, keeping the id of a room the event already has under the same name. */
export function resolveRooms(existingRooms) {
  const byName = new Map(existingRooms.map((room) => [room.name, room.id]));
  return ROOMS.map((room) => ({ ...room, id: byName.get(room.name) ?? room.id, existing: byName.has(room.name) }));
}
