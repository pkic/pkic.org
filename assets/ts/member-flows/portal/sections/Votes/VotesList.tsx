import type { z } from "zod";
import { portalVotesListResponseSchema } from "../../../../../shared/schemas/votes";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { useApiPage } from "../../../../hooks/useApiPage";
import { VoteCard } from "./VoteCard";

type PortalVotesListResponse = z.infer<typeof portalVotesListResponseSchema>;

export function VotesList() {
  const open = useApiPage<PortalVotesListResponse>(
    "/api/v1/portal/votes",
    { status: "open" },
    portalVotesListResponseSchema,
    (data) => data.votes,
  );
  const upcoming = useApiPage<PortalVotesListResponse>(
    "/api/v1/portal/votes",
    { status: "scheduled" },
    portalVotesListResponseSchema,
    (data) => data.votes,
  );
  const closed = useApiPage<PortalVotesListResponse>(
    "/api/v1/portal/votes",
    { status: "closed,cancelled" },
    portalVotesListResponseSchema,
    (data) => data.votes,
  );

  const sections = [
    { label: "Open for voting", result: open },
    { label: "Upcoming", result: upcoming },
    { label: "Closed", result: closed },
  ];
  const failed = sections.find(({ result }) => result.error)?.result.error;
  if (failed) return <ErrorAlert error={failed instanceof Error ? failed.message : "Could not load votes."} />;
  if (sections.some(({ result }) => !result.data)) return <Spinner />;
  if (sections.every(({ result }) => result.data?.page.total === 0)) {
    return <p class="text-muted">No votes are visible to you right now.</p>;
  }

  return (
    <div class="d-flex flex-column gap-4 content-width-reading">
      {sections
        .filter(({ result }) => result.data && result.data.page.total > 0)
        .map(({ label, result }) => (
          <section key={label}>
            <h3 class="h6 text-muted">{label}</h3>
            <div class="d-flex flex-column gap-3">
              {result.data?.votes.map((vote) => (
                <VoteCard key={vote.id} vote={vote} onChanged={result.reload} />
              ))}
            </div>
            {result.pagerProps && <Pager {...result.pagerProps} />}
          </section>
        ))}
    </div>
  );
}
