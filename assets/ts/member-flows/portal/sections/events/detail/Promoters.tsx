import { usePortalHashLocation } from "../../../hash-location";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Tabs } from "../../../../../components/Tabs";
import { DataTable, type DataTableColumn } from "../../../../../ui/DataTable";
import { EmptyState } from "../../../../../ui/EmptyState";
import { Meter } from "../../../../../ui/Meter";
import { PersonCell } from "../../../../../ui/PersonCell";
import { StatCard } from "../../../../../ui/StatCard";
// `pk-mono` and `pk-strong` are written here as class names rather than
// reached through a component, so this module pulls the sheet that defines
// `pk-mono` into its own chunk.
import "../../../../../ui/Content.css";
import {
  buildCollectionResetKey,
  useCollectionOffset,
  useServerCollection,
  type CollectionLoader,
} from "../../../../../hooks/useServerCollection";
import { Pager } from "../../../../../components/Pager";
import {
  eventPromotersListResponseSchema,
  type EventPromoter,
  type EventReferralCode,
} from "../../../../../../shared/schemas/event-promoters";
import { useOffsetPager } from "../../../../../hooks/useOffsetPager";
import { getJson } from "../../../../../shared/api-client";

const loadEventPromoters: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

/** One promoter, with the rank the server's ordering gives them on this page. */
interface RankedPromoter extends EventPromoter {
  rank: number;
}

function promoterName(promoter: EventPromoter): string {
  return [promoter.firstName, promoter.lastName].filter(Boolean).join(" ") || promoter.email || "Unknown promoter";
}

/**
 * The leaderboard as a table rather than a column of cards.
 *
 * Every figure on the card carried a two- or three-letter label — "Sent",
 * "Rate", "lbl" — that only made sense beside its neighbours, and the top
 * three places were signalled by a gold/silver/bronze tint that nobody who
 * cannot separate those hues could read. A captioned table gives each number
 * a real column header, and the rank is a number in its own column instead of
 * a colour.
 */
const PROMOTER_COLUMNS: ReadonlyArray<DataTableColumn<RankedPromoter>> = [
  { id: "rank", header: "Rank", align: "end", cell: (row) => row.rank, cellClass: "pk-nowrap" },
  {
    id: "promoter",
    header: "Promoter",
    cell: (row) => (
      <div class="pk-stack pk-stack--tight">
        <PersonCell name={promoterName(row)} avatarSrc={row.headshotUrl ?? undefined} size="sm" />
        {row.email && <a href={`mailto:${row.email}`}>{row.email}</a>}
        {[row.jobTitle, row.organization].filter(Boolean).length > 0 && (
          <span class="pk-small">{[row.jobTitle, row.organization].filter(Boolean).join(" · ")}</span>
        )}
      </div>
    ),
  },
  { id: "invitesSent", header: "Invites sent", align: "end", cell: (row) => row.invitesSent },
  { id: "invitesAccepted", header: "Invites accepted", align: "end", cell: (row) => row.invitesAccepted },
  {
    id: "conversion",
    header: "Invite conversion",
    cell: (row) => {
      const conversion = row.inviteConversionRate ?? 0;
      return (
        // The bar repeats what the figure beside it says; a reader who cannot
        // judge the fill still gets the number.
        <Meter
          value={Math.min(conversion, 100)}
          label={`${String(conversion)}% invite conversion for ${promoterName(row)}`}
          showValue
        />
      );
    },
  },
  { id: "invitesDeclined", header: "Declined", align: "end", cell: (row) => row.invitesDeclined },
  { id: "invitesExpired", header: "Expired", align: "end", cell: (row) => row.invitesExpired },
  { id: "referralClicks", header: "Link clicks", align: "end", cell: (row) => row.referralClicks },
  { id: "referralConversions", header: "Link registrations", align: "end", cell: (row) => row.referralConversions },
  {
    id: "impactScore",
    header: "Impact",
    align: "end",
    cell: (row) => <span class="pk-strong">{row.impactScore.toFixed(0)}</span>,
  },
];

