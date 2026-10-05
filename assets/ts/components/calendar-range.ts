import { zonedDateTimeParts, zonedDateTimeToDate } from "../../shared/timezone";
export type CalendarView = "month" | "week";
/** Date arithmetic operates on calendar dates, never fixed-length local days. */
export function calendarDate(value: Date, zone: string): string {
  const p = zonedDateTimeParts(value, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function calendarMidnight(value: string, zone: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return zonedDateTimeToDate({ year, month, day, hour: 0, minute: 0, second: 0 }, zone).toISOString();
}
export function calendarRange(date: string, view: CalendarView, zone: string) {
  const selected = new Date(`${date}T12:00:00.000Z`);
  const first = view === "month" ? `${date.slice(0, 7)}-01` : date;
  const weekday = new Date(`${first}T12:00:00.000Z`).getUTCDay();
  const start = shiftCalendarDate(first, -((weekday + 6) % 7));
  const last =
    view === "month"
      ? new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
      : shiftCalendarDate(start, 6);
  const length = view === "month" ? Math.ceil((Number(last.slice(8)) + ((weekday + 6) % 7)) / 7) * 7 : 7;
  const dates = Array.from({ length }, (_, index) => shiftCalendarDate(start, index));
  return { dates, from: calendarMidnight(start, zone), to: calendarMidnight(shiftCalendarDate(start, length), zone) };
}
export function moveCalendar(date: string, view: CalendarView, direction: number): string {
  if (view === "week") return shiftCalendarDate(date, direction * 7);
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + direction);
  return value.toISOString().slice(0, 10);
}
