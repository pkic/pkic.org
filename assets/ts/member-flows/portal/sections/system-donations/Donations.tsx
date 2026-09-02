/**
 * Donations — the system donations surface: the donation list, the promoter
 * share-link leaderboard, and the analytics tab.
 *
 * Migrated off Bootstrap onto the design system. Three things changed shape
 * rather than just class name:
 *
 *   - The promoter leaderboard was a stack of `adm-promoter-card` divs, a
 *     legacy vocabulary defined in `assets/scss` that disappears with
 *     `main.scss`. Seven ranked measures per promoter are tabular data, so it
 *     is a DataTable now: one caption instead of N unnamed card regions,
 *     column headers instead of a `lbl` div, and columns that line up so the
 *     numbers can actually be compared down the list.
 *   - The status filters were `btn-outline-secondary` buttons carrying an
 *     `active` class, which said "selected" to a sighted reader and nothing to
 *     anyone else. They are Chips, whose pressed state is `aria-pressed`.
 *   - The rank tiers (gold/silver/bronze) and the green amounts signalled with
 *     colour alone. The rank number and the column header carry it instead.
 */
import { useState, useRef } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { Badge as StatusBadge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import type { Column } from "../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Tabs } from "../../../../components/Tabs";
import { Alert } from "../../../../ui/Alert";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";
import { getJson, postJson } from "../../../../shared/api-client";
import { fmtDate, toast } from "../../ui";
import { asyncPaymentWindow } from "../../../../../shared/constants/async-payment-window";
import { Pager } from "../../../../components/Pager";
import {
  donationPromotersListResponseSchema,
  donationSyncResponseSchema,
  donationsListResponseSchema,
  type DonationManagementListSummary,
  type DonationPromoter as PromoterRow,
} from "../../../../../shared/schemas/donation-management";
import { formatDonationAmount, type DonationRow } from "./model";
import { DonationAnalytics } from "./DonationAnalytics";
import { useServerCollection, type CollectionLoader } from "../../../../hooks/useServerCollection";
import { useOffsetPager } from "../../../../hooks/useOffsetPager";
import { portalSession } from "../../state";
import { portalHasGlobalPermission } from "../../shell/portal-navigation";
// `pk-mono` lives in Content.css, which ships in a lazy chunk: a surface that
// writes the class name has to import the stylesheet itself, or the share-link
// and permission code render in the body face once the page stops loading
// Bootstrap.
import "../../../../ui/Content.css";

const FILTERS = ["", "pending", "awaiting_payment", "completed", "expired", "failed"] as const;
const loadPortalCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

/** The filter's own wording, so the button label is not derived from the wire value in the markup. */
function filterLabel(filter: (typeof FILTERS)[number]): string {
  if (filter === "") return "All";
  if (filter === "awaiting_payment") return "Awaiting";
  return filter.charAt(0).toUpperCase() + filter.slice(1);
}

interface RankedPromoterRow extends PromoterRow {
  rank: number;
}

/** The promoter's own donation, or an em dash when they have not given themselves. */
function ownAmount(promoter: PromoterRow): string {
  return promoter.own_gross > 0 && promoter.own_currency
    ? formatDonationAmount(promoter.own_gross, promoter.own_currency)
    : "—";
}

function referredAmount(promoter: PromoterRow): string {
  return promoter.attributed_gross > 0 && promoter.currency
    ? formatDonationAmount(promoter.attributed_gross, promoter.currency)
    : "—";
}

function totalImpact(promoter: PromoterRow): string {
  const totalUsd = promoter.own_gross_usd + promoter.attributed_gross_usd;
  return totalUsd > 0 ? formatDonationAmount(totalUsd, "usd") : "—";
}

const PROMOTER_COLUMNS: ReadonlyArray<DataTableColumn<RankedPromoterRow>> = [
  {
    id: "rank",
    header: "Rank",
    align: "end",
    width: "fit",
    // The number is the content, so the tone is emphasis rather than the only
    // thing distinguishing the top three from the rest.
    cell: (row) => (
      <Badge tone={row.rank <= 3 ? "accent" : "neutral"} dot={false}>
        {row.rank}
      </Badge>
    ),
  },
  {
    id: "promoter",
    header: "Promoter",
    // The design system's table gives slack to no column on its own; the
    // promoter — the row's subject — is where extra room does the most good.
    width: "primary",
    cell: (row) => (
      <div class="pk-stack pk-stack--tight">
        <span>{row.name ?? "Anonymous"}</span>
        {/* Root-relative, so the link resolves against the origin without the
            component reaching for `window` while it renders. */}
        <a class="pk-mono pk-small pk-break" href={`/donate/r/${row.code}`} target="_blank" rel="noopener">
          /donate/r/{row.code}
        </a>
      </div>
    ),
  },
  { id: "own", header: "Own donation", align: "end", width: "fit", cell: (row) => ownAmount(row) },
  { id: "clicks", header: "Link clicks", align: "end", width: "fit", cell: (row) => row.clicks },
  {
    id: "referred",
    header: "Referred donors",
    align: "end",
    width: "fit",
    cell: (row) =>
      row.attributed_total > row.attributed_completed ? (
        <>
          {row.attributed_completed} <span class="pk-small">of {row.attributed_total}</span>
        </>
      ) : (
        row.attributed_completed
      ),
  },
  {
    id: "referred-amount",
    header: "Referred amount",
    align: "end",
    width: "fit",
    cell: (row) => referredAmount(row),
  },
  {
    id: "impact",
    header: "Total impact",
    align: "end",
    width: "fit",
    cell: (row) => <span class="pk-strong">{totalImpact(row)}</span>,
  },
];

function PromotersTab() {
  const pager = useOffsetPager();
  const { offset, pageSize } = pager;
  const listing = useServerCollection({
    endpoint: "/api/v1/donations/promoters",
    params: {
      limit: String(pageSize),
      offset: String(offset),
      sort: "-impact",
    },
    responseSchema: donationPromotersListResponseSchema,
    load: loadPortalCollection,
  });
  const promoters = listing.data?.promoters ?? [];
  const summary = listing.data?.summary ?? {
    promoterCount: 0,
    totalOwnGrossUsd: 0,
    totalAttributedGrossUsd: 0,
    totalClicks: 0,
    totalAttributedCompleted: 0,
  };
  const rows: RankedPromoterRow[] = promoters.map((promoter, index) => ({ ...promoter, rank: offset + index + 1 }));

  return (
    <div class="pk pk-stack">
      {summary.promoterCount > 0 && (
        <div class="pk-grid pk-grid--tight">
          <StatCard label="Share links" value={String(summary.promoterCount)} />
          <StatCard label="Own donations" value={formatDonationAmount(summary.totalOwnGrossUsd, "usd")} />
          <StatCard label="Link clicks" value={String(summary.totalClicks)} />
          <StatCard label="Referred donors" value={String(summary.totalAttributedCompleted)} />
          <StatCard label="Referred amount" value={formatDonationAmount(summary.totalAttributedGrossUsd, "usd")} />
        </div>
      )}

      <Panel>
        <PanelHeader title="Share links" headingLevel={2}>
          <Button size="sm" onClick={() => void listing.reload()}>
            <span aria-hidden="true">↺</span> Refresh
          </Button>
        </PanelHeader>
        <PanelBody class="pk-stack pk-stack--snug">
          {listing.loading && <Spinner label="Loading share links…" />}
          {!listing.loading && listing.error && <ErrorAlert error={listing.error} />}
          {!listing.loading && !listing.error && (
            <>
              <DataTable
                caption="Promoter share links, ranked by total impact"
                columns={PROMOTER_COLUMNS}
                rows={rows}
                rowKey={(row) => row.code}
                empty="No promoter links yet"
              />
              <Pager
                {...pager.pagerProps({
                  hasMore: listing.data?.page.hasMore ?? false,
                  rowCount: promoters.length,
                  total: summary.promoterCount,
                })}
              />
            </>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}

function DonationSyncActions({
  pending,
  syncable,
  onSynced,
}: {
  pending?: number;
  syncable?: number;
  onSynced?: () => Promise<void>;
}) {
  const [syncing, setSyncing] = useState<"pending" | "all" | null>(null);

  async function sync(kind: "pending" | "all"): Promise<void> {
    setSyncing(kind);
    try {
      const result = await postJson(
        "/api/v1/donations/sync",
        kind === "pending" ? { pendingOnly: true } : {},
        donationSyncResponseSchema,
      );
      const parts = [
        result.completed ? `${result.completed} completed` : "",
        result.failed ? `${result.failed} failed` : "",
        result.expired ? `${result.expired} expired` : "",
        result.errors ? `${result.errors} errors` : "",
      ]
        .filter(Boolean)
        .join(", ");
      toast(
        `Synced ${result.synced}${parts ? `: ${parts}` : "."}`,
        result.errors > 0 || result.failed > 0 ? "error" : "success",
      );
      await onSynced?.();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div class="pk-cluster">
      {pending !== undefined && pending > 0 && (
        <Button
          size="sm"
          variant="secondary"
          loading={syncing === "pending"}
          disabled={syncing !== null}
          onClick={() => void sync("pending")}
        >
          <span aria-hidden="true">↺</span> {syncing === "pending" ? "Syncing…" : `Sync pending (${String(pending)})`}
        </Button>
      )}
      <Button
        size="sm"
        variant="primary"
        loading={syncing === "all"}
        disabled={syncing !== null || (syncable !== undefined && syncable === 0)}
        onClick={() => void sync("all")}
      >
        <span aria-hidden="true">↺</span>{" "}
        {syncing === "all" ? "Syncing…" : syncable === undefined ? "Sync donations" : `Sync all (${String(syncable)})`}
      </Button>
    </div>
  );
}

export function Donations({
  subTab,
  canRead = true,
  canSync = true,
}: {
  subTab?: string;
  canRead?: boolean;
  canSync?: boolean;
}) {
  if (!canRead) {
    if (canSync) {
      return (
        <div class="pk pk-stack">
          <PageHeader title="Donations" />
          <Panel aria-label="Donation synchronization">
            <PanelHeader title="Donation synchronization" headingLevel={2} />
            <PanelBody class="pk-stack pk-stack--snug">
              <p class="pk-small">You can reconcile donations without access to donor records.</p>
              <DonationSyncActions />
            </PanelBody>
          </Panel>
        </div>
      );
    }
    return (
      <div class="pk pk-stack">
        <PageHeader title="Donations" />
        <Alert tone="warn">
          Donation records require the <code class="pk-mono">donations:read</code> permission.
        </Alert>
      </div>
    );
  }
  return <DonationsView subTab={subTab} canSync={canSync} />;
}

function DonationsView({ subTab, canSync }: { subTab?: string; canSync: boolean }) {
  const canReadAnalytics = portalHasGlobalPermission(portalSession.value, "analytics:read");
  const tab = subTab === "promoters" ? "promoters" : subTab === "stats" && canReadAnalytics ? "stats" : "list";
  const [summary, setSummary] = useState<DonationManagementListSummary>({ byStatus: {}, backfillable: 0, syncable: 0 });
  const [, navigate] = usePortalHashLocation();
  const actionsRef = useRef<ApiTableActions | null>(null);

  const total = Object.values(summary.byStatus).reduce((sum, value) => sum + value, 0);
  const pending = (summary.byStatus.pending ?? 0) + (summary.byStatus.awaiting_payment ?? 0);
  const failed = summary.byStatus.failed ?? 0;

  const columns: Column<DonationRow>[] = [
    {
      header: "Donor",
      cell: (d) => (
        <>
          {d.name}
          {d.organization && <span class="pk-small"> — {d.organization}</span>}
        </>
      ),
      sort: { asc: "name", desc: "-name" },
    },
    {
      header: { label: "Amount", className: "pk-end" },
      cell: (d) => {
        const gross = formatDonationAmount(d.gross_amount, d.currency);
        const netCurrency = d.settled_currency ?? d.currency;
        const net = d.net_amount !== null ? formatDonationAmount(d.net_amount, netCurrency) : null;
        return (
          <>
            <span class="pk-strong">{gross}</span>
            {net && <div class="pk-small">Net: {net}</div>}
          </>
        );
      },
      className: "pk-end",
      width: "fit",
      sort: { asc: "gross_amount", desc: "-gross_amount", defaultDirection: "desc" },
    },
    {
      header: "Status",
      cell: (d) => <StatusBadge status={d.status} />,
      width: "fit",
      sort: { asc: "status", desc: "-status" },
      // The status filter lives in the column's own menu, like every other
      // list's filters; each choice carries its count from the summary so the
      // menu also answers "how many are pending" without a row of chips.
      filter: {
        param: "status",
        options: FILTERS.map((f) => ({
          value: f,
          label: `${filterLabel(f)} (${String(f === "" ? total : (summary.byStatus[f] ?? 0))})`,
        })),
      },
    },
    {
      header: "Method",
      cell: (d) => (d.payment_method_type ? asyncPaymentWindow(d.payment_method_type).label : "—"),
      width: "fit",
    },
    {
      // A date has a bounded length, so the column says that instead of
      // wearing `pk-nowrap` while still claiming a share of a wide screen.
      // It keeps the table's own ink and size: a second grey line left
      // nothing in the row reading as the record's own data.
      header: "Date",
      cell: (d) => fmtDate(d.completed_at ?? d.created_at),
      width: "fit",
      sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
    },
  ];

  return (
    <div class="pk pk-stack pk-stack--snug">
      <PageHeader title="Donations" />
      <Tabs
        items={[
          { key: "list", label: "Donations" },
          { key: "promoters", label: "Share Links" },
          ...(canReadAnalytics ? [{ key: "stats", label: "Stats" }] : []),
        ]}
        active={tab}
        onChange={(k) =>
          navigate(k === "list" ? "/donations" : k === "promoters" ? "/donations/promoters" : "/donations/stats")
        }
        hrefFor={(k) => (k === "list" ? "/donations" : k === "promoters" ? "/donations/promoters" : "/donations/stats")}
      />

      {tab === "list" && (
        <ApiDataTable
          caption="Donations"
          urlState="donations"
          endpoint="/api/v1/donations"
          responseSchema={donationsListResponseSchema}
          resolve={(d) => d.donations}
          resolvePage={(d) => d.page}
          onData={(d) => setSummary(d.summary)}
          paginate
          actionsRef={actionsRef}
          toolbar={() => (
            <>
              {canSync && (
                <DonationSyncActions
                  pending={pending}
                  syncable={summary.syncable}
                  onSynced={() => actionsRef.current?.reload() ?? Promise.resolve()}
                />
              )}
              {failed > 0 && <Badge tone="danger">{failed} failed</Badge>}
            </>
          )}
          columns={columns}
          empty="No donations recorded yet"
          rowKey={(d) => d.id}
          rowAction={(d) => ({
            label: `Open the donation from ${d.name}`,
            href: `#/donations/detail/${encodeURIComponent(d.id)}`,
          })}
        />
      )}

      {tab === "promoters" && <PromotersTab />}

      {tab === "stats" && canReadAnalytics && <DonationAnalytics />}
    </div>
  );
}
