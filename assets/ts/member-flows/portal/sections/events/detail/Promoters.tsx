/**
 * Who is bringing people to the event, and through which links.
 *
 * Two server collections — the ranked promoters and the referral codes —
 * each drawn as the one list panel every collection in the portal uses,
 * with the summary figures in a panel of their own above them. The version
 * this replaces laid the stat cards and two bare tables straight onto the
 * page with a hand-rolled pager under them.
 */
import { useState } from "preact/hooks";
import { ApiDataTable } from "../../../../../components/ApiDataTable";
import { Tabs } from "../../../../../components/Tabs";
import type { Column } from "../../../../../components/Table";
import { EmptyState } from "../../../../../ui/EmptyState";
import { svgSegmentBar } from "../../../../../ui/chart";
import { usePortalHashLocation } from "../../../hash-location";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { PersonCell } from "../../../../../ui/PersonCell";
import { StatCard } from "../../../../../ui/StatCard";
// `pk-mono` and `pk-strong` are written here as class names rather than
// reached through a component, so this module pulls the sheet that defines
// `pk-mono` into its own chunk.
import "../../../../../ui/Content.css";
import {
  eventPromotersListResponseSchema,
  type EventPromoter,
  type EventPromotersListResponse,
  type EventReferralCode,
} from "../../../../../../shared/schemas/event-promoters";

type PromotionView = "promoters" | "codes";

const VIEWS: ReadonlyArray<{ key: PromotionView; label: string }> = [
  { key: "promoters", label: "Active promoters" },
  { key: "codes", label: "Referral codes" },
];

function promoterName(promoter: EventPromoter): string {
  return [promoter.firstName, promoter.lastName].filter(Boolean).join(" ") || "Unnamed promoter";
}

function promoterColumns(pageOffset: number): Array<Column<EventPromoter>> {
  return [
    {
      header: "Promoter",
      cell: (row, index) => (
        <PersonCell
          name={promoterName(row)}
          avatarSrc={row.headshotUrl ?? undefined}
          avatarStatus={{ label: `#${pageOffset + index + 1}` }}
          detail={[row.jobTitle, row.organization].filter(Boolean).join(" · ")}
        />
      ),
      width: "primary",
    },
    {
      header: "Invitations",
      cell: (row) => (
        <div class="pk-stack pk-stack--tight">
          <span>{row.invitesSent} sent</span>
          <div
            dangerouslySetInnerHTML={{
              __html: svgSegmentBar(
                [
                  { label: "Accepted", value: row.invitesAccepted, color: "var(--pk-ok)" },
                  {
                    label: "Pending",
                    value: Math.max(
                      0,
                      row.invitesSent - row.invitesAccepted - row.invitesDeclined - row.invitesExpired,
                    ),
                    color: "var(--pk-info)",
                  },
                  { label: "Declined", value: row.invitesDeclined, color: "var(--pk-ink-muted)" },
                  { label: "Expired", value: row.invitesExpired, color: "var(--pk-line)" },
                ],
                row.invitesSent,
                { caption: `Invitations from ${promoterName(row)}` },
              ),
            }}
          />
        </div>
      ),
    },
    {
      header: "Referral links",
      cell: (row) => (
        <div class="pk-stack pk-stack--tight">
          <span>
            {row.referralClicks} clicks · {row.referralConversions} registrations
          </span>
          <div
            dangerouslySetInnerHTML={{
              __html: svgSegmentBar(
                [
                  { label: "Registrations", value: row.referralConversions, color: "var(--pk-ok)" },
                  {
                    label: "Other clicks",
                    value: Math.max(0, row.referralClicks - row.referralConversions),
                    color: "var(--pk-info)",
                  },
                ],
                Math.max(row.referralClicks, row.referralConversions),
                { caption: `Referral activity for ${promoterName(row)}` },
              ),
            }}
          />
        </div>
      ),
    },
    {
      header: "Impact",
      cell: (row) => <span class="pk-record-title">{row.impactScore.toFixed(0)}</span>,
      className: "pk-end",
      width: "fit",
      sort: { asc: "impact", desc: "-impact", defaultDirection: "desc" },
    },
  ];
}

