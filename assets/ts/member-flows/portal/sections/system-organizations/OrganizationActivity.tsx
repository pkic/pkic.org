/**
 * What an organization has been doing, as an account record reads it.
 *
 * The page above this states who the organization is and who represents it —
 * an account's first questions, which the anatomy keeps on the page itself.
 * This is the second set: what those representatives do elsewhere in the
 * system. Each answer is a large collection of its own, which is exactly the
 * case the anatomy gives tabs to: a tab is the license NOT to fetch
 * everything on first paint, so each panel mounts only while it is selected
 * and issues its own bounded query then.
 *
 * Every tab is the same list panel every other collection uses, narrowed
 * through its columns' menus rather than a row of selects above the table,
 * and every row opens the record it refers to wherever the portal routes one.
 */
import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

import {
  organizationEventsListResponseSchema,
  organizationGroupsListResponseSchema,
  organizationProposalsListResponseSchema,
  ORGANIZATION_EVENT_WHEN_VALUES,
  type OrganizationEventParticipation,
  type OrganizationGroupParticipation,
  type OrganizationProposal,
} from "../../../../../shared/schemas/organization-activity";
import { PROPOSAL_ADMIN_STATUS_FILTERS } from "../../../../../shared/schemas/proposal-status";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge, statusLabel } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import type { Column } from "../../../../components/Table";
import { TabList } from "../../../../ui/TabList";
import { usePortalHashLocation } from "../../hash-location";
import { fmt, fmtDate } from "../../ui";
import { OrganizationSponsorships } from "./OrganizationSponsorships";

type ActivityTab = "groups" | "events" | "proposals" | "sponsorships";

const TAB_LABELS: Record<ActivityTab, string> = {
  groups: "Groups",
  events: "Events",
  proposals: "Proposals",
  sponsorships: "Sponsorships",
};

const TAB_ID_PREFIX = "organization-activity";

function panelIdFor(tab: ActivityTab): string {
  return `${TAB_ID_PREFIX}-${tab}-panel`;
}

/** Names itself and points back at the tab that revealed it — the other half of `role="tab"`'s contract. */
function TabPanel({ tab, children }: { tab: ActivityTab; children: ComponentChildren }) {
  return (
    <div id={panelIdFor(tab)} role="tabpanel" aria-labelledby={`${TAB_ID_PREFIX}-${tab}`}>
      {children}
    </div>
  );
}

function organizationEndpoint(organizationId: string, collection: string): string {
  return `/api/v1/organizations/${encodeURIComponent(organizationId)}/${collection}`;
}

/* ── Groups ────────────────────────────────────────────────────────────── */

const GROUP_COLUMNS: Column<OrganizationGroupParticipation>[] = [
  {
    header: "Group",
    cell: (group) => <strong>{group.groupName}</strong>,
    sort: { asc: "name", desc: "-name", defaultDirection: "asc" },
  },
  {
    // The label comes from the group-types reference table, so the column says
    // "Working Group" rather than the `working_group` key it is stored under.
    header: "Type",
    cell: (group) => group.groupKindLabel,
    width: "fit",
  },
  {
    header: "Representatives",
    cell: (group) => group.representativeCount,
    sort: { asc: "representativeCount", desc: "-representativeCount", defaultDirection: "desc" },
    width: "fit",
  },
  {
    // One date per row: the account's main column is 48rem wide, and the
    // group, its type and a head count already take most of it. The most
    // recent join is the one that says whether the relation is alive.
    header: "Latest joined",
    cell: (group) => fmtDate(group.latestJoinedAt),
    sort: { asc: "latestJoinedAt", desc: "-latestJoinedAt", defaultDirection: "desc" },
    width: "fit",
  },
];

