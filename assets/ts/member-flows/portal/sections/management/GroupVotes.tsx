import { useRef, useState } from "preact/hooks";
import { groupVoteDetailResponseSchema, groupVotesListResponseSchema } from "../../../../../shared/schemas/group-votes";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { VoteDetails } from "../Votes/VoteCard";
import { GroupVoteLifecycleActions } from "./GroupVoteLifecycleActions";
import { ResourceCapabilities } from "./ResourceCapabilities";

export function GroupVotes({ groupId }: { groupId: string }) {
  const [selectedVoteId, setSelectedVoteId] = useState<string | null>(null);
  const tableActions = useRef<ApiTableActions | null>(null);
  const detail = useData(
    () =>
      selectedVoteId
        ? getJson(
            `/api/v1/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(selectedVoteId)}`,
            groupVoteDetailResponseSchema,
          )
        : Promise.resolve(null),
    [groupId, selectedVoteId],
  );

  async function reloadSelectedVote(): Promise<void> {
    await Promise.all([detail.reload(), tableActions.current?.reload()]);
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Votes</div>
      <div class="card-body">
        <ApiDataTable
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/votes`}
          responseSchema={groupVotesListResponseSchema}
          resolve={(response) => response.votes}
          resolvePage={(response) => response.page}
          paginate
          searchPlaceholder="Search votes…"
          initialSort="-closes_at"
          actionsRef={tableActions}
          columns={[
            {
              header: "Vote",
              cell: (vote) => (
                <div>
                  <div class="fw-semibold">{vote.title}</div>
                  {vote.description && <div class="small text-muted">{vote.description}</div>}
                </div>
              ),
              sort: { asc: "title", desc: "-title" },
            },
            { header: "Type", cell: (vote) => <Badge status={vote.voteType} /> },
            {
              header: "Status",
              cell: (vote) => <Badge status={vote.status} />,
              sort: { asc: "status", desc: "-status" },
            },
            {
              header: "Closes",
              cell: (vote) => fmt(vote.closesAt),
              className: "text-nowrap",
              sort: { asc: "closes_at", desc: "-closes_at", defaultDirection: "desc" },
            },
            { header: "Access", cell: (vote) => <ResourceCapabilities capabilities={vote.capabilities} /> },
            {
              header: "",
              className: "text-end",
              cell: (vote) => (
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  aria-expanded={selectedVoteId === vote.id}
                  onClick={() => setSelectedVoteId((current) => (current === vote.id ? null : vote.id))}
                >
                  {selectedVoteId === vote.id ? "Hide" : "Details"}
                </button>
              ),
            },
          ]}
          empty="No votes are available through this group."
          rowKey={(vote) => vote.id}
          detailRow={(vote) => {
            if (selectedVoteId !== vote.id) return null;
            if (detail.loading) return <Spinner />;
            if (detail.error) return <ErrorAlert error={detail.error} />;
            if (detail.data?.vote.id !== vote.id) return null;
            return (
              <div class="p-3 bg-body-tertiary">
                <GroupVoteLifecycleActions groupId={groupId} vote={detail.data.vote} onChanged={reloadSelectedVote} />
                <VoteDetails
                  vote={detail.data.vote}
                  ballotEndpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(vote.id)}/ballots`}
                  onChanged={reloadSelectedVote}
                />
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
