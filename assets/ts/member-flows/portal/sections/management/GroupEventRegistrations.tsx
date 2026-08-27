import { useRef, useState } from "preact/hooks";
import { eventAttendanceRegistrationsListResponseSchema } from "../../../../../shared/schemas/event-registrations";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { fmt } from "../../ui";
import { GroupEventRegistrationAttendance } from "./GroupEventRegistrationAttendance";

export function GroupEventRegistrations({ groupId, eventId }: { groupId: string; eventId: string }) {
  const [selectedRegistrationId, setSelectedRegistrationId] = useState<string | null>(null);
  const [managementMessage, setManagementMessage] = useState<string | null>(null);
  const tableActions = useRef<ApiTableActions | null>(null);

  return (
    <div>
      <h6 class="small fw-semibold">Attendees</h6>
      {managementMessage && (
        <div class="alert alert-success small py-2" role="status" aria-live="polite">
          {managementMessage}
        </div>
      )}
      <ApiDataTable
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
              <div>
                <div class="fw-semibold">{registration.display_name ?? "—"}</div>
                {registration.user_email && <div class="small text-muted">{registration.user_email}</div>}
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
            cell: (registration) => fmt(registration.created_at),
            className: "text-nowrap",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
          {
            header: "",
            className: "text-end",
            cell: (registration) => (
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                aria-expanded={selectedRegistrationId === registration.id}
                onClick={() =>
                  setSelectedRegistrationId((current) => (current === registration.id ? null : registration.id))
                }
              >
                {selectedRegistrationId === registration.id ? "Hide" : "Manage attendance"}
              </button>
            ),
          },
        ]}
        empty="No registrations for this event."
        rowKey={(registration) => registration.id}
        detailRow={(registration) =>
          selectedRegistrationId === registration.id ? (
            <div class="p-3 bg-body-tertiary">
              <GroupEventRegistrationAttendance
                groupId={groupId}
                eventId={eventId}
                registrationId={registration.id}
                onUpdated={async (message) => {
                  setManagementMessage(message);
                  await tableActions.current?.reload();
                }}
              />
            </div>
          ) : null
        }
      />
    </div>
  );
}
