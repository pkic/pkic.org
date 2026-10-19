import { useState } from "preact/hooks";
import {
  AFFILIATION_REVIEW_STATUSES,
  affiliationReviewGroupDecisionResponseSchema,
  affiliationReviewGroupResponseSchema,
  affiliationReviewGroupsListResponseSchema,
  affiliationReviewsListResponseSchema,
  type AffiliationReview,
  type AffiliationReviewGroup,
  type AffiliationReviewStatus,
} from "../../../../shared/schemas/affiliation-reviews";
import { formatNumber } from "../../../../shared/format-number";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { Badge } from "../../../components/Badge";
import { confirmAction } from "../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { useData } from "../../../hooks/useData";
import { getJson, postJson } from "../../../shared/api-client";
import { Button } from "../../../ui/Button";
import { DescriptionList } from "../../../ui/DescriptionList";
import { PageHeader } from "../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { fmt, toast } from "../ui";

const API_BASE = "/api/v1/identities/reviews";
const GROUPS_API = `${API_BASE}/groups`;
const PAGE_HREF = "#/settings/affiliation-reviews";
const DEFAULT_STATUS: AffiliationReviewStatus = "open";

const SOURCE_LABELS: Record<AffiliationReview["sourceType"], string> = {
  user_profile: "Account profile",
  proposal_speaker: "Speaker details on a proposal",
  registration: "Organization named when confirming an event registration",
};

function statusLabel(value: AffiliationReviewStatus): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function peopleLabel(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? "person" : "people"}`;
}

/** What the group's people wrote: the organization name, or the title for a group that names none. */
function groupTitle(group: AffiliationReviewGroup): string {
  return group.organizationName ?? (group.jobTitle ? `Job title: ${group.jobTitle}` : "No organization named");
}

function domainsLabel(domains: readonly string[]): string | null {
  return domains.length > 0 ? domains.map((domain) => `@${domain}`).join(", ") : null;
}

/**
 * One decision for everyone in the group: dismiss. Nobody is linked to an
 * organization by what they wrote; each person joins through their verified
 * work address, or staff invite them from their record.
 */
function GroupDecision({ group, canWrite }: { group: AffiliationReviewGroup; canWrite: boolean }) {
  const [busy, setBusy] = useState(false);

  async function dismiss(): Promise<void> {
    const confirmed = await confirmAction({
      title: `Dismiss the reviews of ${peopleLabel(group.people)}?`,
      body: "The text stays on record, but no identity is created from it.",
      confirmLabel: "Dismiss all",
      cancelLabel: "Keep open",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await postJson(
        `${GROUPS_API}/${encodeURIComponent(group.groupKey)}/dismiss`,
        {},
        affiliationReviewGroupDecisionResponseSchema,
      );
      toast(`${formatNumber(result.decided)} ${result.decided === 1 ? "review" : "reviews"} dismissed`, "success");
      window.location.hash = PAGE_HREF;
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (group.openReviews === 0 || !canWrite) return null;
  return (
    <PanelBody>
      <p class="pk-small pk-muted">
        People join their organization through their verified work email address, and their review closes when they do.
        Open a person to invite them to an organization.
      </p>
      <div class="pk-cluster">
        <Button variant="danger-quiet" loading={busy} onClick={() => void dismiss()}>
          Dismiss all
        </Button>
      </div>
    </PanelBody>
  );
}

function GroupDetail({ groupKey, canWrite }: { groupKey: string; canWrite: boolean }) {
  const loaded = useData(
    () => getJson(`${GROUPS_API}/${encodeURIComponent(groupKey)}`, affiliationReviewGroupResponseSchema),
    [groupKey],
  );
  const group = loaded.data?.group;
  const title = group ? groupTitle(group) : "Affiliation review";
  return (
    <div class="pk pk-stack">
      <PageHeader
        title="Affiliation review"
        trail={[
          { label: "Settings", href: "#/settings" },
          { label: "Affiliation reviews", href: PAGE_HREF },
          { label: title },
        ]}
      />
      <ErrorAlert error={loaded.error} />
      {!group ? (
        !loaded.error && <Spinner label="Loading this review…" />
      ) : (
        <>
          <Panel aria-label={title}>
            <PanelHeader title={title} />
            <PanelBody>
              <DescriptionList
                items={[
                  { term: "Written by", value: peopleLabel(group.people) },
                  { term: "Work email domains", value: domainsLabel(group.emailDomains) },
                  { term: "Open reviews", value: formatNumber(group.openReviews) },
                  { term: "Status", value: <Badge status={group.status} /> },
                  { term: "First recorded", value: fmt(group.firstRecordedAt) },
                ]}
              />
            </PanelBody>
            <GroupDecision group={group} canWrite={canWrite} />
          </Panel>
          <ApiDataTable
            urlState={`affiliation-review-people.${group.groupKey}`}
            caption={`People who wrote ${title}`}
            endpoint={API_BASE}
            responseSchema={affiliationReviewsListResponseSchema}
            resolve={(data) => data.reviews}
            resolvePage={(data) => data.page}
            params={{ groupKey: group.groupKey }}
            paginate
            initialSort="personName"
            initialFilters={{ status: group.status }}
            columns={[
              {
                header: "Person",
                cell: (review) => (
                  <>
                    <div>
                      <a href={`#/users/${encodeURIComponent(review.userId)}`}>{review.personName}</a>
                    </div>
                    <div class="pk-small pk-muted">{review.personEmail}</div>
                  </>
                ),
                sort: { asc: "personName", desc: "-personName" },
              },
              { header: "Organization as written", cell: (review) => review.organizationName ?? "—" },
              { header: "Job title as written", cell: (review) => review.jobTitle ?? "—" },
              { header: "Found in", cell: (review) => SOURCE_LABELS[review.sourceType] },
              {
                header: "Status",
                cell: (review) => <Badge status={review.status} />,
                width: "fit",
                filter: {
                  param: "status",
                  options: AFFILIATION_REVIEW_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
                },
              },
            ]}
            empty="No reviews in this group match the current filters."
            rowKey={(review) => review.id}
          />
        </>
      )}
    </div>
  );
}

