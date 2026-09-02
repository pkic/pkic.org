/**
 * The attendee roster for one group event, with per-row attendance management.
 *
 * The expanded region is the table's own detail row, which already draws the
 * sunk ground the Bootstrap version painted with `bg-body-tertiary` and zeroes
 * the cell padding so the content owns its layout.
 */
import { useRef, useState } from "preact/hooks";
import { eventAttendanceRegistrationsListResponseSchema } from "../../../../../shared/schemas/event-registrations";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { Alert } from "../../../../ui/Alert";
import { fmtDate } from "../../ui";
import { GroupEventRegistrationAttendance } from "./GroupEventRegistrationAttendance";

export function GroupEventRegistrations({
  groupId,
  eventId,
  canVip,
}: {
  groupId: string;
  eventId: string;
  canVip: boolean;
}) {
  const [selectedRegistrationId, setSelectedRegistrationId] = useState<string | null>(null);
  const [managementMessage, setManagementMessage] = useState<string | null>(null);
  const tableActions = useRef<ApiTableActions | null>(null);

  return (
    // The tab above already says Registrations; a second heading calling the
    // same rows "Attendees" was one collection wearing two names.
    <div class="pk-stack pk-stack--snug">
      {/* An outcome the reader did not ask to see, so it is announced
          politely rather than interrupting — which is what an `ok` Alert
          does — and its words say what happened without the tone. */}
      {managementMessage && <Alert tone="ok">{managementMessage}</Alert>}
      <ApiDataTable
        caption="Registrations"
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registrations`}
        responseSchema={eventAttendanceRegistrationsListResponseSchema}
        resolve={(response) => response.registrations}
        resolvePage={(response) => response.page}
        paginate
        actionsRef={tableActions}
        searchPlaceholder="Search registrations…"
        initialSort="display_name"
        columns={[
          {
            header: "Name / email",
            cell: (registration) => (
              <div class="pk-stack pk-stack--tight">
                <div class="pk-strong">{registration.display_name ?? "—"}</div>
                {registration.user_email && <div class="pk-small">{registration.user_email}</div>}
              </div>
            ),
            sort: { asc: "display_name", desc: "-display_name" },
          },
          {
            header: "Status",
            cell: (registration) => <Badge status={registration.status} />,
            width: "fit",
            sort: { asc: "status", desc: "-status" },
          },
          {
            header: "Attendance",
            cell: (registration) => registration.attendance_type ?? "—",
            width: "fit",
            sort: { asc: "attendance_type", desc: "-attendance_type" },
          },
          {
            // A date has a bounded length; the column says so instead of
            // wearing `pk-nowrap` while still claiming slack.
            header: "Registered",
            cell: (registration) => fmtDate(registration.created_at),
            width: "fit",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
        ]}
        empty="No registrations for this event."
        rowKey={(registration) => registration.id}
        // Activating a row opens its attendance management in place — the
        // same rule as every other list. The "Manage attendance" button
        // column this replaces left the row itself inert.
        rowAction={(registration) => {
          const expanded = selectedRegistrationId === registration.id;
          const who = registration.display_name ?? "this attendee";
          return {
            label: expanded ? `Hide attendance for ${who}` : `Manage attendance for ${who}`,
            onSelect: () =>
              setSelectedRegistrationId((current) => (current === registration.id ? null : registration.id)),
          };
        }}
        detailRow={(registration) =>
          selectedRegistrationId === registration.id ? (
            <GroupEventRegistrationAttendance
              groupId={groupId}
              eventId={eventId}
              registrationId={registration.id}
              canVip={canVip}
              onUpdated={async (message) => {
                setManagementMessage(message);
                await tableActions.current?.reload();
              }}
            />
          ) : null
        }
      />
    </div>
  );
}
