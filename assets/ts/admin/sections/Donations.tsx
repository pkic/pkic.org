import { useState, useEffect, useRef } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { ApiDataTable, type ApiTableActions, type Column } from "../../components/Table";
import { Tabs } from "../../components/Tabs";
import { api } from "../api";
import { fmt, toast } from "../ui";
import { asyncPaymentWindow } from "../../../shared/constants/async-payment-window";

interface DonationRow {
  id: string;
  checkout_session_id: string;
  payment_intent_id: string | null;
  name: string;
  email: string;
  organization: string | null;
  currency: string;
  gross_amount: number;
  net_amount: number | null;
  source: string | null;
  status: string;
  payment_method_type: string | null;
  session_expires_at: number | null;
  settled_amount: number | null;
  settled_currency: string | null;
  created_at: string;
  completed_at: string | null;
}

interface DonationsResponse {
  donations: DonationRow[];
  summary: Record<string, number>;
  limit: number;
  offset: number;
  total: number;
}

interface DonationSyncResult {
  sessionId: string;
  outcome: "completed" | "expired" | "awaiting_payment" | "failed" | "still_pending" | "error";
  error?: string;
}

interface DonationSyncResponse {
  synced: number;
  completed: number;
  expired: number;
  failed: number;
  errors: number;
  results: DonationSyncResult[];
}

interface PromoterRow {
  code: string;
  name: string | null;
  checkout_session_id: string | null;
  clicks: number;
  own_gross: number;
  own_gross_usd: number;
  own_currency: string | null;
  attributed_total: number;
  attributed_completed: number;
  attributed_gross: number;
  attributed_gross_usd: number;
  currency: string | null;
  created_at: string;
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);
const FILTERS = ["", "pending", "awaiting_payment", "completed", "expired", "failed"] as const;

function fmtAmount(smallestUnit: number, currency: string): string {
  const code = currency.toLowerCase();
  const major = ZERO_DECIMAL_CURRENCIES.has(code) ? smallestUnit : smallestUnit / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2,
    }).format(major);
  } catch {
    return `${major} ${currency.toUpperCase()}`;
  }
}

const RANK_CLASS: Record<number, string> = { 1: "gold", 2: "silver", 3: "bronze" };
const RANK_CARD: Record<number, string> = { 1: "top-1", 2: "top-2", 3: "top-3" };

function rankTier(rank: number): string {
  if (rank <= 3) return RANK_CLASS[rank];
  if (rank <= 10) return "top-ten";
  return "other";
}

function DonorPromoterCard({ p, rank }: { p: PromoterRow; rank: number }) {
  const ownAmt = p.own_gross > 0 && p.own_currency ? fmtAmount(p.own_gross, p.own_currency) : null;
  const refAmt = p.attributed_gross > 0 && p.currency ? fmtAmount(p.attributed_gross, p.currency) : null;
  const totalUsd = p.own_gross_usd + p.attributed_gross_usd;
  const totalAmt = totalUsd > 0 ? fmtAmount(totalUsd, "usd") : "—";
  const appBase = window.location.origin;

  return (
    <div class={`adm-promoter-card ${RANK_CARD[rank] ?? (rank <= 10 ? "top-ten" : "")}`}>
      <div class={`adm-promoter-rank ${rankTier(rank)}`}>{rank}</div>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promoters, setPromoters] = useState<PromoterRow[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ promoters: PromoterRow[] }>("/api/v1/admin/donations/promoters");
      setPromoters(data.promoters);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Sort by total USD impact (own + attributed)
  const sorted = [...promoters].sort(
    (a, b) => b.own_gross_usd + b.attributed_gross_usd - (a.own_gross_usd + a.attributed_gross_usd),
  );

  // Summary stats (USD-normalised)
  const totalOwn = sorted.reduce((s, p) => s + p.own_gross_usd, 0);
  const totalReferred = sorted.reduce((s, p) => s + p.attributed_gross_usd, 0);
  const totalClicks = sorted.reduce((s, p) => s + p.clicks, 0);
  const totalDonated = sorted.reduce((s, p) => s + p.attributed_completed, 0);

  return (
    <div>
      {sorted.length > 0 && (
        <div class="stat-grid mb-3">
          <div class="stat-card ok">
            <div class="val">{sorted.length}</div>
            <div class="lbl">Share Links</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{fmtAmount(totalOwn, "usd")}</div>
            <div class="lbl">Own Donations</div>
          </div>
          <div class="stat-card">
            <div class="val">{totalClicks}</div>
            <div class="lbl">Link Clicks</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{totalDonated}</div>
            <div class="lbl">Referred Donors</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{fmtAmount(totalReferred, "usd")}</div>
            <div class="lbl">Referred Amount</div>
          </div>
        </div>
      )}

      <div class="d-flex justify-content-end mb-2">
        <button class="btn btn-sm btn-outline-secondary" onClick={load}>
          ↺ Refresh
        </button>
      </div>
      {loading && <Spinner />}
      {!loading && <ErrorAlert error={error} />}
      {!loading &&
        !error &&
        (sorted.length === 0 ? (
          <div class="text-muted text-center py-4">No promoter links yet</div>
        ) : (
          <div class="d-flex flex-column gap-2">
            {sorted.map((p, i) => (
              <DonorPromoterCard key={p.code} p={p} rank={i + 1} />
            ))}
          </div>
        ))}
    </div>
  );
}

