import { useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { getJson, postJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";
import { useData } from "../../../../hooks/useData";
import { asyncPaymentWindow } from "../../../../../shared/constants/async-payment-window";
import { formatDonationAmount } from "./model";
import {
  donationDetailResponseSchema,
  donationSyncResponseSchema,
} from "../../../../../shared/schemas/donation-management";

function Field({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <div class="lbl">{label}</div>
      <div class="val">{children}</div>
    </div>
  );
}

export function DonationDetailPage({
  donationId,
  canRead = true,
  canSync = true,
}: {
  donationId: string;
  canRead?: boolean;
  canSync?: boolean;
}) {
  if (!canRead) {
    return (
      <div class="alert alert-warning" role="alert">
        Donation records require the <code>donations:read</code> permission.
      </div>
    );
  }
  return <DonationDetailView donationId={donationId} canSync={canSync} />;
}

function DonationDetailView({ donationId, canSync }: { donationId: string; canSync: boolean }) {
  const [, navigate] = useHashLocation();
  const [syncing, setSyncing] = useState(false);

  const { data, loading, error, reload } = useData(
    () => getJson(`/api/v1/donations/${encodeURIComponent(donationId)}`, donationDetailResponseSchema),
    [donationId],
  );

  async function handleSync(sessionId: string) {
    setSyncing(true);
    try {
      const res = await postJson("/api/v1/donations/sync", { sessionIds: [sessionId] }, donationSyncResponseSchema);
      const result = res.results[0];
      if (result?.outcome === "completed") toast("Donation marked as completed.", "success");
      else if (result?.outcome === "awaiting_payment") toast("Payment initiated — awaiting bank settlement.", "info");
      else if (result?.outcome === "expired") toast("Session expired — donation marked expired.", "info");
      else if (result?.outcome === "failed") toast("Payment failed — bank declined or bounced.", "error");
      else if (result?.outcome === "still_pending") toast("Session still pending on Stripe.", "info");
      else toast(result?.error ?? "Sync failed.", "error");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  const d = data!.donation;
  const gross = formatDonationAmount(d.gross_amount, d.currency);
  const netCurrency = d.settled_currency ?? d.currency;
  const net = d.net_amount !== null ? formatDonationAmount(d.net_amount, netCurrency) : "—";
  const methodLabel = d.payment_method_type ? asyncPaymentWindow(d.payment_method_type).label : "—";
  const showSettled =
    d.settled_amount !== null && d.settled_currency && d.settled_currency.toLowerCase() !== d.currency.toLowerCase();
  const deadline =
    d.status === "awaiting_payment" && d.session_expires_at
      ? new Date(d.session_expires_at * 1000).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;
  const needsSync =
    d.status === "pending" ||
    d.status === "awaiting_payment" ||
    (d.status === "completed" && (d.net_amount === null || d.payment_method_type === null));
  const badgeUrl = `/api/v1/donations/checkouts/${encodeURIComponent(d.checkout_session_id)}/badge?name=${encodeURIComponent(d.name)}`;

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
          <Field label="Email">
            <a href={`mailto:${d.email}`}>{d.email}</a>
          </Field>
          {d.organization && <Field label="Organization">{d.organization}</Field>}
          <Field label="Gross">
            {gross}
            {showSettled && (
              <span class="text-muted"> ({formatDonationAmount(d.settled_amount!, d.settled_currency!)})</span>
            )}
          </Field>
          <Field label="Net">{net}</Field>
          <Field label="Method">
            {methodLabel}
            {deadline && <span class="text-muted"> (due {deadline})</span>}
          </Field>
          <Field label="Source">{d.source ?? "—"}</Field>
          <Field label="Session ID">
            <span class="mono small">{d.checkout_session_id}</span>
          </Field>
          {d.payment_intent_id && (
            <Field label="Payment Intent">
              <span class="mono small">{d.payment_intent_id}</span>
            </Field>
          )}
          <Field label="Created">{fmt(d.created_at)}</Field>
          <Field label="Completed">{fmt(d.completed_at)}</Field>
        </div>

        <div class="d-flex gap-2 mt-3">
          {canSync && needsSync && (
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
