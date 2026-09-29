/**
 * What a person has taken part in, as four views of one history: the events
 * they attended, the meetings they joined, the documents they contributed to,
 * and the ballots they cast.
 *
 * One panel with tabs rather than four stacked panels, because these are the
 * same question asked four ways and a record page that stacked them would bury
 * everything below the first. Each tab is its own bounded page from its own
 * endpoint — the server orders, filters and pages; nothing here slices a set.
 *
 * On ballots, whether the choice appears is the vote's own decision: a vote
 * published in full by its group shows it, and every other ballot shows that
 * the person took part and nothing more. The reader's permissions do not
 * enter into it.
 */
import { useState } from "preact/hooks";
import type { z } from "zod";

import {
  userDocumentContributionListResponseSchema,
  userEventParticipationListResponseSchema,
  userMeetingParticipationListResponseSchema,
  userVoteParticipationListResponseSchema,
} from "../../../../../shared/schemas/user-participation-history";
import { ApiDataTable } from "../../../../components/ApiDataTable";
// The product adapter, not the design system's Badge: `status` maps this
// product's vocabulary (a participant role, an upload vs a review) onto the
// system's tones, which is exactly the translation that layer exists for.
import { Badge } from "../../../../components/Badge";
import { type Column } from "../../../../components/Table";
import { usePortalHashLocation } from "../../hash-location";
import { TabList } from "../../../../ui/TabList";
import { fmt } from "../../ui";

type TabId = "events" | "meetings" | "documents" | "votes";

const TABS: { id: TabId; label: string }[] = [
  { id: "events", label: "Events" },
  { id: "meetings", label: "Meetings" },
  { id: "documents", label: "Documents" },
  { id: "votes", label: "Votes" },
];

/** The date every history is read by, formatted once. */
function occurred(value: string) {
  return <span class="pk-nowrap">{fmt(value)}</span>;
}

export function UserParticipationHistory({ userId, canRead }: { userId: string; canRead: boolean }) {
  const [tab, setTab] = useState<TabId>("events");
  if (!canRead) return emptyState("Participation history is not available for this account.");

  return (
    <div class="pk-stack">
      <div class="pk-table-list__inset">
        <TabList
          label="Participation"
          idPrefix="participation"
          items={TABS.map((entry) => ({ id: entry.id, label: entry.label, panelId: "participation-panel" }))}
          activeId={tab}
          onSelect={(id) => {
            setTab(id as TabId);
          }}
        />
      </div>

      <div id="participation-panel" role="tabpanel" aria-labelledby={`participation-${tab}`}>
        {tab === "events" && <EventsTab userId={userId} />}
        {tab === "meetings" && <MeetingsTab userId={userId} />}
        {tab === "documents" && <DocumentsTab userId={userId} />}
        {tab === "votes" && <VotesTab userId={userId} />}
      </div>
    </div>
  );
}

function emptyState(what: string) {
  return (
    <div class="pk-stack pk-stack--tight pk-center">
      <span class="pk-strong">Nothing recorded yet.</span>
      <span class="pk-small pk-muted">{what}</span>
    </div>
  );
}

function EventsTab({ userId }: { userId: string }) {
  const columns: Column<z.infer<typeof userEventParticipationListResponseSchema>["events"][number]>[] = [
    { header: "Event", cell: (row) => <span class="pk-strong">{row.eventName}</span> },
    {
      header: "Roles",
      width: "fit",
      // One row per event carrying every role held there, so somebody who
      // spoke and organized reads as one line with two badges.
      cell: (row) => (
        <span class="pk-cluster pk-cluster--nowrap">
          {row.roles.map((role) => (
            <Badge key={role} status={role} />
          ))}
        </span>
      ),
    },
    { header: "Location", cell: (row) => row.location ?? "—" },
    { header: "Date", width: "fit", cell: (row) => occurred(row.occurredAt) },
  ];
  return (
    <ApiDataTable
      caption="Events attended"
      columns={columns}
      endpoint={`/api/v1/users/${encodeURIComponent(userId)}/participation/events`}
      responseSchema={userEventParticipationListResponseSchema}
      resolve={(data) => data.events}
      resolvePage={(data) => data.page}
      paginate
      initialSort="-occurredAt"
      rowKey={(row) => row.eventId}
      // The row names an event, so it opens that event (#45).
      rowAction={(row) => ({
        label: `Open ${row.eventName}`,
        href: usePortalHashLocation.hrefs(`/events/${encodeURIComponent(row.eventSlug)}`),
      })}
      empty={emptyState("Events appear here as they are attended.")}
    />
  );
}

