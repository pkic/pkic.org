import { DataTable, type DataTableColumn } from "../../../../../ui/DataTable";
import { EmptyState } from "../../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { StatCard } from "../../../../../ui/StatCard";
import { attendanceTypeLabel } from "../attendance";
import type { EventStatsResponse } from "../types";
import { fmt } from "../../../ui";
import { eventRegistrationViewPath } from "./registration-paths";
import "../../../../../ui/Content.css";

type AttendanceChanges = EventStatsResponse["attendanceChanges"];
type AttendanceChangeDayRow = AttendanceChanges["byDay"][number];
type AttendanceChangeTransitionRow = AttendanceChanges["byTransition"][number];
type AttendanceChangeRecentRow = AttendanceChanges["recent"][number];

/** "In-person → Virtual", in the vocabulary the rest of the event uses. */
function transitionLabel(row: { from_type: string; to_type: string }): string {
  return `${attendanceTypeLabel(row.from_type)} → ${attendanceTypeLabel(row.to_type)}`;
}

const BY_DAY_COLUMNS: ReadonlyArray<DataTableColumn<AttendanceChangeDayRow>> = [
  { id: "day", header: "Event day", cell: (row) => row.label ?? row.day_date },
  {
    id: "attendees",
    header: "Attendees",
    align: "end",
    cell: (row) => <span class="pk-strong">{row.changed_attendees}</span>,
  },
  { id: "left", header: "No longer in-person", align: "end", cell: (row) => row.left_in_person_attendees },
  { id: "joined", header: "Now in-person", align: "end", cell: (row) => row.joined_in_person_attendees },
  {
    id: "dayChanges",
    header: "Day changes",
    align: "end",
    cell: (row) => <span class="pk-muted">{row.day_changes}</span>,
  },
];

const BY_TRANSITION_COLUMNS: ReadonlyArray<DataTableColumn<AttendanceChangeTransitionRow>> = [
  { id: "change", header: "Change", cell: (row) => transitionLabel(row) },
  { id: "attendees", header: "Attendees", align: "end", cell: (row) => <span class="pk-strong">{row.attendees}</span> },
  { id: "days", header: "Days", align: "end", cell: (row) => <span class="pk-muted">{row.day_changes}</span> },
];

/** The slug is part of every attendee link, so these columns are built per event. */
function recentColumns(slug: string): ReadonlyArray<DataTableColumn<AttendanceChangeRecentRow>> {
  return [
    {
      id: "attendee",
      header: "Attendee",
      cell: (row) => (
        <>
          <a class="pk-strong" href={`#${eventRegistrationViewPath(slug, row.registration_id)}`}>
            {row.display_name ?? row.user_email ?? row.registration_id}
          </a>
          {row.display_name && row.user_email && <div class="pk-small">{row.user_email}</div>}
        </>
      ),
    },
    {
      id: "days",
      header: "Event days",
      cell: (row) => (
        <>
          {row.days.map((day) => day.label ?? day.day_date).join(", ")}
          {row.days.length > 1 && <span class="pk-muted"> ({row.days.length} days)</span>}
        </>
      ),
    },
    { id: "change", header: "Change", cell: (row) => transitionLabel(row) },
    { id: "when", header: "When", cell: (row) => <span class="pk-mono pk-small">{fmt(row.changed_at)}</span> },
  ];
}

const dayRowKey = (row: AttendanceChangeDayRow): string => row.day_date;
const transitionRowKey = (row: AttendanceChangeTransitionRow): string => `${row.from_type}->${row.to_type}`;
const recentRowKey = (row: AttendanceChangeRecentRow): string =>
  `${row.registration_id}:${row.changed_at}:${row.from_type}:${row.to_type}`;

export function AttendanceChangeDashboard({ slug, changes }: { slug: string; changes: AttendanceChanges }) {
  const registrationsHref = `#/events/${slug}/registrations/attendance-changed`;

  /*
   * The Bootstrap surface tinted the two in-person figures amber and green to
   * mark which direction attendance had moved. StatCard has no such variant by
   * design — a tint is invisible to a reader who cannot separate the hues — so
   * the direction stays where it already was in words, in each card's label,
   * and the drill-down links below name their subset instead of relying on the
   * reader having decoded a colour.
   */
  return (
    <Panel class="pk">
      <PanelHeader title="Attendance movement" headingLevel={2}>
        <a href={registrationsHref}>Browse changed attendees →</a>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <p class="pk-small">Attendee totals count each person once. Day changes count each affected event day.</p>

        <div class="pk-grid pk-grid--tight">
          <StatCard
            label="Attendees changed"
            value={String(changes.changedAttendees)}
            note="unique people across the event"
          />
          <StatCard
            label="No longer in-person"
            value={String(changes.leftInPersonAttendees)}
            note={`${String(changes.leftInPersonDayChanges)} moves from in-person`}
          />
          <StatCard
            label="Now in-person"
            value={String(changes.joinedInPersonAttendees)}
            note={`${String(changes.joinedInPersonDayChanges)} moves to in-person`}
          />
          <StatCard label="Day changes" value={String(changes.dayChanges)} note="one attendee-day per change" />
        </div>

        <div class="pk-cluster pk-small">
          <a href={`#/events/${slug}/registrations/left-in-person`}>Attendees who left in-person</a>
          <a href={`#/events/${slug}/registrations/joined-in-person`}>Attendees who joined in-person</a>
        </div>

        {changes.changedAttendees > 0 ? (
          <>
            <div class="pk-grid pk-grid--roomy">
              <DataTable
                caption="Where attendance changed"
                showCaption
                columns={BY_DAY_COLUMNS}
                rows={changes.byDay}
                rowKey={dayRowKey}
                empty={<EmptyState title="No event day has recorded a change yet." />}
              />
              <DataTable
                caption="How attendance changed"
                showCaption
                columns={BY_TRANSITION_COLUMNS}
                rows={changes.byTransition}
                rowKey={transitionRowKey}
                empty={<EmptyState title="No transition has been recorded yet." />}
              />
            </div>

            <DataTable
              caption="Recent attendee changes"
              showCaption
              columns={recentColumns(slug)}
              rows={changes.recent}
              rowKey={recentRowKey}
              empty={<EmptyState title="No recent change to show." />}
            />
          </>
        ) : (
          <EmptyState title="No attendees have changed attendance after registration." />
        )}
      </PanelBody>
    </Panel>
  );
}
