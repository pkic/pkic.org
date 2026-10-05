import { dateTimeLocalToIso } from "./timezone.ts";

export interface ContentAgendaTimingSource {
  time: string;
  durationMinutes?: number;
  noTransition?: boolean;
  sessions?: readonly unknown[];
}

/** Authored session windows reserve the conference's handover before the next session. */
export function contentAgendaSlotTiming(
  date: string,
  timeZone: string,
  slot: ContentAgendaTimingSource,
  nextSlot?: ContentAgendaTimingSource,
  transitionMinutes = 5,
): { startsAt: string; durationMinutes?: number } {
  const instant = (time: string) => dateTimeLocalToIso(`${date}T${time.padStart(5, "0")}`, timeZone);
  const startsAt = instant(slot.time);
  let durationMinutes = slot.durationMinutes;
  if (durationMinutes === undefined && nextSlot) {
    durationMinutes = (Date.parse(instant(nextSlot.time)) - Date.parse(startsAt)) / 60_000;
    if (slot.sessions?.length && nextSlot.sessions?.length && !slot.noTransition && durationMinutes > transitionMinutes)
      durationMinutes -= transitionMinutes;
  }
  if (durationMinutes !== undefined && (!Number.isFinite(durationMinutes) || durationMinutes < 0))
    throw new Error(`Invalid conference duration at ${date} ${slot.time}`);
  return { startsAt, durationMinutes };
}