function MeetingsTab({ userId }: { userId: string }) {
  const columns: Column<z.infer<typeof userMeetingParticipationListResponseSchema>["meetings"][number]>[] = [
    { header: "Meeting", width: "primary", cell: (row) => <span class="pk-strong">{row.eventName}</span> },
    { header: "Group", width: "fit", cell: (row) => row.group?.name ?? "—" },
    { header: "Date", width: "fit", cell: (row) => occurred(row.occurredAt) },
  ];
  return (
    <ApiDataTable
      caption="Meetings attended"
      columns={columns}
      endpoint={`/api/v1/users/${encodeURIComponent(userId)}/participation/meetings`}
      responseSchema={userMeetingParticipationListResponseSchema}
      resolve={(data) => data.meetings}
      resolvePage={(data) => data.page}
      paginate
      initialSort="-occurredAt"
      rowKey={(row) => row.occurrenceId}
      empty={emptyState("Meetings appear here as they are joined.")}
    />
  );
}

function DocumentsTab({ userId }: { userId: string }) {
  const columns: Column<z.infer<typeof userDocumentContributionListResponseSchema>["documents"][number]>[] = [
    {
      header: "Document",
      width: "primary",
      cell: (row) => <span class="pk-strong">{row.proposalTitle}</span>,
    },
    {
      header: "Contribution",
      width: "fit",
      cell: (row) => <Badge status={row.contribution} />,
    },
    { header: "Updated", width: "fit", cell: (row) => occurred(row.occurredAt) },
  ];
  return (
    <ApiDataTable
      caption="Documents contributed to"
      columns={columns}
      endpoint={`/api/v1/users/${encodeURIComponent(userId)}/participation/documents`}
      responseSchema={userDocumentContributionListResponseSchema}
      resolve={(data) => data.documents}
      resolvePage={(data) => data.page}
      paginate
      initialSort="-occurredAt"
      rowKey={(row) => row.contributionId}
      empty={emptyState("Uploads and reviews appear here.")}
    />
  );
}

function VotesTab({ userId }: { userId: string }) {
  const columns: Column<z.infer<typeof userVoteParticipationListResponseSchema>["votes"][number]>[] = [
    { header: "Ballot", width: "primary", cell: (row) => <span class="pk-strong">{row.voteTitle}</span> },
    { header: "Group", width: "fit", cell: (row) => row.group.name },
    {
      header: "Vote",
      width: "fit",
      // Present only for a vote its own group chose to publish in full. Every
      // other ballot reads as participation alone.
      cell: (row) => (row.choice ? <Badge status={row.choice} /> : <span class="pk-muted">Not published</span>),
    },
    { header: "Closed", width: "fit", cell: (row) => occurred(row.occurredAt) },
  ];
  return (
    <>
      <ApiDataTable
        caption="Votes participated in"
        columns={columns}
        endpoint={`/api/v1/users/${encodeURIComponent(userId)}/participation/votes`}
        responseSchema={userVoteParticipationListResponseSchema}
        resolve={(data) => data.votes}
        resolvePage={(data) => data.page}
        paginate
        initialSort="-occurredAt"
        rowKey={(row) => `${row.voteId}-${String(row.round)}`}
        empty={emptyState("Ballots appear here as they are cast.")}
      />
      <div class="pk-table-list__inset">
        <p class="pk-small pk-muted">
          A ballot shows how someone voted only when the vote itself was published in full by the group that held it.
          Every other ballot shows participation alone.
        </p>
      </div>
    </>
  );
}
