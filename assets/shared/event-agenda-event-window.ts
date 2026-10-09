import type { z } from "zod";

/** The owning event's interval; an open side does not constrain scheduling. */
export interface AgendaEventWindow {
  eventStartsAt?: string | null;
  eventEndsAt?: string | null;
}

/** Which scheduled edge falls outside the event. Instants compare as canonical UTC ISO text. */
export function agendaEventWindowViolations(
  value: { startAt?: string | null; endAt?: string | null },
  window: AgendaEventWindow,
) {
  return {
    startsBefore: Boolean(value.startAt && window.eventStartsAt && value.startAt < window.eventStartsAt),
    endsAfter: Boolean(value.endAt && window.eventEndsAt && value.endAt > window.eventEndsAt),
  };
}

/** Narrows an occurrence request contract to the owning event's dates, as the agenda service enforces. */
export function withinAgendaEventWindow<Schema extends z.ZodType<{ startAt?: string | null; endAt?: string | null }>>(
  schema: Schema,
  window: AgendaEventWindow,
) {
  return schema.superRefine((value, context) => {
    const outside = agendaEventWindowViolations(value, window);
    if (outside.startsBefore)
      context.addIssue({ code: "custom", path: ["startAt"], message: "Start during the event's dates" });
    if (outside.endsAfter)
      context.addIssue({ code: "custom", path: ["endAt"], message: "End during the event's dates" });
  });
}
