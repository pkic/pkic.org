import { useRef, useState } from "preact/hooks";
import { groupVoteDetailResponseSchema, groupVotesListResponseSchema } from "../../../../../shared/schemas/group-votes";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { VoteDetails } from "../Votes/VoteDetails";
import { GroupVoteCreateForm } from "./GroupVoteCreateForm";
import { GroupVoteManagementControls } from "./GroupVoteManagementControls";
import { GroupVoteProposals } from "./GroupVoteProposals";
import { ResourceCapabilities } from "./ResourceCapabilities";
import { ResourceSharingEditor } from "./ResourceSharingEditor";

export function GroupVotes({
  groupId,
  canManage,
  canParticipate,
  initialVoteId,
}: {
  groupId: string;
  canManage: boolean;
  canParticipate: boolean;
  initialVoteId?: string;
}) {
  const [tab, setTab] = useState<"votes" | "proposals">("votes");
  const [selectedVoteId, setSelectedVoteId] = useState<string | null>(initialVoteId ?? null);
  const [showCreate, setShowCreate] = useState(false);
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
        <ul class="nav nav-tabs mb-3">
          <li class="nav-item">
            <button type="button" class={`nav-link${tab === "votes" ? " active" : ""}`} onClick={() => setTab("votes")}>
              Votes
            </button>
          </li>
          <li class="nav-item">
            <button
              type="button"
              class={`nav-link${tab === "proposals" ? " active" : ""}`}
              onClick={() => setTab("proposals")}
            >
              Proposals
            </button>
          </li>
        </ul>
        {tab === "proposals" ? (
          <GroupVoteProposals groupId={groupId} canParticipate={canParticipate} />
        ) : (
          <>
            {canManage && (
              <div class="mb-3">
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  aria-expanded={showCreate}
                  onClick={() => setShowCreate((shown) => !shown)}
                >
                  {showCreate ? "Hide vote form" : "Create vote"}
                </button>
              </div>
            )}
            {showCreate && (
              <GroupVoteCreateForm
                groupId={groupId}
                onCreated={async () => {
                  setShowCreate(false);
                  await tableActions.current?.reload();
                }}
              />
            )}
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
                    {detail.data.vote.capabilities.includes("manage") && (
                      <>
                        {detail.data.vote.ownerGroupId === groupId && (
                          <ResourceSharingEditor
                            kind="vote"
                            groupId={groupId}
                            resourceId={detail.data.vote.id}
                            ownerGroupId={detail.data.vote.ownerGroupId}
                          />
                        )}
                        <GroupVoteManagementControls
                          groupId={groupId}
                          vote={detail.data.vote}
                          onChanged={reloadSelectedVote}
                        />
                      </>
                    )}
                    <VoteDetails
                      vote={detail.data.vote}
                      ballotEndpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(vote.id)}/ballots`}
                      onChanged={reloadSelectedVote}
                    />
                  </div>
                );
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
