import { useState, useRef } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import type { Column } from "../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Tabs } from "../../../../components/Tabs";
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
import { promoterRankCardClass, promoterRankTier } from "../../../../shared/donation/promoter-ranking";
import { useOffsetPager } from "../../../../hooks/useOffsetPager";
import { portalSession } from "../../state";
import { portalHasGlobalPermission } from "../../shell/portal-navigation";

const FILTERS = ["", "pending", "awaiting_payment", "completed", "expired", "failed"] as const;
const loadPortalCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

function DonorPromoterCard({ p, rank }: { p: PromoterRow; rank: number }) {
  const ownAmt = p.own_gross > 0 && p.own_currency ? formatDonationAmount(p.own_gross, p.own_currency) : null;
  const refAmt = p.attributed_gross > 0 && p.currency ? formatDonationAmount(p.attributed_gross, p.currency) : null;
  const totalUsd = p.own_gross_usd + p.attributed_gross_usd;
  const totalAmt = totalUsd > 0 ? formatDonationAmount(totalUsd, "usd") : "—";
  const appBase = window.location.origin;

  return (
    <div class={`adm-promoter-card ${promoterRankCardClass(rank)}`}>
      <div class={`adm-promoter-rank ${promoterRankTier(rank)}`}>{rank}</div>
      <div class="adm-promoter-info">
        <div class="name">{p.name ?? <span class="fst-italic text-muted">anonymous</span>}</div>
        <a href={`${appBase}/donate/r/${p.code}`} target="_blank" rel="noopener" class="email mono">
          /donate/r/{p.code}
        </a>
      </div>
      <div class="adm-promoter-stats">
        <div class="adm-promoter-group">
          <div class="adm-promoter-group-label">Own Donation</div>
          <div class="d-flex gap-3">
            <div class="adm-promoter-stat">
              <div class={`val ${ownAmt ? "text-success" : "text-muted"}`}>{ownAmt ?? "—"}</div>
              <div class="lbl">Amount</div>
            </div>
          </div>
        </div>
        <div class="adm-promoter-group">
          <div class="adm-promoter-group-label">Referrals</div>
          <div class="d-flex gap-3">
            <div class="adm-promoter-stat">
              <div class="val">{p.clicks}</div>
              <div class="lbl">Clicks</div>
            </div>
            <div class="adm-promoter-stat">
              <div class="val text-success">{p.attributed_completed}</div>
              <div class="lbl">Donated</div>
              {p.attributed_total > p.attributed_completed && (
                <div class="small text-muted">of {p.attributed_total}</div>
              )}
            </div>
            <div class="adm-promoter-stat">
              <div class={`val ${refAmt ? "text-success" : "text-muted"}`}>{refAmt ?? "—"}</div>
              <div class="lbl">Amount</div>
            </div>
          </div>
        </div>
        <div class="adm-promoter-stat adm-promoter-impact">
          <div class="val fw-bold text-success">{totalAmt}</div>
          <div class="lbl">Total Impact</div>
        </div>
      </div>
    </div>
  );
}

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

  return (
    <div>
      {summary.promoterCount > 0 && (
        <div class="stat-grid mb-3">
          <div class="stat-card ok">
            <div class="val">{summary.promoterCount}</div>
            <div class="lbl">Share Links</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{formatDonationAmount(summary.totalOwnGrossUsd, "usd")}</div>
            <div class="lbl">Own Donations</div>
          </div>
          <div class="stat-card">
            <div class="val">{summary.totalClicks}</div>
            <div class="lbl">Link Clicks</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{summary.totalAttributedCompleted}</div>
            <div class="lbl">Referred Donors</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{formatDonationAmount(summary.totalAttributedGrossUsd, "usd")}</div>
            <div class="lbl">Referred Amount</div>
          </div>
        </div>
      )}

      <div class="d-flex justify-content-end mb-2">
        <button class="btn btn-sm btn-outline-secondary" onClick={() => void listing.reload()}>
          ↺ Refresh
        </button>
      </div>
      {listing.loading && <Spinner label="Loading donations…" />}
      {!listing.loading && listing.error && <ErrorAlert error={listing.error} />}
      {!listing.loading &&
        !listing.error &&
        (promoters.length === 0 ? (
          <div class="text-muted text-center py-4">No promoter links yet</div>
        ) : (
          <div class="d-flex flex-column gap-2">
            {promoters.map((p, i) => (
              <DonorPromoterCard key={p.code} p={p} rank={offset + i + 1} />
            ))}
          </div>
        ))}
      {!listing.loading && !listing.error && (
        <Pager
          {...pager.pagerProps({
            hasMore: listing.data?.page.hasMore ?? false,
            rowCount: promoters.length,
            total: summary.promoterCount,
          })}
        />
      )}
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
    <div class="d-flex align-items-center gap-2 flex-wrap">
      {pending !== undefined && pending > 0 && (
        <button class="btn btn-sm btn-outline-success" disabled={syncing !== null} onClick={() => void sync("pending")}>
          {syncing === "pending" ? "Syncing…" : `↺ Sync pending (${pending})`}
        </button>
      )}
      <button
        class="btn btn-sm btn-success"
        disabled={syncing !== null || (syncable !== undefined && syncable === 0)}
        onClick={() => void sync("all")}
      >
        {syncing === "all" ? "Syncing…" : syncable === undefined ? "↺ Sync donations" : `↺ Sync all (${syncable})`}
      </button>
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
        <section aria-labelledby="donation-sync-heading">
          <h5 id="donation-sync-heading" class="mb-2">
            Donation synchronization
          </h5>
          <p class="text-muted small">You can reconcile donations without access to donor records.</p>
          <DonationSyncActions />
        </section>
      );
    }
    return (
      <div class="alert alert-warning" role="alert">
        Donation records require the <code>donations:read</code> permission.
      </div>
    );
  }
  return <DonationsView subTab={subTab} canSync={canSync} />;
}

