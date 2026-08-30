import { useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import type { EventProposalSummary } from "../../../../../shared/schemas/event-proposals";
import { proposalProgramsListResponseSchema } from "../../../../../shared/schemas/proposal-programs";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
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
}: {
  groupId: string;
  eventId: string;
  eventSlug?: string;
}) {
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
    <section aria-label="Event proposals" class="border-top pt-3 mt-3">
      {program && (
        <nav class="small text-muted mb-1" aria-label="Proposal program context">
          <span>{program.group.name}</span>
          <span aria-hidden="true"> / </span>
          <span>{program.event.name}</span>
        </nav>
      )}
      <h6>Proposal program</h6>
      {programCatalog.loading && !resolvedEventSlug ? (
        <Spinner />
      ) : programCatalog.error && !resolvedEventSlug ? (
        <ErrorAlert error={programCatalog.error} />
      ) : resolvedEventSlug ? (
        <EventProposalsTable
          endpoint={`/api/v1/events/${encodeURIComponent(resolvedEventSlug)}/proposals`}
          storageKey={`portal_proposal_filters_${groupId}_${eventId}`}
          onSelect={setSelected}
          empty="No proposals are available through this event."
        />
      ) : (
        <p class="text-muted fst-italic mb-0">This proposal program is not available.</p>
      )}
    </section>
  );
}
