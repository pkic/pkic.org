import { BreadcrumbBranch } from "../../../../ui/BreadcrumbScope";
import { lazy, Suspense } from "preact/compat";
import { useId, useRef } from "preact/hooks";
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
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { HashRedirect } from "../../HashRedirect";
import { usePortalHashLocation } from "../../hash-location";
import { fmt } from "../../ui";
import { VoteDetails } from "../Votes/VoteDetails";
import { GroupVoteCreateForm } from "./GroupVoteCreateForm";
import { GroupVoteBallots, GroupVoteSettings } from "./GroupVoteManagementControls";
import { GroupVoteProposalRecord, GroupVoteProposals } from "./GroupVoteProposals";
import { GroupVoteProposalForm } from "./GroupVoteProposalForm";
import { ResourceSharingEditor } from "./ResourceSharingEditor";

const GroupVoteStatistics = lazy(() =>
  import("./GroupVoteStatistics").then((module) => ({ default: module.GroupVoteStatistics })),
);

/** Reserved vote segment that routes to the creation page instead of a vote's detail. */
const NEW_GROUP_VOTE_SEGMENT = "new";
/**
 * Proposing a vote is a second reserved segment on the same route rather than
 * a level of its own: the proposals list is a tab this section swaps, not an
 * address, so a nested `proposals/new` would name a place the router cannot
 * reach. Arriving here also selects the tab the proposal belongs to.
 */
const PROPOSE_GROUP_VOTE_SEGMENT = "propose";
/**
 * The proposals list is addressable — `votes/proposals` — and a proposal's
 * own page sits under it (#126): `votes/proposals/<id>`.
 */
const PROPOSALS_SEGMENT = "proposals";

/** The vote record's facets. Each one loads its data when it is opened. */
const VOTE_RECORD_TABS = [
  { key: "overview", label: "Overview", manage: false },
  { key: "statistics", label: "Analytics", manage: true },
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
}: {
  groupId: string;
  voteId: string;
  /** The URL-addressed tab segment, if any. Undefined or unavailable selects Overview. */
  initialTab?: string;
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
      {detail.loading && !vote && <Spinner label="Loading vote…" />}
      {detail.error && <ErrorAlert error={detail.error} />}
      {vote && (
        <BreadcrumbBranch
          items={[
            { label: vote.title, href: usePortalHashLocation.hrefs(tabPath("overview")) },
            {
              label: tabs.find((item) => item.key === tab)?.label ?? tab,
              href: usePortalHashLocation.hrefs(tabPath(tab)),
            },
          ]}
        >
          <ProfileHeader
            headingLevel={3}
            title={vote.title}
            context={
              <>
                <Badge status={vote.voteType} />
                <Badge status={vote.status} />
              </>
            }
            lede={<>Closes {fmt(vote.closesAt)}</>}
          />
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
            <Suspense fallback={<Spinner label="Loading vote analytics…" />}>
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
        </BreadcrumbBranch>
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
  const proposing = voteSegment === PROPOSE_GROUP_VOTE_SEGMENT;
  const listingProposals = voteSegment === PROPOSALS_SEGMENT;
  const tab: "votes" | "proposals" = listingProposals ? "proposals" : "votes";
  const tableActions = useRef<ApiTableActions | null>(null);
  const votesPath = `/groups/${encodeURIComponent(groupId)}/votes`;
  const proposalsPath = `${votesPath}/${PROPOSALS_SEGMENT}`;

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
        <GroupVoteCreateForm
          groupId={groupId}
          onCreated={(createdVoteId) => navigate(`${votesPath}/${encodeURIComponent(createdVoteId)}`)}
          onCancel={leaveCreatePage}
        />
      </div>
    );
  }

  if (proposing) {
    if (!canParticipate) return <HashRedirect to={votesPath} />;
    return (
      // Proposing is a page of its own, the way creating a vote is: a way
      // back, and the form alone rather than layered over the proposals list.
      <div class="pk pk-stack">
        <GroupVoteProposalForm groupId={groupId} onCreated={async () => navigate(proposalsPath)} />
      </div>
    );
  }

  if (listingProposals && voteTab) {
    // A proposal is a record with commands, so it gets its own page rather
    // than an expansion between the list's rows (#126).
    return <GroupVoteProposalRecord groupId={groupId} proposalId={voteTab} listPath={proposalsPath} />;
  }

  if (voteSegment && !listingProposals) {
    // A vote is a record with facets, so it gets its own page rather than an
    // expansion between the list's rows.
    return <GroupVoteRecord groupId={groupId} voteId={voteSegment} initialTab={voteTab} />;
  }

  return (
    <div class="pk pk-stack">
      {/* Each collection has an address — the proposals list carries the
          proposal pages under it — so the tabs navigate, as links carrying
          `aria-current`, rather than swapping a panel in place. */}
      <Tabs
        label="Vote sections"
        idPrefix={tabIdPrefix}
        active={tab}
        onChange={(key) => navigate(key === "proposals" ? proposalsPath : votesPath)}
        hrefFor={(key) => (key === "proposals" ? proposalsPath : votesPath)}
        items={[
          { key: "votes", label: "All votes" },
          { key: "proposals", label: "Proposals" },
        ]}
      />
      {/*
        What the two collections are, in one line (#52).
        
        The tabs named them and nothing said how they relate, so a reader who
        could create one and not the other reasonably read that as broken. A
        vote is the ballot the group runs; a proposal is a participant asking
        for one. Endorsements can trigger conversion, and leadership can also
        approve it directly.
      */}
      <p class="pk-small pk-muted">
        {tab === "proposals"
          ? "A proposal is a participant's request for a vote. Reaching the required endorsements creates a vote automatically; leadership can also approve it directly."
          : "A vote is a ballot this group runs. Leadership can create one directly, or a participant proposal can become a vote."}
      </p>
      <div id={panelId} class="pk-stack">
        {tab === "proposals" ? (
          <GroupVoteProposals
            groupId={groupId}
            canParticipate={canParticipate}
            onPropose={() => navigate(`${votesPath}/${PROPOSE_GROUP_VOTE_SEGMENT}`)}
            recordPath={(proposalId) => `${proposalsPath}/${encodeURIComponent(proposalId)}`}
          />
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
