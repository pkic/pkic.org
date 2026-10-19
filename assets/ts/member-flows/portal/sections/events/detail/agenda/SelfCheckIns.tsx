/**
 * Who checked in where, once per person, day and place, with how the person
 * stood when they first scanned. Nobody is
 * turned away, so this is where organizers find who was in a room without a
 * registration, an in-person place or a booked seat (Expected: No), and who
 * checked in while attending online.
 */
import type { ClockZone } from "../../../../../../../shared/event-clock";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import {
  selfCheckInsResponseSchema,
  type SelfCheckIn,
} from "../../../../../../../shared/schemas/event-attendance-movement";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { ATTENDANCE_POINT_KIND_LABELS } from "../../../../../../components/attendance-points/attendance-point-copy";
import { ATTENDEE_STANDING_LABELS, BOOKING_FILTER, EXPECTED_FILTER, STANDING_FILTER } from "./attendance-movement-copy";

function place(row: SelfCheckIn): string {
  if (row.session) return row.session.title;
  return row.room?.name ?? ATTENDANCE_POINT_KIND_LABELS[row.pointKind];
}

function seat(row: SelfCheckIn): string {
  if (row.booked === null) return "No seat needed";
  return row.booked ? "Booked" : "Not booked";
}

export function SelfCheckIns({ slug, timeZone }: { slug: string; timeZone: ClockZone }) {
  return (
    <ApiDataTable
      urlState="attendance-check-ins"
      clearDataOnReload
      retainDataOnError={false}
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance/check-ins`}
      responseSchema={selfCheckInsResponseSchema}
      resolve={(data) => data.checkIns}
      resolvePage={(data) => data.page}
      caption="Self check-ins"
      rowKey={(row) => row.id}
      paginate
      searchPlaceholder="Search people or sessions…"
      inset={
        <p class="pk-muted">
          Everyone who scans a check-in code is recorded, even without a registration or a booked seat. Each person is
          listed once per day and place, at their first check-in. Online check-ins never count toward on-site or
          in-person numbers.
        </p>
      }
      columns={[
        {
          header: "Person",
          cell: (row) => row.person.displayName ?? row.person.email ?? "Unnamed person",
          sort: { asc: "name", desc: "-name" },
          hideable: false,
        },
        {
          header: "Checked in",
          cell: (row) => formatDateTimeInZone(row.observedAt, timeZone),
          sort: { asc: "observedAt", desc: "-observedAt" },
          width: "fit",
        },
        { header: "Where", cell: place },
        {
          header: "Registration",
          cell: (row) => ATTENDEE_STANDING_LABELS[row.standing],
          filter: { param: "standing", options: STANDING_FILTER },
        },
        { header: "Seat", cell: seat, filter: { param: "booking", options: BOOKING_FILTER } },
        {
          header: "Registered and booked",
          cell: (row) => (row.expected ? "Yes" : "No"),
          filter: { param: "expected", options: EXPECTED_FILTER },
          width: "fit",
        },
      ]}
    />
  );
}
