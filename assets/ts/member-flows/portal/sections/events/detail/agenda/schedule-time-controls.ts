import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../../../shared/timezone";
export const agendaTimeSteps = [1, 5, 10, 15, 30] as const;
/** Adjust an explicit instant; the shared codec resolves the event's wall clock. */
export function adjustAgendaStart(value: string, timeZone: string, minutes: number) {
  const instant = dateTimeLocalToIso(value, timeZone);
  return instantToDateTimeLocal(new Date(Date.parse(instant) + minutes * 60_000), timeZone);
}
/** Snapping is explicit and never changes an independently typed time. */
export function snapAgendaStart(value: string, timeZone: string, minutes: number) {
  dateTimeLocalToIso(value, timeZone);
  const [hour, minute] = value.slice(11, 16).split(":").map(Number);
  const offset = hour! * 60 + minute!;
  return adjustAgendaStart(value, timeZone, Math.round(offset / minutes) * minutes - offset);
}

/** Board candidates use the same event-local grid as precise time controls. */
export function snapAgendaInstant(value: string, timeZone: string, minutes: number) {
  const local = instantToDateTimeLocal(value, timeZone);
  const [hour, minute] = local.slice(11, 16).split(":").map(Number);
  const instant = new Date(value);
  const offset = hour! * 60 + minute! + instant.getUTCSeconds() / 60 + instant.getUTCMilliseconds() / 60_000;
  const delta = Math.round(offset / minutes) * minutes - offset;
  return new Date(instant.getTime() + delta * 60_000).toISOString();
}
