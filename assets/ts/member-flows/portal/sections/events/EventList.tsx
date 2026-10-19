import { EventCollectionCard, eventWhen } from "./EventCollectionCard";
import { CollectionStatusLine } from "../../../../ui/CollectionCard";
import { DiscoveryViewToggle, useDiscoveryView } from "../DiscoveryView";
import { formatEventPlace } from "../../../../../shared/event-place";
import { eventParticipantRecordPath } from "./event-participant-paths";
import { useRef } from "preact/hooks";
import type { z } from "zod";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { EmptyState } from "../../../../ui/EmptyState";
import { RowActions } from "../../../../ui/RowActions";
import type { MenuItem } from "../../../../ui/Menu";
import {
  eventAudienceDetailSchema,
  eventManagementSummarySchema,
  eventsListResponseSchema,
} from "../../../../../shared/schemas/event-management";
import { usePortalHashLocation } from "../../hash-location";
import { formatRelativeDays } from "../../ui";
import { canOpenGroupWorkspace, eventDestination } from "./event-destination";
import { portalSession } from "../../state";
import { eventViewerStatus } from "./event-viewer-status";
import { EventScopeToggle, eventScopeActions, useEventScope } from "./EventScopeToggle";

// ────────────────────────────────────────────────────────
// Root events overview
//
// Each row opens the group-independent event page (`/events/:slug`), where a
// reader sees where they stand. Managing an event happens inside its owning
// group's workspace (`/groups/:g/events/:e`), offered as a row action to
// those who can open it.
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

/**
 * Audience actions use server-granted scanner/contact access; a management
 * row also offers its owning workspace when this session can open it.
 */
function workspaceActions(event: EventRow, navigate: (path: string) => void): MenuItem[] {
  const registrationId = event.participation?.registrationId;
  const audienceActions: MenuItem[] = isAudienceEvent(event)
    ? [
        // The status row says where the viewer stands; the registration it
        // summarizes opens from here.
        ...(registrationId
          ? [
              {
                id: "registration",
                label: "Open your registration",
                onSelect: () => navigate(eventParticipantRecordPath(event.slug, "registration", registrationId)),
              },
            ]
          : []),
        ...(event.sponsorLeadAccess
          ? [
              {
                id: "sponsor-leads",
                label: "Open sponsor leads",
                onSelect: () => navigate(`/events/${encodeURIComponent(event.slug)}/leads`),
              },
            ]
          : []),
        ...(event.scannerAccess?.canScan
          ? [
              {
                id: "event-scanner",
                label: "Open event scanner",
                onSelect: () => navigate(`/events/${encodeURIComponent(event.slug)}/scanner`),
              },
            ]
          : []),
        ...(event.scannerAccess?.sponsors.map((sponsor) => ({
          id: `sponsor-scanner-${sponsor.id}`,
          label: `Scan leads for ${sponsor.name}`,
          onSelect: () =>
            navigate(`/events/${encodeURIComponent(event.slug)}/sponsors/${encodeURIComponent(sponsor.id)}/scanner`),
        })) ?? []),
      ]
    : [];
  if (isAudienceEvent(event) || !event.ownerGroupId || !canOpenGroupWorkspace(portalSession.value, event.ownerGroupId))
    return audienceActions;
  const groupId = event.ownerGroupId;
  const groupLabel = event.ownerGroupTypeLabel ?? "group";
  return [
    ...audienceActions,
    {
      id: "open-workspace",
      label: `Open in ${groupLabel}`,
      onSelect: () => navigate(`/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`),
    },
  ];
}

export function EventList() {
  const [, navigate] = usePortalHashLocation();
  const { view, setView } = useDiscoveryView();
  const { scope, setScope, params } = useEventScope();
  const tableRef = useRef<ApiTableActions | null>(null);

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
        params={params}
        initialSort={scope === "past" ? "-starts_at" : ""}
        paginate
        actionsRef={tableRef}
        searchPlaceholder="Search events…"
        toolbar={() => (
          <>
            <EventScopeToggle scope={scope} onChange={setScope} />
            <DiscoveryViewToggle view={view} onChange={setView} />
          </>
        )}
        toolbarClass="pk-discovery-toolbar pk-toolbar-row"
        compactToolbarLabel={`${scope === "upcoming" ? "Upcoming" : "Past"} events: filters and actions`}
        compactToolbarActions={eventScopeActions(scope, setScope)}
        framed={false}
        renderItems={
          view === "grid"
            ? (events) => (
                <>
                  <div class="pk-discovery-grid">
                    {events.map((event) => (
                      <EventCollectionCard
                        key={event.id}
                        event={event}
                        actions={<RowActions subject={event.name} actions={workspaceActions(event, navigate)} />}
                      />
                    ))}
                  </div>
                </>
              )
            : undefined
        }
        columns={[
          {
            header: "Event",
            cell: (e) => <strong>{e.name}</strong>,
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
            header: "Location",
            cell: (e) => formatEventPlace(e) ?? "—",
          },
          {
            header: "Group",
            cell: (e) =>
              isAudienceEvent(e) || !e.ownerGroupId ? (
                <span class="pk-muted">—</span>
              ) : canOpenGroupWorkspace(portalSession.value, e.ownerGroupId) ? (
                <a href={`#/groups/${encodeURIComponent(e.ownerGroupId)}`}>{e.ownerGroupName ?? e.ownerGroupId}</a>
              ) : (
                (e.ownerGroupName ?? e.ownerGroupId)
              ),
          },
          {
            header: "Your status",
            cell: (e) => <CollectionStatusLine items={eventViewerStatus(e)} />,
            // A badge has a bounded length; the slack belongs to the event
            // name, not spread between it and a column of short states.
            width: "fit",
          },
          {
            header: "",
            cell: (e) => <RowActions subject={e.name} actions={workspaceActions(e, navigate)} />,
          },
        ]}
        rowAction={(e) => ({ label: `Open ${e.name}`, href: eventDestination(e) })}
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
