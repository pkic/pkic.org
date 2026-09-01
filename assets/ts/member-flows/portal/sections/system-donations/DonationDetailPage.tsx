import { Fragment, type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { Badge } from "../../../../components/Badge";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody } from "../../../../ui/Panel";
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
// `pk-datalist` and `pk-mono` are written here as class names rather than
// reached through a component, so this module pulls their stylesheet into its
// own chunk. Without the import the record renders unstyled.
import "../../../../ui/Content.css";

/**
 * One term and its value inside the record's `pk-datalist`.
 *
 * The pair is emitted as a Fragment, not wrapped in a div: `pk-datalist` is a
 * two-column grid over `dl > dt` and `dl > dd`, and a wrapper between them
 * takes both out of the grid.
 */
function Detail({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <Fragment>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </Fragment>
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
      <div class="pk">
        <Alert tone="warn">
          Donation records require the <code>donations:read</code> permission.
        </Alert>
      </div>
    );
  }
  return <DonationDetailView donationId={donationId} canSync={canSync} />;
}

function DonationDetailView({ donationId, canSync }: { donationId: string; canSync: boolean }) {
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
    <div class="pk pk-stack">
      {/* The donor heads the page, with the donation's standing and amount
          beside the name and the record's commands on the right; the trail
          replaces the back button that used to stand in for it. */}
      <PageHeader
        trail={[{ label: "Donations", href: usePortalHashLocation.hrefs("/donations") }, { label: d.name }]}
        title={d.name}
        context={
          <>
            <Badge status={d.status} />
            <span class="pk-strong">{gross}</span>
          </>
        }
        actions={
          <>
            {canSync && needsSync && (
              <Button
                size="sm"
                variant="secondary"
                loading={syncing}
                disabled={syncing}
                onClick={() => handleSync(d.checkout_session_id)}
              >
                {syncing ? "Syncing…" : "Sync with Stripe"}
              </Button>
            )}
            {d.status === "completed" && (
              // A link, not a button: it fetches a file from a URL, so it can
              // be opened in a new tab and copied like any other address.
              <a
                class="pk-btn pk-btn--secondary pk-btn--sm"
                href={badgeUrl}
                download={`${d.name.replace(/[^\w\s-]/g, "")}-donation-badge.jpeg`}
              >
                Download badge
              </a>
            )}
          </>
        }
      />

      <Panel aria-label={`Donation from ${d.name}`}>
        <PanelBody class="pk-stack pk-stack--snug">
          <dl class="pk-datalist">
            <Detail label="Email">
              <a href={`mailto:${d.email}`}>{d.email}</a>
            </Detail>
            {d.organization && <Detail label="Organization">{d.organization}</Detail>}
            <Detail label="Gross">
              {gross}
              {showSettled && (
                <span class="pk-muted"> ({formatDonationAmount(d.settled_amount!, d.settled_currency!)})</span>
              )}
            </Detail>
            <Detail label="Net">{net}</Detail>
            <Detail label="Method">
              {methodLabel}
              {deadline && <span class="pk-muted"> (due {deadline})</span>}
            </Detail>
            <Detail label="Source">{d.source ?? "—"}</Detail>
            <Detail label="Session ID">
              <span class="pk-mono pk-small pk-break">{d.checkout_session_id}</span>
            </Detail>
            {d.payment_intent_id && (
              <Detail label="Payment intent">
                <span class="pk-mono pk-small pk-break">{d.payment_intent_id}</span>
              </Detail>
            )}
            <Detail label="Created">{fmt(d.created_at)}</Detail>
            <Detail label="Completed">{fmt(d.completed_at)}</Detail>
          </dl>
        </PanelBody>
      </Panel>
    </div>
  );
}
