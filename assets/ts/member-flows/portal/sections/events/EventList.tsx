import { useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { EmptyState } from "../../../../components/EmptyState";
import { Chip } from "../../../../ui/Chip";
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
    // Two applied-filter toggles, which is what `Chip` is: each is a real
    // button carrying `aria-pressed`, and the pressed state is drawn rather
    // than announced only by an `active` class the design system never had.
    <div class="pk-cluster" role="group" aria-label="Events scope">
      <Chip pressed={scope === "upcoming"} onToggle={() => onChange("upcoming")}>
        Upcoming
      </Chip>
      <Chip pressed={scope === "past"} onToggle={() => onChange("past")}>
        Past
      </Chip>
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
        caption={scope === "past" ? "Past events" : "Upcoming events"}
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
            // A date-and-place line has a bounded length; without saying so
            // the event name's slack squeezed it into a four-line wrap.
            header: "When",
            cell: (e) => {
              const relative = formatRelativeDays(e.startsAt);
              return (
                <>
                  {eventWhen(e)}
                  {relative && <span class="pk-muted"> ({relative})</span>}
                </>
              );
            },
            width: "fit",
            sort: { asc: "starts_at", desc: "-starts_at", defaultDirection: scope === "past" ? "desc" : "asc" },
          },
          {
            header: "Group",
            cell: (e) =>
              !isAudienceEvent(e) && e.ownerGroupId ? (
                <a href={`#/groups/${encodeURIComponent(e.ownerGroupId)}`}>{e.ownerGroupName ?? e.ownerGroupId}</a>
              ) : (
                <span class="pk-muted">—</span>
              ),
          },
          {
            header: "Your status",
            cell: (e) => (isAudienceEvent(e) && e.viewer ? <ViewerEventState viewer={e.viewer} /> : null),
            // A badge has a bounded length; the slack belongs to the event
            // name, not spread between it and a column of short states.
            width: "fit",
          },
          {
            header: "",
            cell: (e) => <RowActions subject={e.name} actions={workspaceActions(e, navigate)} />,
          },
        ]}
        rowAction={(e) => (e.basePath ? { label: `Open ${e.name}`, href: e.basePath } : undefined)}
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