const REFERRAL_CODE_COLUMNS: Array<Column<EventReferralCode>> = [
  { header: "Code", cell: (row) => row.code, className: "pk-mono", width: "primary" },
  {
    header: "Owner",
    cell: (row) => [row.ownerFirstName, row.ownerLastName].filter(Boolean).join(" ") || "Unnamed user",
  },
  { header: "Clicks", cell: (row) => row.clicks, className: "pk-end", width: "fit" },
  {
    header: "Conversions",
    cell: (row) => row.conversions,
    className: "pk-end",
    width: "fit",
    sort: { asc: "conversions", desc: "-conversions", defaultDirection: "desc" },
  },
  { header: "Created", cell: (row) => row.createdAt.substring(0, 10), className: "pk-mono pk-small", width: "fit" },
];

export function Promoters({
  slug,
  subTab,
  basePath = `/events/${encodeURIComponent(slug)}/promoters`,
}: {
  slug: string;
  subTab?: string;
  /** Where the views live, so the tabs stay inside the workspace that rendered them. */
  basePath?: string;
}) {
  const view: PromotionView = subTab === "codes" ? "codes" : "promoters";
  const [summary, setSummary] = useState<EventPromotersListResponse["summary"] | null>(null);
  const [pageOffset, setPageOffset] = useState(0);
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/promoters`;
  const viewPath = (key: string) => (key === "promoters" ? basePath : `${basePath}/${key}`);
  const inviteConversion =
    summary && summary.totalInvitesSent > 0
      ? `${((summary.totalInvitesAccepted / summary.totalInvitesSent) * 100).toFixed(0)}% conversion`
      : undefined;

  return (
    <div class="pk pk-stack">
      {/* Nothing to summarize is nothing to draw: a row of zeroes says less
          than the empty list below it. */}
      {summary && summary.activePromoters > 0 && (
        <Panel aria-label="Promotion summary">
          <PanelHeader title="Promotion" />
          <PanelBody>
            <div class="pk-stat-row">
              <StatCard
                label="Active promoters"
                value={String(summary.activePromoters)}
                note={`${String(summary.promotersWithRegistrations)} with registrations`}
              />
              <StatCard label="Invites sent" value={String(summary.totalInvitesSent)} />
              <StatCard
                label="Invites accepted"
                value={String(summary.totalInvitesAccepted)}
                note={inviteConversion}
                tone="ok"
              />
              <StatCard label="Link clicks" value={String(summary.totalReferralClicks)} />
              <StatCard label="Link registrations" value={String(summary.totalReferralConversions)} />
            </div>
          </PanelBody>
        </Panel>
      )}

      <Tabs
        label="Promotion views"
        items={VIEWS.map(({ key, label }) => ({
          key,
          label: summary
            ? `${label} (${String(key === "promoters" ? summary.activePromoters : summary.referralCodeCount)})`
            : label,
        }))}
        active={view}
        hrefFor={viewPath}
      />

      {view === "promoters" ? (
        <ApiDataTable
          key="promoters"
          caption="Promoters, ranked by impact"
          endpoint={endpoint}
          params={{ view: "promoters" }}
          responseSchema={eventPromotersListResponseSchema}
          resolve={(response) => response.promoters}
          resolvePage={(response) => response.page}
          onData={(response) => {
            setSummary(response.summary);
            setPageOffset(response.page.offset);
          }}
          paginate
          initialSort="-impact"
          columns={promoterColumns(pageOffset)}
          rowKey={(row) => row.userId}
          rowAction={(row) => ({
            label: `Open ${promoterName(row)}`,
            href: usePortalHashLocation.hrefs(`/users/${encodeURIComponent(row.userId)}`),
          })}
          empty={
            <EmptyState
              title="No promoter activity yet"
              body="Promoters appear here once someone sends an invitation or shares a referral link."
            />
          }
        />
      ) : (
        <ApiDataTable
          key="codes"
          caption="Referral codes"
          endpoint={endpoint}
          params={{ view: "codes" }}
          responseSchema={eventPromotersListResponseSchema}
          resolve={(response) => response.referralCodes}
          resolvePage={(response) => response.page}
          onData={(response) => setSummary(response.summary)}
          paginate
          initialSort="-conversions"
          columns={REFERRAL_CODE_COLUMNS}
          rowKey={(row) => row.code}
          empty={
            <EmptyState
              title="No referral codes issued"
              body="A referral code is created when a promoter shares this event."
            />
          }
        />
      )}
    </div>
  );
}