function OrganizationGroupParticipationTable({ organizationId }: { organizationId: string }) {
  return (
    <ApiDataTable
      caption="Group participation"
      endpoint={organizationEndpoint(organizationId, "groups")}
      responseSchema={organizationGroupsListResponseSchema}
      resolve={(data) => data.groups}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="Search groups…"
      columns={GROUP_COLUMNS}
      empty={
        <EmptyState
          title="No group participation"
          body="No group participation yet — representatives join groups from their group pages."
        />
      }
      rowKey={(group) => group.groupId}
      rowAction={(group) => ({
        label: `Open ${group.groupName}`,
        href: usePortalHashLocation.hrefs(`/groups/${encodeURIComponent(group.groupId)}`),
      })}
    />
  );
}

/* ── Events ────────────────────────────────────────────────────────────── */

/**
 * Three states, not two. `upcoming` is a boolean, but an event with no
 * schedule at all is neither upcoming nor past — and the `when` filter leaves
 * it out of both sides — so the cell says so instead of calling it past.
 */
function eventWhenLabel(event: OrganizationEventParticipation): string {
  if (event.startsAt === null && event.endsAt === null) return "Unscheduled";
  return event.upcoming ? "Upcoming" : "Past";
}

const EVENT_COLUMNS: Column<OrganizationEventParticipation>[] = [
  {
    header: "Event",
    cell: (event) => <strong>{event.eventName}</strong>,
    sort: { asc: "eventName", desc: "-eventName", defaultDirection: "asc" },
  },
  {
    header: "When",
    cell: eventWhenLabel,
    // The filter lives in this column's menu, which is where a reader looks
    // for what narrows "When".
    filter: {
      param: "when",
      options: [
        { value: "", label: "Upcoming and past" },
        ...ORGANIZATION_EVENT_WHEN_VALUES.map((value) => ({ value, label: statusLabel(value) })),
      ],
    },
    width: "fit",
  },
  {
    header: "Starts",
    cell: (event) => fmt(event.startsAt),
    sort: { asc: "startsAt", desc: "-startsAt", defaultDirection: "desc" },
    width: "fit",
  },
  {
    header: "Registrations",
    cell: (event) => event.registrationCount,
    sort: { asc: "registrationCount", desc: "-registrationCount", defaultDirection: "desc" },
    width: "fit",
  },
  {
    // Attending is the baseline; a speaking or organizing role is the fact
    // worth a chip, so a row with nothing but registrations stays quiet.
    header: "Roles",
    cell: (event) =>
      event.participantRoles.length > 0 ? (
        <>
          {event.participantRoles.map((role) => (
            <Badge key={role} status={role} />
          ))}
        </>
      ) : (
        <span class="pk-muted">—</span>
      ),
  },
];

function OrganizationEventParticipationTable({ organizationId }: { organizationId: string }) {
  return (
    <ApiDataTable
      caption="Event participation"
      endpoint={organizationEndpoint(organizationId, "events")}
      responseSchema={organizationEventsListResponseSchema}
      resolve={(data) => data.events}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="Search events…"
      initialSort="-startsAt"
      columns={EVENT_COLUMNS}
      empty={
        <EmptyState
          title="No event participation"
          body="No event participation yet — registrations and speaking roles appear here once a representative takes part."
        />
      }
      rowKey={(event) => event.eventId}
      rowAction={(event) => ({
        label: `Open ${event.eventName}`,
        href: usePortalHashLocation.hrefs(`/events/${encodeURIComponent(event.eventSlug)}`),
      })}
    />
  );
}

/* ── Proposals ─────────────────────────────────────────────────────────── */

/** `active` is an aggregate over statuses, so it is the one choice `statusLabel` cannot name. */
function proposalStatusFilterLabel(value: string): string {
  return value === "active" ? "Active (excludes withdrawn/rejected/spam)" : statusLabel(value);
}

