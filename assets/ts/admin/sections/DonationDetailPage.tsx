import { useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { fmt, toast } from "../ui";
import { useData } from "../../hooks/useData";
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

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

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

function Field({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <div class="lbl">{label}</div>
      <div class="val">{children}</div>
    </div>
  );
}

export function DonationDetailPage({ donationId }: { donationId: string }) {
  const [, navigate] = useHashLocation();
  const [syncing, setSyncing] = useState(false);

  const { data, loading, error, reload } = useData<{ donation: DonationRow }>(
    () => api(`/api/v1/admin/donations/${encodeURIComponent(donationId)}`),
    [donationId],
  );

  async function handleSync(sessionId: string) {
    setSyncing(true);
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
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  const d = data!.donation;
  const gross = fmtAmount(d.gross_amount, d.currency);
  const netCurrency = d.settled_currency ?? d.currency;
  const net = d.net_amount !== null ? fmtAmount(d.net_amount, netCurrency) : "—";
  const methodLabel = d.payment_method_type ? asyncPaymentWindow(d.payment_method_type).label : "—";
  const showSettled =
    d.settled_amount !== null &&
    d.settled_currency &&
    d.settled_currency.toLowerCase() !== d.currency.toLowerCase();
  const deadline =
    d.status === "awaiting_payment" && d.session_expires_at
      ? new Date(d.session_expires_at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : null;
  const needsSync =
    d.status === "pending" ||
    d.status === "awaiting_payment" ||
    (d.status === "completed" && (d.net_amount === null || d.payment_method_type === null));
  const badgeUrl = `/api/v1/og/donation/${encodeURIComponent(d.checkout_session_id)}?name=${encodeURIComponent(d.name)}`;

  return (
    <div>
      <button class="btn btn-sm btn-outline-secondary mb-3" onClick={() => navigate("/donations")}>
        ← Back to Donations
      </button>

      <div class="d-flex align-items-center gap-2 mb-3">
        <h5 class="mb-0">{d.name}</h5>
        <Badge status={d.status} />
        <span class="fw-semibold">{gross}</span>
      </div>

      <div class="adm-donation-detail">
        <div class="adm-donation-detail-grid">
          <Field label="Email"><a href={`mailto:${d.email}`}>{d.email}</a></Field>
          {d.organization && <Field label="Organization">{d.organization}</Field>}
          <Field label="Gross">
            {gross}
            {showSettled && <span class="text-muted"> ({fmtAmount(d.settled_amount!, d.settled_currency!)})</span>}
          </Field>
          <Field label="Net">{net}</Field>
          <Field label="Method">
            {methodLabel}
            {deadline && <span class="text-muted"> (due {deadline})</span>}
          </Field>
          <Field label="Source">{d.source ?? "—"}</Field>
          <Field label="Session ID"><span class="mono small">{d.checkout_session_id}</span></Field>
          {d.payment_intent_id && <Field label="Payment Intent"><span class="mono small">{d.payment_intent_id}</span></Field>}
          <Field label="Created">{fmt(d.created_at)}</Field>
          <Field label="Completed">{fmt(d.completed_at)}</Field>
        </div>

        <div class="d-flex gap-2 mt-3">
          {needsSync && (
            <button
              class="btn btn-sm btn-outline-primary"
              disabled={syncing}
              onClick={() => handleSync(d.checkout_session_id)}
            >
              {syncing ? "Syncing…" : "↺ Sync with Stripe"}
            </button>
          )}
          {d.status === "completed" && (
            <a
              class="btn btn-sm btn-outline-secondary"
              href={badgeUrl}
              download={`${d.name.replace(/[^\w\s-]/g, "")}-donation-badge.jpeg`}
            >
              Download Badge
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
