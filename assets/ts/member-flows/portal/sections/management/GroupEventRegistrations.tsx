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
import { Button } from "../../../../ui/Button";
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
    <div class="pk-stack pk-stack--snug">
      <h3>Attendees</h3>
      {/* An outcome the reader did not ask to see, so it is announced
          politely rather than interrupting — which is what an `ok` Alert
          does — and its words say what happened without the tone. */}
      {managementMessage && <Alert tone="ok">{managementMessage}</Alert>}
      <ApiDataTable
        caption="Event attendees"
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registrations`}
        responseSchema={eventAttendanceRegistrationsListResponseSchema}
        resolve={(response) => response.registrations}
        resolvePage={(response) => response.page}
        paginate
        actionsRef={tableActions}
        searchPlaceholder="Search attendees…"
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
            sort: { asc: "status", desc: "-status" },
          },
          {
            header: "Attendance",
            cell: (registration) => registration.attendance_type ?? "—",
            sort: { asc: "attendance_type", desc: "-attendance_type" },
          },
          {
            header: "Registered",
            cell: (registration) => fmtDate(registration.created_at),
            className: "pk-nowrap",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
          {
            // A blank `th` is announced as an unnamed column; this one holds
            // the per-row attendance toggle, so it says so.
            header: "Manage",
            className: "pk-end",
            cell: (registration) => {
              const expanded = selectedRegistrationId === registration.id;
              const who = registration.display_name ?? "this attendee";
              const label = expanded ? "Hide" : "Manage attendance";
              return (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-expanded={expanded}
                  // Every row's control reads the same out of context, so the
                  // accessible name says whose attendance it opens. It keeps
                  // the visible words inside it, which is what lets someone
                  // driving by voice still say "Manage attendance".
                  aria-label={expanded ? `Hide attendance for ${who}` : `Manage attendance for ${who}`}
                  onClick={() =>
                    setSelectedRegistrationId((current) => (current === registration.id ? null : registration.id))
                  }
                >
                  {label}
                </Button>
              );
            },
          },
        ]}
        empty="No registrations for this event."
        rowKey={(registration) => registration.id}
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
