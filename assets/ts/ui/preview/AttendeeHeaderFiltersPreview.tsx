import { SponsorConsentCell } from "../../components/event-registrations/SponsorConsentCell";
import { CollectionToolbar } from "../../components/CollectionToolbar";
import { RegistrationOutputActions } from "../../components/event-registrations/RegistrationOutputActions";
import { useState } from "preact/hooks";
import { LEGACY_ATTENDANCE_ACCESS } from "../../../shared/event-attendance-access";
import { attendanceTypeLabel } from "../../shared/attendance";
import { DataTable } from "../../components/Table";
import { registrationAttendanceColumns } from "../../components/event-registrations/registration-attendance-columns";
import type { RegistrationDayState } from "../../../shared/schemas/event-registrations";
import { countryOptions } from "../../../shared/countries";
import { BADGE_DISPLAY_ROLE_LABELS, badgeDisplayRoleSchema } from "../../../shared/schemas/participant-roles";
import { PersonCell } from "../PersonCell";
import { useColumnControls, TableOptionsMenu } from "../../components/table-column-controls";

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
const rows: Array<{
  name: string;
  organization: string;
  jobTitle: string;
  country: string;
  role: string;
  consent: boolean;
  days: RegistrationDayState[];
}> = [
  {
    name: "Alex Example",
    organization: "Example Trust Systems",
    jobTitle: "Security architect",
    country: "NL",
    role: "speaker",
    consent: true,
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
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const columns = [
    {
      header: "Attendee",
      cell: (row: (typeof rows)[number]) => <PersonCell name={row.name} size="sm" />,
      width: "primary" as const,
    },
    { header: "Organization", cell: (row: (typeof rows)[number]) => row.organization },
    {
      header: "Job title",
      cell: (row: (typeof rows)[number]) => row.jobTitle,
      defaultHidden: true,
      filter: { param: "job_title", text: { placeholder: "e.g. security architect" } },
    },
    {
      header: "Country",
      cell: (row: (typeof rows)[number]) => row.country,
      defaultHidden: true,
      filter: { param: "country", options: [{ value: "", label: "All countries" }, ...countryOptions()] },
    },
    {
      header: "Attendee type",
      cell: (row: (typeof rows)[number]) => row.role,
      defaultHidden: true,
      filter: {
        param: "badge_role",
        options: [
          { value: "", label: "All attendee types" },
          ...badgeDisplayRoleSchema.options.map((value) => ({ value, label: BADGE_DISPLAY_ROLE_LABELS[value] })),
        ],
      },
    },
    {
      header: "Consent",
      cell: (row: (typeof rows)[number]) => <SponsorConsentCell consent={row.consent} />,
      filter: {
        param: "consent",
        options: [
          { value: "", label: "All attendees" },
          { value: "true", label: "With consent" },
          { value: "false", label: "Without consent" },
        ],
      },
    },
    ...registrationAttendanceColumns<(typeof rows)[number]>(days, filters),
  ];
  const onFilterChange = (param: string, value: string) => setFilters((current) => ({ ...current, [param]: value }));
  const controls = useColumnControls(columns, { filters, onFilterChange });
  return (
    <div class="pk-table-list" data-density="compact">
      <CollectionToolbar
        label="Attendees controls"
        search={{
          value: search,
          onInput: setSearch,
          onSubmit: () => {},
          placeholder: "Name or organization",
          label: "Search attendees",
        }}
      >
        <RegistrationOutputActions
          attendeeUrl="/example-attendees.csv"
          sponsorUrl="/example-consenting-attendees.csv"
          onPrint={() => {}}
        />
        <span class="pk-table-list__card-menu">
          <TableOptionsMenu controls={controls} />
        </span>
      </CollectionToolbar>
      <DataTable
        caption="Attendees"
        columns={columns}
        data={rows.filter((row) => `${row.name} ${row.organization}`.toLowerCase().includes(search.toLowerCase()))}
        rowKey={(row) => row.name}
        filters={filters}
        onFilterChange={onFilterChange}
        controls={controls}
        tableOptionsFilters
      />
    </div>
  );
}
