import { agendaOccurrenceRoomIds } from "./event-agenda-rooms";
import { publicSessionCreditPhoto, publicSessionCreditRole, publicSessionCredits } from "./session-public-credits";
import type { AgendaSnapshot, AgendaOccurrence } from "./schemas/event-agenda";
import { utcInstantSchema } from "./schemas/api-common";
import { timeZoneSchema } from "./schemas/event-series";
import {
  LIVE_SCHEDULE_MAX_ROOMS,
  liveScheduleConfigSchema,
  liveScheduleProjectionSchema,
  liveScheduleSpeakerSchema,
  type LiveScheduleConfig,
  type LiveScheduleRoom,
} from "./schemas/live-session-schedule";

type PublishedSchedule = Pick<AgendaSnapshot, "rooms" | "occurrences" | "timeZone">;
type TimedOccurrence = AgendaOccurrence & { startAt: string; endAt: string };
function timedPublic(item: AgendaOccurrence): item is TimedOccurrence {
  return (
    item.visibility === "public" &&
    !item.placeholder &&
    utcInstantSchema.safeParse(item.startAt).success &&
    utcInstantSchema.safeParse(item.endAt).success &&
    item.startAt! < item.endAt!
  );
}
function applies(item: AgendaOccurrence, roomId: string) {
  const rooms = agendaOccurrenceRoomIds(item);
  return rooms.includes(roomId) || (item.kind === "plenary" && rooms.length === 0);
}

/** Each public credit as the public agenda presents it: name, role and headshot. */
function scheduleSpeakers(session: TimedOccurrence) {
  return publicSessionCredits(session)
    .flatMap((credit) => {
      const checked = liveScheduleSpeakerSchema.safeParse({
        name: credit.displayName,
        moderator: publicSessionCreditRole(session, credit) === "moderator",
        photoUrl: publicSessionCreditPhoto(credit),
      });
      return checked.success ? [checked.data] : [];
    })
    .slice(0, 50);
}

/**
 * The rooms whose next session belongs to the program's next block: the
 * earliest next session sets the block, and a room joins it when its own next
 * session starts before that one ends. A room with nothing until later is
 * left out rather than shown with a distant session.
 */
function nextBlock(rooms: readonly LiveScheduleRoom[]): LiveScheduleRoom[] {
  const first = rooms.reduce<LiveScheduleRoom | null>(
    (earliest, room) =>
      !earliest || room.startAt < earliest.startAt || (room.startAt === earliest.startAt && room.endAt < earliest.endAt)
        ? room
        : earliest,
    null,
  );
  return first ? rooms.filter((room) => room.startAt < first.endAt) : [];
}

/** Independent room timelines from one approved basis; Preview and Program use this exact policy. */
export function resolveUpcomingRooms(
  agenda: PublishedSchedule | null,
  currentOccurrenceId: string | null,
  now: number,
  input: LiveScheduleConfig,
  currentRoomId?: string,
) {
  const config = liveScheduleConfigSchema.parse(input),
    resolvedAt = new Date(now).toISOString();
  const zone = timeZoneSchema.safeParse(agenda?.timeZone);
  if (!agenda || !zone.success)
    return liveScheduleProjectionSchema.parse({ config, resolvedAt, available: false, timeZone: null, rooms: [] });
  const current = agenda.occurrences.find((item) => item.id === currentOccurrenceId);
  // Physical room context is trusted caller context, never authored in the graphic configuration.
  const selectedRoom = currentRoomId ?? current?.roomId;
  const timed = agenda.occurrences
    .filter(timedPublic)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  const upcoming: LiveScheduleRoom[] = [];
  for (const [roomIndex, room] of agenda.rooms.entries()) {
    if (config.scope === "this-room" && room.id !== selectedRoom) continue;
    const timeline = timed.filter((item) => applies(item, room.id));
    const boundary = timeline.reduce(
      (end, item) =>
        Date.parse(item.startAt) <= now && Date.parse(item.endAt) > now ? Math.max(end, Date.parse(item.endAt)) : end,
      now,
    );
    const next = timeline.find((item) => item.kind !== "break" && Date.parse(item.startAt) >= boundary);
    if (!next) continue;
    upcoming.push({
      roomId: room.id,
      roomName: room.name,
      roomIndex,
      occurrenceId: next.id,
      title: next.title,
      startAt: next.startAt,
      endAt: next.endAt,
      speakers: scheduleSpeakers(next),
    });
    if (upcoming.length === LIVE_SCHEDULE_MAX_ROOMS) break;
  }
  return liveScheduleProjectionSchema.parse({
    config,
    resolvedAt,
    available: true,
    timeZone: zone.data,
    rooms: nextBlock(upcoming),
  });
}