const PROPOSAL_COLUMNS: Column<OrganizationProposal>[] = [
  {
    header: "Proposal",
    cell: (proposal) => <strong>{proposal.title}</strong>,
    sort: { asc: "title", desc: "-title", defaultDirection: "asc" },
  },
  {
    header: "Event",
    cell: (proposal) => proposal.eventName,
  },
  {
    header: "Type",
    cell: (proposal) => statusLabel(proposal.proposalType),
    width: "fit",
  },
  {
    header: "Status",
    cell: (proposal) => <Badge status={proposal.status} />,
    sort: { asc: "status", desc: "-status", defaultDirection: "asc" },
    filter: {
      param: "status",
      options: [
        { value: "", label: "All statuses" },
        ...PROPOSAL_ADMIN_STATUS_FILTERS.map((status) => ({
          value: status,
          label: proposalStatusFilterLabel(status),
        })),
      ],
    },
    width: "content",
  },
  {
    header: "Proposer",
    cell: (proposal) => (
      <>
        {proposal.proposerName}
        <br />
        <span class="pk-small pk-muted">{proposal.proposerEmail}</span>
      </>
    ),
  },
  {
    header: "Submitted",
    cell: (proposal) => fmtDate(proposal.submittedAt),
    sort: { asc: "submittedAt", desc: "-submittedAt", defaultDirection: "desc" },
    width: "fit",
  },
];

function OrganizationProposalsTable({ organizationId }: { organizationId: string }) {
  return (
    <ApiDataTable
      caption="Session proposals"
      endpoint={organizationEndpoint(organizationId, "proposals")}
      responseSchema={organizationProposalsListResponseSchema}
      resolve={(data) => data.proposals}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="Search proposals…"
      initialSort="-submittedAt"
      columns={PROPOSAL_COLUMNS}
      empty={
        <EmptyState
          title="No session proposals"
          body="No session proposals yet — representatives submit talks from an event's call for presentations."
        />
      }
      rowKey={(proposal) => proposal.proposalId}
      rowAction={(proposal) => ({
        label: `Open ${proposal.title}`,
        href: usePortalHashLocation.hrefs(
          `/events/${encodeURIComponent(proposal.eventSlug)}/proposals/detail/${encodeURIComponent(proposal.proposalId)}`,
        ),
      })}
    />
  );
}

/* ── The tab set ───────────────────────────────────────────────────────── */

export function OrganizationActivity({
  organizationId,
  canReadSponsorships,
}: {
  organizationId: string;
  canReadSponsorships: boolean;
}) {
  const [tab, setTab] = useState<ActivityTab>("groups");

  const tabs: ActivityTab[] = [
    "groups",
    "events",
    "proposals",
    ...(canReadSponsorships ? (["sponsorships"] as const) : []),
  ];
  // A viewer who loses sponsorship access mid-session must not be left on a
  // tab that is no longer in the set.
  const activeTab = tabs.includes(tab) ? tab : "groups";

  return (
    <section class="pk pk-stack" aria-label="Activity">
      <TabList
        label="Organization activity"
        idPrefix={TAB_ID_PREFIX}
        items={tabs.map((key) => ({ id: key, label: TAB_LABELS[key], panelId: panelIdFor(key) }))}
        activeId={activeTab}
        onSelect={(id) => setTab(id as ActivityTab)}
      />

      {activeTab === "groups" && (
        <TabPanel tab="groups">
          <OrganizationGroupParticipationTable organizationId={organizationId} />
        </TabPanel>
      )}

      {activeTab === "events" && (
        <TabPanel tab="events">
          <OrganizationEventParticipationTable organizationId={organizationId} />
        </TabPanel>
      )}

      {activeTab === "proposals" && (
        <TabPanel tab="proposals">
          <OrganizationProposalsTable organizationId={organizationId} />
        </TabPanel>
      )}

      {activeTab === "sponsorships" && canReadSponsorships && (
        <TabPanel tab="sponsorships">
          <OrganizationSponsorships organizationId={organizationId} />
        </TabPanel>
      )}
    </section>
  );
}
