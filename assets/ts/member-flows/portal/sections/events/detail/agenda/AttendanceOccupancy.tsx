/**
 * Who is at the venue, per day: checked in, checked out and on site against
 * the day's in-person capacity. Staff badge scans and attendee self check-ins
 * count together. The list refreshes itself while it is open.
 */
import { useEffect, useRef } from "preact/hooks";
import { attendanceOccupancyResponseSchema } from "../../../../../../../shared/schemas/event-attendance-points";
import { formatNumber } from "../../../../../../../shared/format-number";
import { formatCalendarDate } from "../../../../../../../shared/format-date";
import { ApiDataTable, type ApiTableActions } from "../../../../../../components/ApiDataTable";

const REFRESH_MS = 30_000;

export function AttendanceOccupancy({ slug }: { slug: string }) {
  const actions = useRef<ApiTableActions | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void actions.current?.reload();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  const count = (value: number | null) => (value === null ? "No limit" : formatNumber(value));
  return (
    <ApiDataTable
      urlState="attendance-on-site"
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance/occupancy`}
      responseSchema={attendanceOccupancyResponseSchema}
      resolve={(data) => data.days}
      resolvePage={(data) => data.page}
      actionsRef={actions}
      paginate
      caption="On site by day"
      rowKey={(day) => day.dayDate}
      columns={[
        {
          header: "Day",
          cell: (day) => `${day.dayLabel}, ${formatCalendarDate(day.dayDate)}`,
          sort: { asc: "dayDate", desc: "-dayDate" },
          hideable: false,
        },
        { header: "On site", cell: (day) => formatNumber(day.onSite), align: "end", width: "fit" },
        { header: "Capacity", cell: (day) => count(day.capacity), align: "end", width: "fit" },
        { header: "Places left", cell: (day) => count(day.available), align: "end", width: "fit" },
        { header: "Checked in", cell: (day) => formatNumber(day.checkedIn), align: "end", width: "fit" },
        { header: "Checked out", cell: (day) => formatNumber(day.checkedOut), align: "end", width: "fit" },
        {
          header: "Self check-ins",
          cell: (day) => formatNumber(day.selfCheckIns),
          align: "end",
          width: "fit",
          defaultHidden: true,
        },
        {
          header: "Badge scans",
          cell: (day) => formatNumber(day.staffCheckIns),
          align: "end",
          width: "fit",
          defaultHidden: true,
        },
      ]}
    />
  );
}
