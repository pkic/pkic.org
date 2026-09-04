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
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";

import {
  userDocumentContributionListResponseSchema,
  userEventParticipationListResponseSchema,
  userMeetingParticipationListResponseSchema,
  userVoteParticipationListResponseSchema,
} from "../../../../../shared/schemas/user-participation-history";
import { getJson } from "../../../../shared/api-client";
// The product adapter, not the design system's Badge: `status` maps this
// product's vocabulary (a participant role, an upload vs a review) onto the
// system's tones, which is exactly the translation that layer exists for.
import { Badge } from "../../../../components/Badge";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
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

  return (
    <div class="pk-table-list">
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

      {tab === "events" && <EventsTab userId={userId} canRead={canRead} />}
      {tab === "meetings" && <MeetingsTab userId={userId} canRead={canRead} />}
      {tab === "documents" && <DocumentsTab userId={userId} canRead={canRead} />}
      {tab === "votes" && <VotesTab userId={userId} canRead={canRead} />}
    </div>
  );
}

/**
 * One tab's page. A tab that cannot load shows the same empty state as a tab
 * with nothing in it: a record still reads without its history.
 */
function useHistoryPage<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  enabled: boolean,
): { data: z.output<Schema> | null; loading: boolean } {
  const [data, setData] = useState<z.output<Schema> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    void getJson(url, schema)
      .then((page) => {
        if (!cancelled) setData(page);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, schema, enabled]);
  return { data, loading };
}

function emptyState(what: string) {
  return (
    <div class="pk-stack pk-stack--tight pk-center">
      <span class="pk-strong">Nothing recorded yet.</span>
      <span class="pk-small pk-muted">{what}</span>
    </div>
  );
}

function EventsTab({ userId, canRead }: { userId: string; canRead: boolean }) {
  const { data, loading } = useHistoryPage(
    `/api/v1/users/${encodeURIComponent(userId)}/participation/events`,
    userEventParticipationListResponseSchema,
    canRead,
  );
  const columns: DataTableColumn<NonNullable<typeof data>["events"][number]>[] = [
    { id: "name", header: "Event", width: "primary", cell: (row) => <span class="pk-strong">{row.eventName}</span> },
    {
      id: "roles",
      header: "Role",
      width: "fit",
      // One row per event carrying every role held there, so somebody who
      // spoke and organized reads as one line with two badges.
      cell: (row) => (
        <span class="pk-cluster">
          {row.roles.map((role) => (
            <Badge key={role} status={role} />
          ))}
        </span>
      ),
    },
    { id: "date", header: "Date", width: "fit", cell: (row) => occurred(row.occurredAt) },
  ];
  return (
    <DataTable
      caption="Events attended"
      columns={columns}
      rows={data?.events ?? []}
      rowKey={(row) => row.eventId}
      loading={loading}
      empty={emptyState("Events appear here as they are attended.")}
    />
  );
}

function MeetingsTab({ userId, canRead }: { userId: string; canRead: boolean }) {
  const { data, loading } = useHistoryPage(
    `/api/v1/users/${encodeURIComponent(userId)}/participation/meetings`,
    userMeetingParticipationListResponseSchema,
    canRead,
  );
  const columns: DataTableColumn<NonNullable<typeof data>["meetings"][number]>[] = [
    { id: "name", header: "Meeting", width: "primary", cell: (row) => <span class="pk-strong">{row.eventName}</span> },
    { id: "group", header: "Group", width: "fit", cell: (row) => row.group?.name ?? "—" },
    { id: "date", header: "Date", width: "fit", cell: (row) => occurred(row.occurredAt) },
  ];
  return (
    <DataTable
      caption="Meetings attended"
      columns={columns}
      rows={data?.meetings ?? []}
      rowKey={(row) => row.occurrenceId}
      loading={loading}
      empty={emptyState("Meetings appear here as they are joined.")}
    />
  );
}

function DocumentsTab({ userId, canRead }: { userId: string; canRead: boolean }) {
  const { data, loading } = useHistoryPage(
    `/api/v1/users/${encodeURIComponent(userId)}/participation/documents`,
    userDocumentContributionListResponseSchema,
    canRead,
  );
  const columns: DataTableColumn<NonNullable<typeof data>["documents"][number]>[] = [
    {
      id: "title",
      header: "Document",
      width: "primary",
      cell: (row) => <span class="pk-strong">{row.proposalTitle}</span>,
    },
    {
      id: "contribution",
      header: "Contribution",
      width: "fit",
      cell: (row) => <Badge status={row.contribution} />,
    },
    { id: "date", header: "Updated", width: "fit", cell: (row) => occurred(row.occurredAt) },
  ];
  return (
    <DataTable
      caption="Documents contributed to"
      columns={columns}
      rows={data?.documents ?? []}
      rowKey={(row) => row.contributionId}
      loading={loading}
      empty={emptyState("Uploads and reviews appear here.")}
    />
  );
}

function VotesTab({ userId, canRead }: { userId: string; canRead: boolean }) {
  const { data, loading } = useHistoryPage(
    `/api/v1/users/${encodeURIComponent(userId)}/participation/votes`,
    userVoteParticipationListResponseSchema,
    canRead,
  );
  const columns: DataTableColumn<NonNullable<typeof data>["votes"][number]>[] = [
    { id: "title", header: "Ballot", width: "primary", cell: (row) => <span class="pk-strong">{row.voteTitle}</span> },
    { id: "group", header: "Group", width: "fit", cell: (row) => row.group.name },
    {
      id: "choice",
      header: "Vote",
      width: "fit",
      // Present only for a vote its own group chose to publish in full. Every
      // other ballot reads as participation alone.
      cell: (row) => (row.choice ? <Badge status={row.choice} /> : <span class="pk-muted">Not published</span>),
    },
    { id: "date", header: "Closed", width: "fit", cell: (row) => occurred(row.occurredAt) },
  ];
  return (
    <>
      <DataTable
        caption="Votes participated in"
        columns={columns}
        rows={data?.votes ?? []}
        rowKey={(row) => `${row.voteId}-${String(row.round)}`}
        loading={loading}
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
