import { useEffect, useId, useRef, useState } from "preact/hooks";
import { groupVoteDetailResponseSchema, groupVotesListResponseSchema } from "../../../../../shared/schemas/group-votes";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
import { fmt } from "../../ui";
import { VoteDetails } from "../Votes/VoteDetails";
import { GroupVoteCreateForm } from "./GroupVoteCreateForm";
import { GroupVoteManagementControls } from "./GroupVoteManagementControls";
import { GroupVoteProposals } from "./GroupVoteProposals";
import { ResourceCapabilities } from "./ResourceCapabilities";
import { ResourceSharingEditor } from "./ResourceSharingEditor";

/** Reserved vote segment that routes to the creation page instead of a vote's detail. */
const NEW_GROUP_VOTE_SEGMENT = "new";

/** Returns to the votes list from an effect, not render — see its call site below. */
function GroupVotesRedirect({ onLeave }: { onLeave: () => void }) {
  useEffect(() => onLeave(), [onLeave]);
  return null;
}

export function GroupVotes({
  groupId,
  canManage,
  canParticipate,
  voteSegment,
}: {
  groupId: string;
  canManage: boolean;
  canParticipate: boolean;
  /** `undefined` for the list, `"new"` for the create page, or a vote id for its detail. */
  voteSegment?: string;
}) {
  const idBase = useId();
  const tabIdPrefix = `${idBase}-tab`;
  const panelId = `${idBase}-panel`;
  const [, navigate] = usePortalHashLocation();
  const creating = voteSegment === NEW_GROUP_VOTE_SEGMENT;
  const [tab, setTab] = useState<"votes" | "proposals">("votes");
  const [selectedVoteId, setSelectedVoteId] = useState<string | null>(creating ? null : (voteSegment ?? null));
  const tableActions = useRef<ApiTableActions | null>(null);
  const votesPath = `/groups/${encodeURIComponent(groupId)}/votes`;
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

  function leaveCreatePage(): void {
    navigate(votesPath);
  }

  if (creating) {
    // Navigating away belongs in an effect, not in render.
    if (!canManage) return <GroupVotesRedirect onLeave={leaveCreatePage} />;
    return (
      // Creation is a page of its own: a way back, and the create form —
      // which names what is being created in its own heading — alone on the
      // screen rather than layered over the list.
      <div class="pk pk-stack">
        <div class="pk-cluster">
          <Button size="sm" onClick={leaveCreatePage}>
            ← All votes
          </Button>
        </div>
        <GroupVoteCreateForm
          groupId={groupId}
          onCreated={(createdVoteId) => navigate(`${votesPath}/${encodeURIComponent(createdVoteId)}`)}
          onCancel={leaveCreatePage}
        />
      </div>
    );
  }

  return (
    <div class="pk">
      <Panel aria-label="Votes">
        {/* The strip was a `<ul>` of buttons wearing `nav-link`: it looked
            like a tab set and announced itself as a list, so nothing told a
            screen reader which of the two was showing or that the arrows
            move between them. Nothing here navigates — both panels are on
            this page — so it is the WAI-ARIA tab pattern, with the panel
            pointing back at the tab that opened it. */}
        <PanelBody class="pk-stack">
          <Tabs
            label="Vote sections"
            idPrefix={tabIdPrefix}
            active={tab}
            onChange={(key) => setTab(key as "votes" | "proposals")}
            items={[
              { key: "votes", label: "All votes", panelId },
              { key: "proposals", label: "Proposals", panelId },
            ]}
          />
          <div id={panelId} role="tabpanel" aria-labelledby={`${tabIdPrefix}-${tab}`} class="pk-stack">
            {tab === "proposals" ? (
              <GroupVoteProposals groupId={groupId} canParticipate={canParticipate} />
            ) : (
              <ApiDataTable
                caption="All votes"
                endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/votes`}
                responseSchema={groupVotesListResponseSchema}
                resolve={(response) => response.votes}
                resolvePage={(response) => response.page}
                paginate
                createAction={
                  canManage
                    ? { label: "Create vote", onSelect: () => navigate(`${votesPath}/${NEW_GROUP_VOTE_SEGMENT}`) }
                    : undefined
                }
                searchPlaceholder="Search votes…"
                initialSort="-closes_at"
                actionsRef={tableActions}
                columns={[
                  {
                    header: "Vote",
                    cell: (vote) => (
                      <div class="pk-stack pk-stack--tight">
                        <span class="pk-strong">{vote.title}</span>
                        {vote.description && <span class="pk-small">{vote.description}</span>}
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
                    className: "pk-nowrap",
                    sort: { asc: "closes_at", desc: "-closes_at", defaultDirection: "desc" },
                  },
                  { header: "Access", cell: (vote) => <ResourceCapabilities capabilities={vote.capabilities} /> },
                  {
                    header: "",
                    className: "pk-end",
                    cell: (vote) => (
                      // The control names the vote it belongs to: a page of
                      // rows otherwise offers a column of buttons all
                      // called "Details".
                      <Button
                        size="sm"
                        aria-label={`${selectedVoteId === vote.id ? "Hide" : "Details"} for ${vote.title}`}
                        aria-expanded={selectedVoteId === vote.id}
                        onClick={() => setSelectedVoteId((current) => (current === vote.id ? null : vote.id))}
                      >
                        {selectedVoteId === vote.id ? "Hide" : "Details"}
                      </Button>
                    ),
                  },
                ]}
                empty={
                  canManage ? (
                    // The way out is named, not repeated: the toolbar above
                    // already carries "Create vote", and a second button
                    // with that same name is one command answering to two
                    // controls.
                    <EmptyState title="No votes yet" body="Use Create vote above to get started." />
                  ) : (
                    "No votes are available through this group."
                  )
                }
                rowKey={(vote) => vote.id}
                detailRow={(vote) => {
                  if (selectedVoteId !== vote.id) return null;
                  if (detail.loading) return <Spinner label="Loading vote…" />;
                  if (detail.error) return <ErrorAlert error={detail.error} />;
                  if (detail.data?.vote.id !== vote.id) return null;
                  return (
                    // The expanded cell has no padding of its own — DataTable
                    // zeroes it so the row's owner decides — so the panel body
                    // supplies it on the space scale, and its `gap` replaces
                    // the margins the stacked editors each used to carry.
                    <PanelBody class="pk-stack">
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
                    </PanelBody>
                  );
                }}
              />
            )}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
