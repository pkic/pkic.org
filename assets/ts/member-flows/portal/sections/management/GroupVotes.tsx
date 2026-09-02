import { lazy, Suspense } from "preact/compat";
import { useId, useRef, useState } from "preact/hooks";
import { groupVoteDetailResponseSchema, groupVotesListResponseSchema } from "../../../../../shared/schemas/group-votes";
import { VOTE_STATUSES, VOTE_TYPES } from "../../../../../shared/schemas/votes";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge, statusLabel } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { HashRedirect } from "../../HashRedirect";
import { usePortalHashLocation } from "../../hash-location";
import { fmt } from "../../ui";
import { VoteDetails } from "../Votes/VoteDetails";
import { GroupVoteCreateForm } from "./GroupVoteCreateForm";
import { GroupVoteBallots, GroupVoteSettings } from "./GroupVoteManagementControls";
import { GroupVoteProposals } from "./GroupVoteProposals";
import { ResourceSharingEditor } from "./ResourceSharingEditor";
// `pk-record-title` ships in Content.css; the module that names it loads it.
import "../../../../ui/Content.css";

const GroupVoteStatistics = lazy(() =>
  import("./GroupVoteStatistics").then((module) => ({ default: module.GroupVoteStatistics })),
);

/** Reserved vote segment that routes to the creation page instead of a vote's detail. */
const NEW_GROUP_VOTE_SEGMENT = "new";

/** The vote record's facets. Each one loads its data when it is opened. */
const VOTE_RECORD_TABS = [
  { key: "overview", label: "Overview", manage: false },
  { key: "statistics", label: "Statistics", manage: true },
  { key: "ballots", label: "Ballots", manage: true },
  { key: "settings", label: "Settings", manage: true },
  { key: "sharing", label: "Sharing", manage: true },
] as const;

type VoteRecordTab = (typeof VOTE_RECORD_TABS)[number]["key"];

/**
 * A vote's own page: the way back to the list, the vote as the subject —
 * title, type, status, and when it closes — and one tab per facet, each
 * fetching only when opened. It replaces an expansion between the list's
 * rows that stacked sharing above the vote itself and hid the ballot audit
 * and the statistics behind "Load …" buttons.
 */
function GroupVoteRecord({
  groupId,
  voteId,
  initialTab,
  onLeave,
}: {
  groupId: string;
  voteId: string;
  /** The URL-addressed tab segment, if any. Undefined or unavailable selects Overview. */
  initialTab?: string;
  onLeave: () => void;
}) {
  const [, navigate] = usePortalHashLocation();
  const detail = useData(
    () =>
      getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(voteId)}`,
        groupVoteDetailResponseSchema,
      ),
    [groupId, voteId],
  );
  const vote = detail.data?.vote.id === voteId ? detail.data.vote : null;
  const canManage = vote?.capabilities.includes("manage") ?? false;
  const tabs = VOTE_RECORD_TABS.filter(
    (item) => (!item.manage || canManage) && (item.key !== "sharing" || vote?.ownerGroupId === groupId),
  ).map(({ key, label }) => ({ key, label }));
  const requested = initialTab as VoteRecordTab | undefined;
  const tab: VoteRecordTab = tabs.some((item) => item.key === requested) ? (requested as VoteRecordTab) : "overview";

  function tabPath(key: string): string {
    const base = `/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(voteId)}`;
    return key === "overview" ? base : `${base}/${key}`;
  }

  return (
    <div class="pk pk-stack">
      <div class="pk-cluster">
        <Button variant="link" size="sm" onClick={onLeave}>
          ← All votes
        </Button>
      </div>
      {detail.loading && !vote && <Spinner label="Loading vote…" />}
      {detail.error && <ErrorAlert error={detail.error} />}
      {vote && (
        <>
          <div class="pk-stack pk-stack--tight">
            <h3 class="pk-record-title">{vote.title}</h3>
            <div class="pk-cluster">
              <Badge status={vote.voteType} />
              <Badge status={vote.status} />
              <span class="pk-small pk-muted">Closes {fmt(vote.closesAt)}</span>
            </div>
          </div>
          {tabs.length > 1 && (
            <Tabs
              items={tabs}
              active={tab}
              label={`${vote.title} sections`}
              onChange={(key) => navigate(tabPath(key))}
              hrefFor={tabPath}
            />
          )}
          {tab === "overview" && (
            <VoteDetails
              vote={vote}
              ballotEndpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(voteId)}/ballots`}
              onChanged={detail.reload}
            />
          )}
          {tab === "statistics" && canManage && (
            <Suspense fallback={<Spinner label="Loading vote statistics…" />}>
              <GroupVoteStatistics groupId={groupId} voteId={voteId} />
            </Suspense>
          )}
          {tab === "ballots" && canManage && <GroupVoteBallots groupId={groupId} voteId={voteId} />}
          {tab === "settings" && canManage && (
            <GroupVoteSettings groupId={groupId} vote={vote} onChanged={detail.reload} />
          )}
          {tab === "sharing" && canManage && vote.ownerGroupId === groupId && (
            <ResourceSharingEditor
              kind="vote"
              groupId={groupId}
              resourceId={vote.id}
              ownerGroupId={vote.ownerGroupId}
            />
          )}
        </>
      )}
    </div>
  );
}

