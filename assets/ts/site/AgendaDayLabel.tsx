import { LocalTime } from "./SiteDate";

/** The same two-line date label on published and organizer agendas. */
export function AgendaDayLabel({ date }: { date: string }) {
  return (
    <>
      <LocalTime value={date} format="weekday" />
      <small>
        <LocalTime value={date} format="date" />
      </small>
    </>
  );
}
