import { attendancePeopleResponseSchema } from "../../../../../../../shared/schemas/event-participation-reporting";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { formatNumber } from "../../../../../../../shared/format-number";
export function SessionAttendancePeople({
  slug,
  occurrenceId,
  timeZone,
}: {
  slug: string;
  occurrenceId: string;
  timeZone: string;
}) {
  return (
    <ApiDataTable
      clearDataOnReload
      retainDataOnError={false}
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/${encodeURIComponent(occurrenceId)}/attendance`}
      responseSchema={attendancePeopleResponseSchema}
      resolve={(value) => value.attendees}
      resolvePage={(value) => value.page}
      caption="Observed session attendees"
      rowKey={(row) => row.userId}
      paginate
      searchPlaceholder="Search attendee names…"
      initialSort="firstObservedAt"
      columns={[
        {
          header: "Attendee",
          cell: (row) => row.displayName ?? "Attendee",
          sort: { asc: "name", desc: "-name" },
          hideable: false,
        },
        {
          header: "First observed",
          cell: (row) => formatDateTimeInZone(row.firstObservedAt, timeZone),
          sort: { asc: "firstObservedAt", desc: "-firstObservedAt" },
        },
        { header: "Last observed", cell: (row) => formatDateTimeInZone(row.lastObservedAt, timeZone) },
        {
          header: "Attendance observations",
          align: "end",
          width: "fit",
          cell: (row) => formatNumber(row.observationCount),
        },
      ]}
    />
  );
}