export function Donations({ subTab }: { subTab?: string }) {
  const tab = subTab === "promoters" ? "promoters" : "list";
  const [statusFilter, setStatusFilter] = useState("");
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [syncingAll, setSyncingAll] = useState(false);
  const [, navigate] = useHashLocation();
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const actionsRef = useRef<ApiTableActions | null>(null);

  async function handleSyncPending() {
    setSyncingAll(true);
    try {
      const res = await api<DonationSyncResponse>("/api/v1/admin/donations/sync", {
        method: "POST",
        body: JSON.stringify({ pendingOnly: true }),
      });
      const parts = [
        res.completed ? `${res.completed} completed` : "",
        res.failed ? `${res.failed} failed` : "",
        res.expired ? `${res.expired} expired` : "",
        res.errors ? `${res.errors} errors` : "",
      ]
        .filter(Boolean)
        .join(", ");
      toast(
        `Synced ${res.synced}${parts ? `: ${parts}` : "."}`,
        res.errors > 0 || res.failed > 0 ? "error" : "success",
      );
      actionsRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSyncingAll(false);
    }
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    try {
      const res = await api<DonationSyncResponse>("/api/v1/admin/donations/sync", { method: "POST" });
      const parts = [
        res.completed ? `${res.completed} completed` : "",
        res.failed ? `${res.failed} failed` : "",
        res.expired ? `${res.expired} expired` : "",
        res.errors ? `${res.errors} errors` : "",
      ]
        .filter(Boolean)
        .join(", ");
      toast(
        `Synced ${res.synced}${parts ? `: ${parts}` : "."}`,
        res.errors > 0 || res.failed > 0 ? "error" : "success",
      );
      actionsRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSyncingAll(false);
    }
  }

  const total = Object.values(summary).reduce((sum, v) => sum + v, 0);
  const pending = (summary.pending ?? 0) + (summary.awaiting_payment ?? 0);
  const backfillable = donations.filter(
    (d) => d.status === "completed" && (d.net_amount === null || d.payment_method_type === null),
  ).length;
  const syncable = pending + backfillable;
  const failed = summary.failed ?? 0;

  const columns: Column<DonationRow>[] = [
    {
      header: "Donor",
      cell: (d) => (
        <>
          {d.name}
          {d.organization && <small class="text-muted"> — {d.organization}</small>}
        </>
      ),
    },
    {
      header: { label: "Amount", className: "text-end" },
      cell: (d) => {
        const gross = fmtAmount(d.gross_amount, d.currency);
        const netCurrency = d.settled_currency ?? d.currency;
        const net = d.net_amount !== null ? fmtAmount(d.net_amount, netCurrency) : null;
        return (
          <>
            <span class="fw-semibold">{gross}</span>
            {net && <small class="text-muted d-block">Net: {net}</small>}
          </>
        );
      },
      className: "text-end text-nowrap",
    },
    {
      header: "Status",
      cell: (d) => <Badge status={d.status} />,
      className: "small",
    },
    {
      header: "Method",
      cell: (d) => (d.payment_method_type ? asyncPaymentWindow(d.payment_method_type).label : "—"),
      className: "small",
    },
    {
      header: "Date",
      cell: (d) => fmt(d.completed_at ?? d.created_at),
      className: "small text-muted text-nowrap",
    },
  ];

  return (
    <div>
      <Tabs
        items={[
          { key: "list", label: "Donations" },
          { key: "promoters", label: "Share Links" },
        ]}
        active={tab}
        onChange={(k) => navigate(k === "list" ? "/donations" : "/donations/promoters")}
      />

      {tab === "list" && (
        <>
          <ApiDataTable<DonationRow>
            endpoint="/api/v1/admin/donations"
            resolve={(d) => {
              const resp = d as DonationsResponse;
              setSummary(resp.summary);
              setDonations(resp.donations);
              return resp.donations;
            }}
            resolvePage={(d) => {
              const resp = d as DonationsResponse;
              return { total: resp.total, hasMore: resp.offset + resp.limit < resp.total };
            }}
            paginate
            params={{
              ...(statusFilter && { status: statusFilter }),
            }}
            deps={[statusFilter]}
            actionsRef={actionsRef}
            toolbar={({ resetPage }) => (
              <>
                <div class="d-flex align-items-center gap-2 flex-wrap">
                  {FILTERS.map((f) => {
                    const label =
                      f === "" ? "All" : f === "awaiting_payment" ? "Awaiting" : f.charAt(0).toUpperCase() + f.slice(1);
                    const count = f === "" ? total : (summary[f] ?? 0);
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
                {pending > 0 && (
                  <button class="btn btn-sm btn-outline-success" disabled={syncingAll} onClick={handleSyncPending}>
                    {syncingAll ? "Syncing…" : `↺ Sync pending (${pending})`}
                  </button>
                )}
                <button class="btn btn-sm btn-success" disabled={syncingAll || syncable === 0} onClick={handleSyncAll}>
                  {syncingAll ? "Syncing…" : `↺ Sync all (${syncable})`}
                </button>
                {failed > 0 && (
                  <span class="badge text-bg-danger" title="Payment failed">
                    {failed} failed
                  </span>
                )}
              </>
            )}
            columns={columns}
            empty="No donations found"
            className="align-middle"
            rowKey={(d) => d.id}
            onRowClick={(d) => navigate(`/donations/${d.id}`)}
          />
        </>
      )}

      {tab === "promoters" && <PromotersTab />}
    </div>
  );
}
