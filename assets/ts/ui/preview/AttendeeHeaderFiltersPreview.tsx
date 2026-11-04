import { RegistrationOutputActions } from "../../components/event-registrations/RegistrationOutputActions";
import { useState } from "preact/hooks";
import { LEGACY_ATTENDANCE_ACCESS } from "../../../shared/event-attendance-access";
import { attendanceTypeLabel } from "../../shared/attendance";
import { DataTable } from "../../components/Table";
import { registrationAttendanceColumns } from "../../components/event-registrations/registration-attendance-columns";
import type { RegistrationDayState } from "../../../shared/schemas/event-registrations";
import { PersonCell } from "../PersonCell";
import { useColumnControls, ColumnCardMenu } from "../../components/table-column-controls";

const days = Array.from({ length: 7 }, (_, i) => `2026-12-0${i + 1}`).map((date) => ({
  date,
  label: null,
  attendanceOptions: Object.entries(LEGACY_ATTENDANCE_ACCESS).map(([value, accessMode]) => ({
    value,
    label: attendanceTypeLabel(value),
    accessMode,
    enabled: true,
  })),
}));
const rows: Array<{ name: string; days: RegistrationDayState[] }> = [
  {
    name: "Alex Example",
    days: days.map((day, i) => ({
      dayDate: day.date,
      label: null,
      attendanceType: i === 5 ? "virtual" : "in_person",
      waitlistStatus: i === 6 ? "waiting" : null,
    })),
  },
];

/** Synthetic control specimen; the real roster's D1 query owns population matching. */
export function AttendeeHeaderFiltersPreview() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const columns = [
    {
      header: "Attendee",
      cell: (row: (typeof rows)[number]) => <PersonCell name={row.name} size="sm" />,
      width: "primary" as const,
    },
    ...registrationAttendanceColumns<(typeof rows)[number]>(days, filters),
  ];
  const onFilterChange = (param: string, value: string) => setFilters((current) => ({ ...current, [param]: value }));
  const controls = useColumnControls(columns, { filters, onFilterChange });
  return (
    <div class="pk-table-list" data-density="compact">
      <div class="pk-toolbar">
        <ColumnCardMenu controls={controls} caption="Attendees" alwaysVisible />
        <RegistrationOutputActions
          attendeeUrl="/example-attendees.csv"
          sponsorUrl="/example-consenting-attendees.csv"
          onPrint={() => {}}
        />
      </div>
      <DataTable
        caption="Attendees"
        columns={columns}
        data={rows}
        rowKey={(row) => row.name}
        filters={filters}
        onFilterChange={onFilterChange}
        controls={controls}
      />
    </div>
  );
}
