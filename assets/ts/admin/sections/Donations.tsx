import { useState, useEffect, useCallback } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Table } from "../../components/Table";
import { Tabs } from "../../components/Tabs";
import { api } from "../api";
import { fmt } from "../ui";
import { toast } from "../ui";
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
  created_at: string;
  completed_at: string | null;
}

interface DonationsResponse {
  donations: DonationRow[];
  summary: Record<string, number>;
  limit: number;
  offset: number;
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
  own_currency: string | null;
  attributed_total: number;
  attributed_completed: number;
  attributed_gross: number;
  currency: string | null;
  created_at: string;
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
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

function DonationTableRow({ d, onSync }: { d: DonationRow; onSync: (sessionId: string) => void }) {
  const [syncing, setSyncing] = useState(false);
  const gross = fmtAmount(d.gross_amount, d.currency);
  const net = d.net_amount !== null ? fmtAmount(d.net_amount, d.currency) : "—";
  const needsSync =
    d.status === "pending" ||
    d.status === "awaiting_payment" ||
    (d.status === "completed" && (d.net_amount === null || d.payment_method_type === null));
  const methodLabel = d.payment_method_type ? asyncPaymentWindow(d.payment_method_type).label : "—";
  const deadline =
    d.status === "awaiting_payment" && d.session_expires_at
      ? new Date(d.session_expires_at * 1000).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;
  const badgeUrl = `/api/v1/og/donation/${encodeURIComponent(d.checkout_session_id)}?name=${encodeURIComponent(d.name)}`;

  async function handleSync() {
    setSyncing(true);
    try {
      await onSync(d.checkout_session_id);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <tr>
      <td class="mono small">{d.checkout_session_id.slice(0, 24)}…</td>
      <td>
        {d.name}
        <br />
        <small class="text-muted">{d.email}</small>
        {d.organization && (
          <>
            <br />
            <small class="text-muted">{d.organization}</small>
          </>
        )}
      </td>
      <td>
        {gross}
        <br />
        <small class="text-muted">Net: {net}</small>
      </td>
      <td>
        <Badge status={d.status} />{" "}
        {needsSync && (
          <button
            class="btn btn-xs btn-outline-primary adm-donation-action-btn"
            disabled={syncing}
            onClick={handleSync}
          >
            {syncing ? "…" : "Sync"}
          </button>
        )}
        {d.status === "completed" && (
          <a
            class="btn btn-xs btn-outline-secondary adm-donation-action-btn"
            href={badgeUrl}
            download={`${d.name.replace(/[^\w\s-]/g, "")}-donation-badge.jpeg`}
          >
            🖼 Badge
          </a>
        )}
      </td>
      <td class="small">
        {methodLabel}
        {deadline && (
          <>
            <br />
            <small class="text-muted">due {deadline}</small>
          </>
        )}
      </td>
      <td class="small text-muted">{d.source ?? "—"}</td>
      <td class="small text-muted">{fmt(d.created_at)}</td>
      <td class="small text-muted">{fmt(d.completed_at)}</td>
    </tr>
  );
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
  const totalGross = p.own_gross + p.attributed_gross;
  const totalCurrency = p.own_currency ?? p.currency;
  const totalAmt = totalGross > 0 && totalCurrency ? fmtAmount(totalGross, totalCurrency) : "—";
  const appBase = window.location.origin;

  return (
    <div class={`adm-promoter-card ${RANK_CARD[rank] ?? (rank <= 10 ? "top-ten" : "")}`}>
      <div class={`adm-promoter-rank ${rankTier(rank)}`}>
        {rank}
      </div>
      <div class="adm-promoter-info">
        <div class="name">{p.name ?? <span class="fst-italic text-muted">anonymous</span>}</div>
        <a href={`${appBase}/donate/r/${p.code}`} target="_blank" rel="noopener" class="email mono">/donate/r/{p.code}</a>
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

  useEffect(() => { void load(); }, []);

  // Sort by total impact (own + attributed)
  const sorted = [...promoters].sort((a, b) => (b.own_gross + b.attributed_gross) - (a.own_gross + a.attributed_gross));

  // Summary stats
  const totalOwn = sorted.reduce((s, p) => s + p.own_gross, 0);
  const totalReferred = sorted.reduce((s, p) => s + p.attributed_gross, 0);
  const totalClicks = sorted.reduce((s, p) => s + p.clicks, 0);
  const totalDonated = sorted.reduce((s, p) => s + p.attributed_completed, 0);
  const mainCurrency = sorted.find((p) => p.own_currency ?? p.currency)?.own_currency
    ?? sorted.find((p) => p.currency)?.currency ?? "USD";

  return (
    <div>
      {sorted.length > 0 && (
        <div class="stat-grid mb-3">
          <div class="stat-card ok">
            <div class="val">{sorted.length}</div>
            <div class="lbl">Share Links</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{fmtAmount(totalOwn, mainCurrency)}</div>
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
            <div class="val">{fmtAmount(totalReferred, mainCurrency)}</div>
            <div class="lbl">Referred Amount</div>
          </div>
        </div>
      )}

      <div class="d-flex justify-content-end mb-2">
        <button class="btn btn-sm btn-outline-secondary" onClick={load}>↺ Refresh</button>
      </div>
      {loading && <Spinner />}
      {!loading && <ErrorAlert error={error} />}
      {!loading && !error && (
        sorted.length === 0
          ? <div class="text-muted text-center py-4">No promoter links yet</div>
          : <div class="d-flex flex-column gap-2">
              {sorted.map((p, i) => (
                <DonorPromoterCard key={p.code} p={p} rank={i + 1} />
              ))}
            </div>
      )}
    </div>
  );
}

export function Donations() {
  const [tab, setTab] = useState<"list" | "promoters">("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState("");
  const [syncingAll, setSyncingAll] = useState(false);

  const load = useCallback(async (filter?: string) => {
    const activeFilter = filter !== undefined ? filter : statusFilter;
    setLoading(true);
    setError(null);
    try {
      const qs = activeFilter ? `?status=${encodeURIComponent(activeFilter)}` : "";
      const data = await api<DonationsResponse>(`/api/v1/admin/donations${qs}`);
      setDonations(data.donations);
      setSummary(data.summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [statusFilter]);

  async function handleSync(sessionId: string) {
    try {
      const res = await api<DonationSyncResponse>("/api/v1/admin/donations/sync", {
        method: "POST",
        body: JSON.stringify({ sessionIds: [sessionId] }),
      });
      const result = res.results[0];
      if (result?.outcome === "completed") toast("Donation marked as completed.", "success");
      else if (result?.outcome === "awaiting_payment") toast("Payment initiated — awaiting bank settlement.", "info");
      else if (result?.outcome === "expired") toast("Session expired — donation marked expired.", "info");
      else if (result?.outcome === "failed") toast("Payment failed — bank declined or bounced.", "error");
      else if (result?.outcome === "still_pending") toast("Session still pending on Stripe.", "info");
      else toast(result?.error ?? "Sync failed.", "error");
      void load(statusFilter);
    } catch (e) {
      toast((e as Error).message, "error");
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
      ].filter(Boolean).join(", ");
      toast(`Synced ${res.synced}${parts ? `: ${parts}` : "."}`, res.errors > 0 || res.failed > 0 ? "error" : "success");
      void load(statusFilter);
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

  return (
    <div>
      <Tabs
        items={[
          { key: "list", label: "Donations" },
          { key: "promoters", label: "Share Links" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
      />

      {tab === "list" && (
        <div>
          <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
            {FILTERS.map((f) => {
              const label =
                f === "" ? "All" : f === "awaiting_payment" ? "Awaiting" : f.charAt(0).toUpperCase() + f.slice(1);
              const count = f === "" ? total : (summary[f] ?? 0);
              return (
                <button
                  key={f}
                  class={`btn btn-sm btn-outline-secondary${statusFilter === f ? " active" : ""}`}
                  onClick={() => setStatusFilter(f)}
                >
                  {label} <span class="badge text-bg-secondary">{count}</span>
                </button>
              );
            })}
            <div class="ms-auto d-flex gap-2 align-items-center">
              <button
                class="btn btn-sm btn-success"
                disabled={syncingAll || syncable === 0}
                onClick={handleSyncAll}
              >
                {syncingAll ? "Syncing…" : `↺ Sync all (${syncable})`}
              </button>
              {failed > 0 && (
                <span class="badge text-bg-danger" title="Payment failed">
                  {failed} failed
                </span>
              )}
            </div>
          </div>

          {loading && <Spinner />}
          {!loading && <ErrorAlert error={error} />}
          {!loading && !error && (
            <Table
              heads={["Session ID", "Donor", "Amount", "Status", "Method", "Source", "Created", "Completed"]}
              empty="No donations found"
            >
              {donations.map((d) => (
                <DonationTableRow key={d.id} d={d} onSync={handleSync} />
              ))}
            </Table>
          )}
        </div>
      )}

      {tab === "promoters" && <PromotersTab />}
    </div>
  );
}
