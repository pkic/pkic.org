import { useRef, useState } from "preact/hooks";
import {
  AFFILIATION_REVIEW_STATUSES,
  affiliationReviewApproveSchema,
  affiliationReviewApproveResponseSchema,
  affiliationReviewGroupDecisionResponseSchema,
  affiliationReviewGroupResponseSchema,
  affiliationReviewGroupsListResponseSchema,
  affiliationReviewsListResponseSchema,
  type AffiliationReview,
  type AffiliationReviewGroup,
  type AffiliationReviewStatus,
} from "../../../../shared/schemas/affiliation-reviews";
import { formatNumber } from "../../../../shared/format-number";
import { Menu } from "../../../ui/Menu";
import { RowActions } from "../../../ui/RowActions";
import { ApiDataTable, type ApiTableActions } from "../../../components/ApiDataTable";
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

function GroupDetail({ groupKey, canWrite, canApprove }: { groupKey: string; canWrite: boolean; canApprove: boolean }) {
  const actions = useRef<ApiTableActions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loaded = useData(
    () => getJson(`${GROUPS_API}/${encodeURIComponent(groupKey)}`, affiliationReviewGroupResponseSchema),
    [groupKey],
  );
  async function changed(): Promise<void> {
    await Promise.all([loaded.reload(), actions.current?.reload()]);
  }
  async function approve(review?: AffiliationReview): Promise<void> {
    if (
      !(await confirmAction({
        title: review ? `Approve ${review.personName}'s affiliation?` : "Approve all eligible affiliations?",
        tone: "primary",
        body: "Only verified email addresses on approved organization domains qualify. Ambiguous or blocked affiliations stay open for review.",
        confirmLabel: review ? "Approve affiliation" : "Approve all eligible",
        cancelLabel: "Keep open",
      }))
    )
      return;
    setBusy(true);
    setError("");
    let decided = 0;
    try {
      let nextUserId: string | null = null;
      do {
        const body = affiliationReviewApproveSchema.parse(
          review ? { userId: review.userId } : nextUserId ? { afterUserId: nextUserId } : {},
        );
        const result = await postJson(
          `${GROUPS_API}/${encodeURIComponent(groupKey)}/approve`,
          body,
          affiliationReviewApproveResponseSchema,
        );
        decided += result.decided;
        nextUserId = result.nextUserId;
      } while (nextUserId);
      toast(`${formatNumber(decided)} ${decided === 1 ? "review" : "reviews"} approved`, "success");
      if (decided === 0)
        setError(
          "No eligible affiliation found. Check the person's verified work address and the organization's approved domains, or open the person to send an identity invitation.",
        );
    } catch (caught) {
      setError(
        `${(caught as Error).message} ${formatNumber(decided)} ${decided === 1 ? "review" : "reviews"} approved before this stopped. You can retry safely.`,
      );
    } finally {
      setBusy(false);
      await changed();
    }
  }
  async function dismiss(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Dismiss all open reviews in this group?",
      body: "The text stays on record, but no identity is created from it.",
      confirmLabel: "Dismiss all",
      cancelLabel: "Keep open",
    });
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      const result = await postJson(
        `${GROUPS_API}/${encodeURIComponent(groupKey)}/dismiss`,
        {},
        affiliationReviewGroupDecisionResponseSchema,
      );
      toast(`${formatNumber(result.decided)} ${result.decided === 1 ? "review" : "reviews"} dismissed`, "success");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      await changed();
    }
  }
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
            <PanelHeader
              title={title}
              menu={
                canWrite && group.openReviews > 0 ? (
                  <Menu
                    label={`Actions for ${title}`}
                    align="end"
                    items={[
                      {
                        id: "dismiss",
                        label: "Dismiss all",
                        danger: true,
                        disabled: busy,
                        onSelect: () => void dismiss(),
                      },
                    ]}
                  />
                ) : undefined
              }
            />
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
          </Panel>
          <ErrorAlert error={error} />
          <ApiDataTable
            actionsRef={actions}
            toolbarClass="pk-toolbar-row"
            compactToolbarActions={[]}
            toolbar={() =>
              group.openReviews > 0 && (
                <>
                  {canApprove && (
                    <Button variant="primary" loading={busy} onClick={() => void approve()}>
                      Approve all eligible
                    </Button>
                  )}
                </>
              )
            }
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
              ...(canApprove
                ? [
                    {
                      header: "Actions",
                      width: "fit" as const,
                      cell: (review: AffiliationReview) => (
                        <RowActions
                          subject={review.personName}
                          actions={
                            review.status === "open"
                              ? [
                                  {
                                    id: "approve",
                                    label: "Approve affiliation",
                                    disabled: busy,
                                    onSelect: () => void approve(review),
                                  },
                                ]
                              : []
                          }
                        />
                      ),
                    },
                  ]
                : []),
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
export function AffiliationReviews({
  groupKey,
  canWrite,
  canApprove,
}: {
  groupKey?: string;
  canWrite: boolean;
  canApprove: boolean;
}) {
  if (groupKey) return <GroupDetail groupKey={groupKey} canWrite={canWrite} canApprove={canApprove} />;
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
