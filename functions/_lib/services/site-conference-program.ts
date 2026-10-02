import {
  conferenceProgramSchema,
  conferenceProgramSourceSchema,
  type ConferenceProgram,
} from "../../../assets/shared/schemas/conference-program";
import { contentAgendaSlotTiming } from "../../../assets/shared/content-agenda-timing";
import { zonedDateTimeParts } from "../../../assets/shared/timezone";
import { siteContentSlug } from "../../../assets/shared/site-content-slug";

/** Enrich authored conference data once for displays, JSON, and calendar publication. */
export function publishedConferenceProgram(raw: unknown, assetUrls: (pattern: string) => string[]): ConferenceProgram {
  const source = conferenceProgramSourceSchema.parse(raw);
  const clock = (instant: string) => {
    const parts = zonedDateTimeParts(new Date(instant), source.timezone);
    return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  };
  const agenda = Object.fromEntries(
    Object.entries(source.agenda).map(([date, slots]) => {
      const timings = slots.map((slot, index) =>
        contentAgendaSlotTiming(date, source.timezone, slot, slots[index + 1], source.transitionMinutes),
      );
      const enriched = slots.map((slot, index) => {
        const timing = timings[index]!;
        return {
          ...slot,
          ...timing,
          endTime: slots[index + 1]?.time,
          sessions: slot.sessions.map((session) => {
            const durationMinutes = session.durationMinutes ?? timing.durationMinutes;
            const endsAt =
              durationMinutes !== undefined
                ? new Date(Date.parse(timing.startsAt) + durationMinutes * 60_000).toISOString()
                : undefined;
            return {
              ...session,
              durationMinutes,
              endsAt,
              endTime: endsAt ? clock(endsAt) : undefined,
              rowSpan: endsAt
                ? 1 + timings.slice(index + 1).filter((next) => Date.parse(next.startsAt) < Date.parse(endsAt)).length
                : 1,
            };
          }),
        };
      });
      for (const [index, slot] of enriched.entries()) {
        slot.coveredLocations = [
          ...new Set(
            enriched
              .slice(0, index)
              .flatMap((prior) =>
                prior.sessions
                  .filter((session) => session.endsAt && session.endsAt > slot.startsAt)
                  .flatMap((session) => session.locations),
              ),
          ),
        ].filter((location) => !slot.sessions.some((session) => session.locations.includes(location)));
      }
      return [date, enriched];
    }),
  );
  return conferenceProgramSchema.parse({
    ...source,
    agenda,
    speakers: source.speakers.map((speaker) => {
      const image = assetUrls(`speakers/${speaker.id ?? siteContentSlug(speaker.name)}.*`)[0];
      return { ...speaker, headshot: image ? { x150: image, x250: image, x600: image } : undefined };
    }),
  });
}
