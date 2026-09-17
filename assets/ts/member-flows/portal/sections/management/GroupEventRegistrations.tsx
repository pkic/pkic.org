/**
 * The attendee roster for one group event.
 *
 * One list panel, the way every other collection in the portal is drawn:
 * search, the column filters the API accepts, the rows, the pager. A row is a
 * link to the registration's own page. The attendance manager used to unfold
 * between the rows — a faceted record drawn as an expansion, with the site
 * header sliding over it and no address anyone could share — and the list
 * said "in_person" for a registration whose three days were one confirmed and
 * two waitlisted, and nothing at all about the waitlist.
 */
import { useState } from "preact/hooks";
import { PersonCell } from "../../../../ui/PersonCell";
import {
  EVENT_REGISTRATION_STATUSES,
  eventAttendanceRegistrationsListResponseSchema,
  eventRegistrationStatusLabel,
  type EventAttendanceRegistrationsStats,
} from "../../../../../shared/schemas/event-registrations";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { RegistrationDayStates } from "../../../../components/event-registrations/RegistrationDayStates";
import { RegistrationTotals } from "../../../../components/event-registrations/RegistrationTotals";
import { usePortalHashLocation } from "../../hash-location";
import { fmtDate } from "../../ui";

/** The registration's address inside its group event. */
export function groupEventRegistrationPath(groupId: string, eventId: string, registrationId: string): string {
  return `/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}`;
}

export function GroupEventRegistrations({ groupId, eventId }: { groupId: string; eventId: string }) {
  const [stats, setStats] = useState<EventAttendanceRegistrationsStats | null>(null);

  return (
    <div class="pk-stack pk-stack--snug">
      {stats && <RegistrationTotals stats={stats} />}
      <ApiDataTable
        caption="Registrations"
        urlState="registrations"
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registrations`}
        responseSchema={eventAttendanceRegistrationsListResponseSchema}
        resolve={(response) => response.registrations}
        resolvePage={(response) => response.page}
        onData={(response) => setStats(response.stats)}
        paginate
        searchPlaceholder="name or email"
        initialSort="display_name"
        columns={[
          {
            header: "Attendee",
            cell: (registration) => (
              <PersonCell
                name={registration.display_name ?? registration.user_email ?? "—"}
                email={registration.display_name && registration.user_email ? registration.user_email : undefined}
                avatarSrc={registration.headshot_url ?? undefined}
                size="sm"
              />
            ),
            width: "primary",
            sort: { asc: "display_name", desc: "-display_name" },
          },
          { header: "Organization", cell: (r) => r.organization_name ?? "—", className: "pk-small" },
          { header: "Job title", cell: (r) => r.job_title ?? "—", className: "pk-small", defaultHidden: true },
          {
            header: "Status",
            cell: (registration) => <Badge status={registration.status} />,
            width: "fit",
            sort: { asc: "status", desc: "-status" },
            filter: {
              param: "status",
              options: [
                { value: "", label: "All statuses" },
                ...EVENT_REGISTRATION_STATUSES.map((status) => ({
                  value: status as string,
                  label: eventRegistrationStatusLabel(status),
                })),
              ],
            },
          },
          {
            // Day by day, because the whole-registration type hides exactly
            // what a manager is looking for. The filter narrows to the rows
            // still waiting for a seat on any day.
            header: "Attendance",
            cell: (registration) => (
              <RegistrationDayStates days={registration.days} attendanceType={registration.attendance_type} />
            ),
            sort: { asc: "attendance_type", desc: "-attendance_type" },
            filter: {
              param: "waitlisted",
              options: [
                { value: "", label: "All attendance" },
                { value: "true", label: "On a day waitlist" },
                { value: "false", label: "Not waitlisted" },
              ],
            },
          },
          {
            header: "Registered",
            cell: (registration) => fmtDate(registration.created_at),
            width: "fit",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
        ]}
        empty="No registrations for this event."
        rowKey={(registration) => registration.id}
        rowAction={(registration) => ({
          label: `Open registration for ${registration.display_name ?? registration.user_email ?? "this attendee"}`,
          href: usePortalHashLocation.hrefs(groupEventRegistrationPath(groupId, eventId, registration.id)),
        })}
      />
    </div>
  );
}
