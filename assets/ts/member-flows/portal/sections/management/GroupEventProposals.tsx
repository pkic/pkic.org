import { useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { lazy, Suspense } from "preact/compat";
import type { EventProposalSummary } from "../../../../../shared/schemas/event-proposals";
import { proposalProgramsListResponseSchema } from "../../../../../shared/schemas/proposal-programs";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { EventProposalsTable } from "../../../../components/proposals/EventProposalsTable";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";

const ProposalDetailPage = lazy(() =>
  import("../events/detail/ProposalDetailPage").then((module) => ({ default: module.ProposalDetailPage })),
);

/** Program committee surface for a proposal program owned by the selected group event. */
export function GroupEventProposals({
  groupId,
  eventId,
  eventSlug,
  proposalPathFor,
}: {
  groupId: string;
  eventId: string;
  eventSlug?: string;
  /** URL-addresses proposal selection; without it, selection stays local state. */
  proposalPathFor?: (proposalId: string) => string;
}) {
  const [, navigate] = usePortalHashLocation();
  const [selected, setSelected] = useState<EventProposalSummary | null>(null);
  const programCatalog = useData(
    () =>
      getJson(
        `/api/v1/proposals/programs?groupId=${encodeURIComponent(groupId)}&eventId=${encodeURIComponent(eventId)}`,
        proposalProgramsListResponseSchema,
      ),
    [eventId, groupId],
  );
  const program = programCatalog.data?.programs[0];
  const resolvedEventSlug = eventSlug ?? program?.event.slug;

  if (selected) {
    return (
      <Suspense fallback={<Spinner />}>
        <ProposalDetailPage
          slug={resolvedEventSlug ?? ""}
          proposalId={selected.id}
          contextLabel={program ? `${program.group.name} / ${program.event.name}` : null}
          onBack={() => setSelected(null)}
        />
      </Suspense>
    );
  }

  return (
    // The section used to be a hairline rule and a bare heading. It states
    // what it is as a named panel instead, so it is one region a reader can
    // reach rather than a border between two runs of content.
    <Panel class="pk" aria-label="Proposal program">
      <PanelHeader title="Proposal program" headingLevel={4}>
        {program && (
          <nav class="pk-small" aria-label="Proposal program context">
            <span>{program.group.name}</span>
            <span aria-hidden="true"> / </span>
            <span>{program.event.name}</span>
          </nav>
        )}
      </PanelHeader>
      <PanelBody>
        {programCatalog.loading && !resolvedEventSlug ? (
          <Spinner />
        ) : programCatalog.error && !resolvedEventSlug ? (
          <ErrorAlert error={programCatalog.error} />
        ) : resolvedEventSlug ? (
          <EventProposalsTable
            endpoint={`/api/v1/events/${encodeURIComponent(resolvedEventSlug)}/proposals`}
            storageKey={`portal_proposal_filters_${groupId}_${eventId}`}
            onSelect={(proposal) => {
              if (proposalPathFor) {
                navigate(proposalPathFor(proposal.id));
              } else {
                setSelected(proposal);
              }
            }}
            empty="No proposals are available through this event."
          />
        ) : (
          <EmptyState
            title="This proposal program is not available."
            body="The event behind it may have been removed, or your access to it may have ended."
          />
        )}
      </PanelBody>
    </Panel>
  );
}
