/**
 * The proposal program of one group event: the shared catalogue, drawn as the
 * one list panel every collection in the portal is, with each row a link to
 * the proposal's own page under the event.
 *
 * It used to sit inside a titled panel — "Proposal program", with the group
 * and event names restated beside it — which said for a third time what the
 * breadcrumb, the workspace header and the tab already said, and fetched the
 * program catalogue to say it. The event's slug is the only thing the list
 * needs; when a caller cannot supply it, the program catalogue resolves it.
 */
import { proposalProgramsListResponseSchema } from "../../../../../shared/schemas/proposal-programs";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { EventProposalsTable } from "../../../../components/proposals/EventProposalsTable";
import { EventPresentationArchiveLinks } from "../../../../components/proposals/EventPresentationArchiveLinks";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { usePortalHashLocation } from "../../hash-location";

/** The proposal's address inside its group event. */
export function groupEventProposalPath(groupId: string, eventId: string, proposalId: string): string {
  return `/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/proposals/${encodeURIComponent(proposalId)}`;
}

export function GroupEventProposals({
  groupId,
  eventId,
  eventSlug,
}: {
  groupId: string;
  eventId: string;
  /** The event's slug, when the caller already holds the event; otherwise resolved from the program catalogue. */
  eventSlug?: string;
}) {
  const programCatalog = useData(
    () =>
      eventSlug
        ? Promise.resolve(null)
        : getJson(
            `/api/v1/proposals/programs?groupId=${encodeURIComponent(groupId)}&eventId=${encodeURIComponent(eventId)}`,
            proposalProgramsListResponseSchema,
          ),
    [eventId, groupId, eventSlug],
  );
  const resolvedEventSlug = eventSlug ?? programCatalog.data?.programs[0]?.event.slug;

  if (resolvedEventSlug) {
    return (
      <EventProposalsTable
        endpoint={`/api/v1/events/${encodeURIComponent(resolvedEventSlug)}/proposals`}
        urlState="proposals"
        rowHref={(proposal) => usePortalHashLocation.hrefs(groupEventProposalPath(groupId, eventId, proposal.id))}
        toolbarPrefix={(_, access) => (
          <EventPresentationArchiveLinks slug={resolvedEventSlug} canRead={access?.canRead === true} />
        )}
        empty="No proposals are available through this event."
      />
    );
  }
  if (programCatalog.loading) return <Spinner />;
  if (programCatalog.error) return <ErrorAlert error={programCatalog.error} />;
  return (
    <EmptyState
      title="This proposal program is not available."
      body="The event behind it may have been removed, or your access to it may have ended."
    />
  );
}