const REFERRAL_CODE_COLUMNS: ReadonlyArray<DataTableColumn<EventReferralCode>> = [
  { id: "code", header: "Code", cell: (row) => row.code, cellClass: "pk-mono pk-nowrap" },
  {
    id: "owner",
    header: "Owner",
    cell: (row) => [row.ownerFirstName, row.ownerLastName].filter(Boolean).join(" ") || row.ownerEmail || "—",
  },
  { id: "clicks", header: "Clicks", align: "end", cell: (row) => row.clicks },
  { id: "conversions", header: "Conversions", align: "end", cell: (row) => row.conversions },
  {
    id: "createdAt",
    header: "Created",
    cell: (row) => row.createdAt.substring(0, 10),
    cellClass: "pk-mono pk-small pk-nowrap",
  },
];

export function Promoters({ slug, subTab }: { slug: string; subTab?: string }) {
  const [, navigate] = usePortalHashLocation();
  const tab = subTab === "codes" ? "codes" : "promoters";
  const pager = useOffsetPager();
  const { offset, pageSize } = pager;
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/promoters`;
  const sort = tab === "promoters" ? "-impact" : "-conversions";
  const resetKey = buildCollectionResetKey(endpoint, { view: tab, sort });
  const requestOffset = useCollectionOffset(resetKey, offset, pager.resetPage);
  const { data, loading, error } = useServerCollection({
    endpoint,
    params: {
      view: tab,
      limit: String(pageSize),
      offset: String(requestOffset),
      sort,
    },
    responseSchema: eventPromotersListResponseSchema,
    load: loadEventPromoters,
  });

  if (loading)
    return (
      <div class="pk">
        <Spinner label="Loading promoters…" />
      </div>
    );
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  const { promoters, referralCodes, summary, page } = data;
  const ranked: RankedPromoter[] = promoters.map((promoter, index) => ({
    ...promoter,
    rank: page.offset + index + 1,
  }));
  const inviteConversion =
    summary.totalInvitesSent > 0
      ? `${((summary.totalInvitesAccepted / summary.totalInvitesSent) * 100).toFixed(0)}% conversion`
      : undefined;

  return (
    <div class="pk pk-stack">
      {tab === "promoters" && summary.activePromoters > 0 && (
        <div class="pk-grid pk-grid--tight">
          <StatCard
            label="Active promoters"
            value={String(summary.activePromoters)}
            note={`${String(summary.promotersWithRegistrations)} with registrations`}
          />
          <StatCard label="Invites sent" value={String(summary.totalInvitesSent)} />
          <StatCard label="Invites accepted" value={String(summary.totalInvitesAccepted)} note={inviteConversion} />
          <StatCard label="Link clicks" value={String(summary.totalReferralClicks)} />
          <StatCard label="Link registrations" value={String(summary.totalReferralConversions)} />
        </div>
      )}

      <Tabs
        label="Promotion views"
        items={[
          { key: "promoters", label: `Active promoters (${String(summary.activePromoters)})` },
          { key: "codes", label: `Referral codes (${String(summary.referralCodeCount)})` },
        ]}
        active={tab}
        onChange={(key) => navigate(`/events/${slug}/promoters/${key === "promoters" ? "" : key}`)}
        hrefFor={(key) => `/events/${slug}/promoters/${key === "promoters" ? "" : key}`}
      />

      {tab === "promoters" && (
        <DataTable
          caption="Promoters, ranked by impact"
          columns={PROMOTER_COLUMNS}
          rows={ranked}
          rowKey={(row) => row.userId}
          empty={
            <EmptyState
              title="No promoter activity yet"
              body="Promoters appear here once someone sends an invitation or shares a referral link."
            />
          }
        />
      )}

      {tab === "codes" && (
        <DataTable
          caption="Referral codes"
          columns={REFERRAL_CODE_COLUMNS}
          rows={referralCodes}
          rowKey={(row) => row.code}
          empty={
            <EmptyState
              title="No referral codes issued"
              body="A referral code is created when a promoter shares this event."
            />
          }
        />
      )}

      <Pager
        {...pager.pagerProps({
          hasMore: page.hasMore,
          rowCount: promoters.length + referralCodes.length,
          total: page.total,
          serverOffset: page.offset,
        })}
      />
    </div>
  );
}