/**
 * Organization names and titles that no identity represented when identities
 * became their only home, one row per name as written. A review closes when
 * its person joins an organization; staff may dismiss a group at once.
 */
export function AffiliationReviews({ groupKey, canWrite }: { groupKey?: string; canWrite: boolean }) {
  if (groupKey) return <GroupDetail groupKey={groupKey} canWrite={canWrite} />;
  return (
    <div class="pk pk-stack">
      <PageHeader title="Affiliation reviews" />
      <ApiDataTable
        urlState="affiliation-reviews"
        caption="Affiliation reviews"
        endpoint={GROUPS_API}
        responseSchema={affiliationReviewGroupsListResponseSchema}
        resolve={(data) => data.groups}
        resolvePage={(data) => data.page}
        paginate
        searchPlaceholder="person, organization, domain, or title…"
        initialSort="-people"
        initialFilters={{ status: DEFAULT_STATUS }}
        columns={[
          {
            header: "Organization as written",
            cell: (group) => groupTitle(group),
            sort: { asc: "organizationName", desc: "-organizationName" },
          },
          { header: "Work email domains", cell: (group) => domainsLabel(group.emailDomains) ?? "—" },
          {
            header: "People",
            cell: (group) => formatNumber(group.people),
            align: "end",
            width: "fit",
            sort: { asc: "people", desc: "-people" },
          },
          {
            header: "Status",
            cell: (group) => <Badge status={group.status} />,
            width: "fit",
            filter: {
              param: "status",
              options: AFFILIATION_REVIEW_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
            },
          },
          {
            header: "First recorded",
            cell: (group) => fmt(group.firstRecordedAt),
            width: "fit",
            sort: { asc: "firstRecordedAt", desc: "-firstRecordedAt" },
          },
        ]}
        rowAction={(group) => ({
          label: `Open the affiliation review for ${groupTitle(group)}`,
          href: `${PAGE_HREF}/${encodeURIComponent(group.groupKey)}`,
        })}
        empty="No affiliation reviews match the current filters."
        rowKey={(group) => group.groupKey}
      />
    </div>
  );
}
