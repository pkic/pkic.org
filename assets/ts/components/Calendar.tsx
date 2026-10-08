import { formatCalendarDate } from "../../shared/format-date";
import type { ComponentChildren } from "preact";
import { calendarMidnight, calendarRange, shiftCalendarDate, type CalendarView } from "./calendar-range";
import "./Calendar.css";
/** A reusable calendar projection; loading, pagination, permissions and editing stay with its owner. */
export function Calendar<T extends { id: string; startsAt: string; endsAt: string }>({
  date,
  view,
  timeZone,
  items,
  renderItem,
  complete,
}: {
  date: string;
  view: CalendarView;
  timeZone: string;
  items: readonly T[];
  renderItem: (item: T) => ComponentChildren;
  complete: boolean;
}) {
  const range = calendarRange(date, view, timeZone);
  return (
    <div class={`pk-calendar pk-calendar--${view}`} aria-label={`${view === "month" ? "Month" : "Week"} calendar`}>
      {view === "month" && complete && items.length === 0 && (
        <p class="pk-calendar__mobile-empty" role="status">
          No meetings in this date range.
        </p>
      )}
      {range.dates.map((day) => {
        const from = calendarMidnight(day, timeZone),
          to = calendarMidnight(shiftCalendarDate(day, 1), timeZone);
        const entries = items.filter((item) => item.startsAt < to && item.endsAt > from);
        return (
          <section
            class={`pk-calendar__day${complete && !entries.length ? " pk-calendar__day--empty" : ""}`}
            key={day}
            aria-label={day}
          >
            <h4 class="pk-calendar__date">
              <time dateTime={day}>{formatCalendarDate(day)}</time>
            </h4>
            <div class="pk-stack">
              {entries.map((item) => (
                <div key={item.id}>{renderItem(item)}</div>
              ))}
            </div>
            {!entries.length && complete && <span class="pk-muted pk-calendar__empty">No meetings</span>}
          </section>
        );
      })}
    </div>
  );
}
