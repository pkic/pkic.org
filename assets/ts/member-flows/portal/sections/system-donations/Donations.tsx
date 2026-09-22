/**
 * Donations — the donation list, and the address that decides which of the
 * section's pages a reader is on.
 *
 * The section used to be one page wearing a tab strip: the donation list, the
 * promoter leaderboard, and the analytics all lived at `/donations`, and the
 * analytics itself stacked four tables down one scroll. The product owner
 * asked for the opposite arrangement (#43): the pages a reader chooses between
 * belong in the sidebar under Donations, where they can be seen without
 * opening the section first, and the several views of one subject belong in
 * tabs so the page keeps its overview. So the strip is gone, each page owns
 * its address, and `portal-navigation` lists them under the section.
 *
 * Migrated off Bootstrap onto the design system. The status filters were
 * `btn-outline-secondary` buttons carrying an `active` class, which said
 * "selected" to a sighted reader and nothing to anyone else; the filter is the
 * Status column's own menu now, and the choice in force is a checked radio
 * item.
 */
import { useState, useRef } from "preact/hooks";
import { Badge as StatusBadge } from "../../../../components/Badge";
import type { Column } from "../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Alert } from "../../../../ui/Alert";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { postJson } from "../../../../shared/api-client";
import { fmtDate, toast } from "../../ui";
import { asyncPaymentWindow } from "../../../../../shared/constants/async-payment-window";
import {
  donationSyncResponseSchema,
  donationsListResponseSchema,
  type DonationManagementListSummary,
} from "../../../../../shared/schemas/donation-management";
import { formatDonationAmount, type DonationRow } from "./model";
import { DonationAnalytics } from "./DonationAnalytics";
import { DonationShareLinks } from "./DonationShareLinks";
import { portalSession } from "../../state";
import { portalHasGlobalPermission } from "../../shell/portal-navigation";
// `pk-mono` lives in Content.css, which ships in a lazy chunk: a surface that
// writes the class name has to import the stylesheet itself, or the permission
// code renders in the body face once the page stops loading Bootstrap.
import "../../../../ui/Content.css";

const FILTERS = ["", "pending", "awaiting_payment", "completed", "expired", "failed"] as const;

/** The filter's own wording, so the button label is not derived from the wire value in the markup. */
function filterLabel(filter: (typeof FILTERS)[number]): string {
  if (filter === "") return "All";
  if (filter === "awaiting_payment") return "Awaiting";
  return filter.charAt(0).toUpperCase() + filter.slice(1);
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

/**
 * The section's pages, resolved from the address rather than from a tab in
 * component state, so every one of them can be linked to and reloaded.
 *
 * `pageSegment` is the segment after `/donations`; `view` is the one after
 * that, which only the analytics page uses to name the view it is showing.
 */
export function Donations({
  pageSegment,
  view,
  canRead = true,
  canSync = true,
}: {
  pageSegment?: string;
  view?: string;
  canRead?: boolean;
  canSync?: boolean;
}) {
  if (pageSegment === "promoters") return <DonationShareLinks canRead={canRead} />;
  if (pageSegment === "analytics") {
    // Reading the donations does not imply reading the analytics: the
    // measurement is its own permission, and the refusal says which one is
    // missing rather than quietly showing the list instead.
    return portalHasGlobalPermission(portalSession.value, "analytics:read") ? (
      <DonationAnalytics view={view} />
    ) : (
      <div class="pk pk-stack">
        <PageHeader title="Donation analytics" />
        <Alert tone="warn">
          Donation analytics require the <code class="pk-mono">analytics:read</code> permission.
        </Alert>
      </div>
    );
  }
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
  return <DonationList canSync={canSync} />;
}

function DonationList({ canSync }: { canSync: boolean }) {
  const [summary, setSummary] = useState<DonationManagementListSummary>({ byStatus: {}, backfillable: 0, syncable: 0 });
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
      <ApiDataTable
        caption="Donations"
        searchPlaceholder="Search donations…"
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
    </div>
  );
}