function DonationsView({ subTab, canSync }: { subTab?: string; canSync: boolean }) {
  const canReadAnalytics = portalHasGlobalPermission(portalSession.value, "analytics:read");
  const tab = subTab === "promoters" ? "promoters" : subTab === "stats" && canReadAnalytics ? "stats" : "list";
  const [statusFilter, setStatusFilter] = useState("");
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
          {d.organization && <small class="text-muted"> — {d.organization}</small>}
        </>
      ),
      sort: { asc: "name", desc: "-name" },
    },
    {
      header: { label: "Amount", className: "text-end" },
      cell: (d) => {
        const gross = formatDonationAmount(d.gross_amount, d.currency);
        const netCurrency = d.settled_currency ?? d.currency;
        const net = d.net_amount !== null ? formatDonationAmount(d.net_amount, netCurrency) : null;
        return (
          <>
            <span class="fw-semibold">{gross}</span>
            {net && <small class="text-muted d-block">Net: {net}</small>}
          </>
        );
      },
      className: "text-end text-nowrap",
      sort: { asc: "gross_amount", desc: "-gross_amount", defaultDirection: "desc" },
    },
    {
      header: "Status",
      cell: (d) => <Badge status={d.status} />,
      className: "small",
      sort: { asc: "status", desc: "-status" },
    },
    {
      header: "Method",
      cell: (d) => (d.payment_method_type ? asyncPaymentWindow(d.payment_method_type).label : "—"),
      className: "small",
    },
    {
      header: "Date",
      cell: (d) => fmtDate(d.completed_at ?? d.created_at),
      className: "small text-muted text-nowrap",
      sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
    },
  ];

  return (
    <div>
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
        <>
          <ApiDataTable
            caption="Donations"
            urlState="donations"
            endpoint="/api/v1/donations"
            responseSchema={donationsListResponseSchema}
            resolve={(d) => d.donations}
            resolvePage={(d) => d.page}
            onData={(d) => setSummary(d.summary)}
            paginate
            params={{
              ...(statusFilter && { status: statusFilter }),
            }}
            actionsRef={actionsRef}
            toolbar={({ resetPage }) => (
              <>
                <div class="d-flex align-items-center gap-2 flex-wrap">
                  {FILTERS.map((f) => {
                    const label =
                      f === "" ? "All" : f === "awaiting_payment" ? "Awaiting" : f.charAt(0).toUpperCase() + f.slice(1);
                    const count = f === "" ? total : (summary.byStatus[f] ?? 0);
                    return (
                      <button
                        key={f}
                        class={`btn btn-sm btn-outline-secondary${statusFilter === f ? " active" : ""}`}
                        onClick={() => {
                          setStatusFilter(f);
                          resetPage();
                        }}
                      >
                        {label} <span class="badge text-bg-secondary">{count}</span>
                      </button>
                    );
                  })}
                </div>
                {canSync && (
                  <DonationSyncActions
                    pending={pending}
                    syncable={summary.syncable}
                    onSynced={() => actionsRef.current?.reload() ?? Promise.resolve()}
                  />
                )}
                {failed > 0 && (
                  <span class="badge text-bg-danger" title="Payment failed">
                    {failed} failed
                  </span>
                )}
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
        </>
      )}

      {tab === "promoters" && <PromotersTab />}

      {tab === "stats" && canReadAnalytics && <DonationAnalytics />}
    </div>
  );
}
