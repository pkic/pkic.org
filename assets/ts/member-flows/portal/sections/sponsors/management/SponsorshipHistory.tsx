import type { MutableRef } from "preact/hooks";
import {
  sponsorshipEventsListResponseSchema,
  type SponsorshipEvent,
} from "../../../../../../shared/schemas/sponsorship-management";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { statusLabel } from "../../../../../components/Badge";
import { EmptyState } from "../../../../../components/EmptyState";
import type { Column } from "../../../../../components/Table";
import { fmt } from "../../../ui";

/**
 * One sponsorship's pipeline audit trail.
 *
 * This was an ordered list with a "Load older history" button behind a hook
 * of its own — a table of when/what/who/why rendered as prose, which could be
 * neither searched nor re-ordered even though the endpoint has taken `q` and
 * `sort=createdAt` since it was written (#42). It is the same trail the rest
 * of the portal shows through `AuditLogTable`, so it is now the same shared
 * table over the same bounded query.
 */
const HISTORY_COLUMNS: Column<SponsorshipEvent>[] = [
  {
    header: "When",
    // A timestamp is machine-readable as well as legible: the same `<time>`
    // the ordered list carried, now in the cell.
    cell: (event) => <time dateTime={event.createdAt}>{fmt(event.createdAt)}</time>,
    className: "pk-nowrap pk-small pk-muted",
    sort: { asc: "createdAt", desc: "-createdAt", defaultDirection: "desc" },
  },
  {
    header: "Change",
    cell: (event) =>
      event.fromStage ? (
        <>
          {statusLabel(event.fromStage)} → <strong>{statusLabel(event.toStage)}</strong>
        </>
      ) : (
        <strong>{statusLabel(event.toStage)}</strong>
      ),
    width: "fit",
  },
  {
    header: "By",
    cell: (event) => event.actorName ?? <span class="pk-muted">System</span>,
    width: "fit",
  },
  { header: "Note", cell: (event) => event.note, width: "primary" },
];

export function SponsorshipHistory({
  sponsorshipId,
  actionsRef,
}: {
  sponsorshipId: string;
  /** Lets the stage-move command refresh the trail it just wrote to. */
  actionsRef: MutableRef<ApiTableActions | null>;
}) {
  return (
    <ApiDataTable
      caption="Pipeline history"
      endpoint={`/api/v1/sponsors/${encodeURIComponent(sponsorshipId)}/events`}
      responseSchema={sponsorshipEventsListResponseSchema}
      resolve={(data) => data.events}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="note, stage or staff member"
      initialSort="-createdAt"
      actionsRef={actionsRef}
      columns={HISTORY_COLUMNS}
      rowKey={(event) => event.id}
      empty={
        <EmptyState
          title="No pipeline history has been recorded."
          body="A stage move writes the transition, who made it, and any note they left."
        />
      }
    />
  );
}
