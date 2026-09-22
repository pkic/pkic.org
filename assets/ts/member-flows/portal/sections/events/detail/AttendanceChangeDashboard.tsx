import { StackedBarChart } from "../../../../../ui/StackedBarChart";
import { statusBars } from "../../../../../ui/chart";
import { EmptyState } from "../../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { StatCard } from "../../../../../ui/StatCard";
import { attendanceTypeLabel } from "../../../../../shared/attendance";
import type { EventStatsResponse } from "../types";
import "../../../../../ui/Content.css";

type AttendanceChanges = EventStatsResponse["attendanceChanges"];
/** Both directions are displayed separately: a net total would hide movement. */
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

        <div class="pk-stat-row">
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
          <div class="pk-stack">
            <StackedBarChart
              caption="Where attendance changed"
              labels={changes.byDay.map((day) => day.label ?? day.day_date)}
              series={[
                {
                  label: "Attendees changed",
                  values: changes.byDay.map((day) => day.changed_attendees),
                  color: "var(--pk-info)",
                },
              ]}
            />
            <section aria-label="How attendance changed" class="pk-stack pk-stack--snug">
              <h3 class="pk-panel__title">How attendance changed</h3>
              <div
                dangerouslySetInnerHTML={{
                  __html: statusBars(
                    Object.fromEntries(
                      changes.byTransition.map((row) => [
                        `${attendanceTypeLabel(row.from_type)} → ${attendanceTypeLabel(row.to_type)}`,
                        row.attendees,
                      ]),
                    ),
                    changes.byTransition.reduce((sum, row) => sum + row.attendees, 0),
                  ),
                }}
              />
            </section>
          </div>
        ) : (
          <EmptyState title="No attendees have changed attendance after registration." />
        )}
      </PanelBody>
    </Panel>
  );
}
