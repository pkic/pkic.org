import { useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { EmptyState } from "../../../../components/EmptyState";
import { RowActions } from "../../../../ui/RowActions";
import type { MenuItem } from "../../../../ui/Menu";
import {
  eventAudienceDetailSchema,
  eventManagementSummarySchema,
  eventsListResponseSchema,
} from "../../../../../shared/schemas/event-management";
import { usePortalHashLocation } from "../../hash-location";
import { formatEventWhen, formatRelativeDays } from "../../ui";
import { ViewerEventState } from "./ViewerEventState";

// ────────────────────────────────────────────────────────
// Root events overview
//
// This is a projection, not the canonical home for events: an event's real
// home is its owning group's workspace (`/groups/:g/events/:e`). This screen
// exists so a member can see what is upcoming and where they stand — not to
// manage events, which happens inside the owning group.
// ────────────────────────────────────────────────────────

type ManagementEventRow = z.infer<typeof eventManagementSummarySchema>;
type AudienceEventRow = z.infer<typeof eventAudienceDetailSchema>;
type EventRow = ManagementEventRow | AudienceEventRow;
type EventsResponse = z.infer<typeof eventsListResponseSchema>;

/**
 * The backend decides the response shape once per request, from the
 * caller's own permissions — never per row (management callers get every
 * row as `eventManagementSummarySchema`, everyone else gets every row as
 * `eventAudienceDetailSchema`). Checking for the `viewer` key, which only
 * the audience shape defines, is a safe per-row discriminant either way.
 */
function isAudienceEvent(event: EventRow): event is AudienceEventRow {
  return "viewer" in event;
}

function eventWhen(event: EventRow): string {
  const location = isAudienceEvent(event) ? event.location : null;
  const attendanceType = isAudienceEvent(event) ? (event.viewer?.attendanceType ?? null) : null;
  return formatEventWhen(event.startsAt, event.timezone, location, attendanceType);
}

/**
 * Only a management-shaped row carries an owning group, and only when one
 * is set. Everyone else — every audience row, and a management row with no
 * owning group — gets no menu at all.
 */
function workspaceActions(event: EventRow, navigate: (path: string) => void): MenuItem[] {
  if (isAudienceEvent(event) || !event.ownerGroupId) return [];
  const groupId = event.ownerGroupId;
  const groupLabel = event.ownerGroupName ?? "group";
  return [
    {
      id: "open-workspace",
      label: `Open in ${groupLabel} workspace`,
      onSelect: () => navigate(`/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`),
    },
  ];
}

type Scope = "upcoming" | "past";

function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (scope: Scope) => void }) {
  return (
    <div class="btn-group btn-group-sm" role="group" aria-label="Events scope">
      <button
        type="button"
        class={`btn btn-outline-secondary${scope === "upcoming" ? " active" : ""}`}
        aria-pressed={scope === "upcoming"}
        onClick={() => onChange("upcoming")}
      >
        Upcoming
      </button>
      <button
        type="button"
        class={`btn btn-outline-secondary${scope === "past" ? " active" : ""}`}
        aria-pressed={scope === "past"}
        onClick={() => onChange("past")}
      >
        Past
      </button>
    </div>
  );
}

export function EventList() {
  const [, navigate] = usePortalHashLocation();
  const [scope, setScope] = useState<Scope>("upcoming");
  const tableRef = useRef<ApiTableActions | null>(null);
  const now = new Date().toISOString();

  return (
    <div>
      <ApiDataTable<EventRow, EventsResponse>
        // Remounting on scope change resets pagination and default sort
        // together, so "Past" reliably opens on most-recent-first.
        key={scope}
        urlState="events"
        endpoint="/api/v1/events"
        responseSchema={eventsListResponseSchema}
        resolve={(data) => data.events}
        resolvePage={(data) => data.page}
        params={scope === "upcoming" ? { from: now } : { to: now }}
        initialSort={scope === "past" ? "-starts_at" : ""}
        paginate
        actionsRef={tableRef}
        searchPlaceholder="Search events…"
        toolbar={() => <ScopeToggle scope={scope} onChange={setScope} />}
        columns={[
          {
            header: "Event",
            cell: (e) => <strong class="adm-cell-name">{e.name}</strong>,
            sort: { asc: "name", desc: "-name" },
          },
          {
            header: "When",
            cell: (e) => {
              const relative = formatRelativeDays(e.startsAt);
              return (
                <>
                  {eventWhen(e)}
                  {relative && <span class="text-muted ms-2">({relative})</span>}
                </>
              );
            },
            sort: { asc: "starts_at", desc: "-starts_at", defaultDirection: scope === "past" ? "desc" : "asc" },
          },
          {
            header: "Group",
            cell: (e) =>
              !isAudienceEvent(e) && e.ownerGroupId ? (
                <a href={`#/groups/${encodeURIComponent(e.ownerGroupId)}`}>{e.ownerGroupName ?? e.ownerGroupId}</a>
              ) : (
                <span class="text-muted">—</span>
              ),
          },
          {
            header: "Your status",
            cell: (e) => (isAudienceEvent(e) && e.viewer ? <ViewerEventState viewer={e.viewer} /> : null),
          },
          {
            header: "",
            cell: (e) => <RowActions label={`Actions for ${e.name}`} actions={workspaceActions(e, navigate)} />,
          },
        ]}
        onRowClick={(e) => {
          if (e.basePath) window.location.assign(e.basePath);
        }}
        empty={
          <EmptyState
            title={scope === "past" ? "No past events" : "No upcoming events"}
            body="Events are created inside their owning group's workspace."
          />
        }
        rowKey={(e) => e.id}
      />
    </div>
  );
}
