import { eventRegistrationsListResponseSchema } from "../../../../../shared/schemas/event-registrations";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { fmt } from "../../ui";

export function GroupEventRegistrations({ groupId, eventId }: { groupId: string; eventId: string }) {
  return (
    <div>
      <h6 class="small fw-semibold">Attendees</h6>
      <ApiDataTable
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registrations`}
        responseSchema={eventRegistrationsListResponseSchema}
        resolve={(response) => response.registrations}
        resolvePage={(response) => response.page}
        paginate
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
        ]}
        empty="No registrations for this event."
        rowKey={(registration) => registration.id}
      />
    </div>
  );
}
