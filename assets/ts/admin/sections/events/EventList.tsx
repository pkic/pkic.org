import { useRef } from "preact/hooks";
import { Badge } from "../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../components/ApiDataTable";
import { eventsManagementListResponseSchema } from "../../../../shared/schemas/event-management";
import { useHashLocation } from "wouter/use-hash-location";

// ────────────────────────────────────────────────────────
// Event list
//
// Events are created in the portal under their owning group. This screen
// reads the canonical auth-aware event collection, which returns the
// management projection to a caller holding live event read permission.
// ────────────────────────────────────────────────────────

export function EventList() {
  const [, navigate] = useHashLocation();
  const tableRef = useRef<ApiTableActions | null>(null);

  return (
    <div>
      <ApiDataTable
        endpoint="/api/v1/events"
        responseSchema={eventsManagementListResponseSchema}
        resolve={(data) => data.events}
        resolvePage={(data) => data.page}
        paginate
        actionsRef={tableRef}
        searchPlaceholder="Search event name or slug…"
        columns={[
          {
            header: "Event",
            cell: (e) => (
              <>
                <strong class="adm-cell-name">{e.name}</strong>
                <br />
                <span class="mono text-muted small">{e.slug}</span>
              </>
            ),
            sort: { asc: "name", desc: "-name" },
          },
          {
            header: "Dates",
            cell: (e) => (e.startsAt ? e.startsAt.substring(0, 10) : "—"),
            className: "mono small text-nowrap",
            sort: { asc: "starts_at", desc: "-starts_at", defaultDirection: "desc" },
          },
          {
            header: "Mode",
            cell: (e) => <Badge status={e.registrationPolicy} />,
            sort: { asc: "registration_mode", desc: "-registration_mode" },
          },
          {
            header: { label: "Confirmed", className: "text-end" },
            cell: (e) => e.confirmedRegistrations,
            className: "mono text-end",
          },
          {
            header: { label: "Total", className: "text-end" },
            cell: (e) => e.totalRegistrations,
            className: "mono text-end",
            sort: { asc: "total_registrations", desc: "-total_registrations" },
          },
          {
            header: { label: "Pending", className: "text-end" },
            cell: (e) => e.pendingInvites,
            className: "mono text-end",
          },
          {
            header: "",
            cell: (e) => (
              <button
                class="btn btn-sm btn-outline-success"
                onClick={() => navigate(`/events/${encodeURIComponent(e.slug)}`)}
              >
                Manage →
              </button>
            ),
          },
        ]}
        empty="No events found"
        rowKey={(e) => e.slug}
      />
    </div>
  );
}