export function GroupVotes({
  groupId,
  canManage,
  canParticipate,
  voteSegment,
  voteTab,
}: {
  groupId: string;
  canManage: boolean;
  canParticipate: boolean;
  /** `undefined` for the list, `"new"` for the create page, or a vote id for its detail. */
  voteSegment?: string;
  /** The URL-addressed tab segment below a vote id. */
  voteTab?: string;
}) {
  const idBase = useId();
  const tabIdPrefix = `${idBase}-tab`;
  const panelId = `${idBase}-panel`;
  const [, navigate] = usePortalHashLocation();
  const creating = voteSegment === NEW_GROUP_VOTE_SEGMENT;
  const [tab, setTab] = useState<"votes" | "proposals">("votes");
  const tableActions = useRef<ApiTableActions | null>(null);
  const votesPath = `/groups/${encodeURIComponent(groupId)}/votes`;

  function leaveCreatePage(): void {
    navigate(votesPath);
  }

  if (creating) {
    if (!canManage) return <HashRedirect to={votesPath} />;
    return (
      // Creation is a page of its own: a way back, and the create form —
      // which names what is being created in its own heading — alone on the
      // screen rather than layered over the list.
      <div class="pk pk-stack">
        <div class="pk-cluster">
          <Button variant="link" size="sm" onClick={leaveCreatePage}>
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

  if (voteSegment) {
    // A vote is a record with facets, so it gets its own page rather than an
    // expansion between the list's rows.
    return <GroupVoteRecord groupId={groupId} voteId={voteSegment} initialTab={voteTab} onLeave={leaveCreatePage} />;
  }

  return (
    <div class="pk pk-stack">
      {/* Nothing here navigates — both collections live on this page — so it
          is the WAI-ARIA tab pattern, with the panel pointing back at the tab
          that opened it. The tabs stand above the list panel the way the
          workspace's own tabs stand above its content. */}
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
              // Both filters already exist on the votes contract; each lives
              // in the column that shows the value it narrows, rather than
              // leaving status and type to search syntax.
              {
                header: "Type",
                cell: (vote) => <Badge status={vote.voteType} />,
                width: "fit",
                filter: {
                  param: "type",
                  options: [
                    { value: "", label: "All types" },
                    ...VOTE_TYPES.map((type) => ({ value: type as string, label: statusLabel(type) })),
                  ],
                },
              },
              {
                header: "Status",
                cell: (vote) => <Badge status={vote.status} />,
                width: "fit",
                sort: { asc: "status", desc: "-status" },
                filter: {
                  param: "status",
                  options: [
                    { value: "", label: "All statuses" },
                    ...VOTE_STATUSES.map((status) => ({ value: status as string, label: statusLabel(status) })),
                  ],
                },
              },
              {
                // A date has a bounded length; the column says so instead
                // of wearing `pk-nowrap` while still claiming slack.
                header: "Closes",
                cell: (vote) => fmt(vote.closesAt),
                width: "fit",
                sort: { asc: "closes_at", desc: "-closes_at", defaultDirection: "desc" },
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
            // A vote is a URL-addressed record; the row is a link to it, so
            // it can be opened in a new tab and the address bar follows.
            rowAction={(vote) => ({
              label: `Open ${vote.title}`,
              href: `#${votesPath}/${encodeURIComponent(vote.id)}`,
            })}
          />
        )}
      </div>
    </div>
  );
}
