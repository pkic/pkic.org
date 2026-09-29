/**
 * Share links — who is promoting the donation page, and what their links
 * brought in.
 *
 * Its own page under Donations rather than a tab above the donation list
 * (#43): it answers a question about promoters, not about donations, and the
 * two lists were competing for the same screen.
 *
 * Seven ranked measures per promoter are tabular data, so this is a DataTable:
 * one caption instead of N unnamed card regions, column headers instead of a
 * `lbl` div, and columns that line up so the numbers can be compared down the
 * list. The rank tiers used to signal with colour alone; the rank number and
 * the column header carry it instead.
 */
import { useState } from "preact/hooks";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import type { z } from "zod";
import { Alert } from "../../../../ui/Alert";
import { Badge } from "../../../../ui/Badge";
import { type Column } from "../../../../components/Table";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";
import {
  donationPromotersListResponseSchema,
  type DonationPromoter as PromoterRow,
} from "../../../../../shared/schemas/donation-management";
import { formatDonationAmount } from "./model";
// `pk-mono` lives in Content.css, which ships in a lazy chunk: a surface that
// writes the class name has to import the stylesheet itself, or the share-link
// code renders in the body face once the page stops loading Bootstrap.
import "../../../../ui/Content.css";

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

const PROMOTER_COLUMNS: Array<Column<RankedPromoterRow>> = [
  {
    header: "Rank",
    className: "pk-end",
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
  { header: "Own donation", className: "pk-end", width: "fit", cell: (row) => ownAmount(row) },
  { header: "Link clicks", className: "pk-end", width: "fit", cell: (row) => row.clicks },
  {
    header: "Referred donors",
    className: "pk-end",
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
    header: "Referred amount",
    className: "pk-end",
    width: "fit",
    cell: (row) => referredAmount(row),
  },
  {
    header: "Total impact",
    className: "pk-end",
    width: "fit",
    cell: (row) => <span class="pk-strong">{totalImpact(row)}</span>,
  },
];

export function DonationShareLinks({ canRead = true }: { canRead?: boolean }) {
  if (!canRead) {
    return (
      <div class="pk pk-stack">
        <PageHeader title="Share links" />
        <Alert tone="warn">
          Promoter records require the <code class="pk-mono">donations:read</code> permission.
        </Alert>
      </div>
    );
  }
  return <ShareLinksView />;
}

function ShareLinksView() {
  const [data, setData] = useState<z.infer<typeof donationPromotersListResponseSchema> | null>(null);
  const summary = data?.summary;
  return (
    <div class="pk pk-stack">
      <PageHeader title="Share links" />
      {summary && summary.promoterCount > 0 && (
        <div class="pk-stat-row">
          <StatCard label="Share links" value={String(summary.promoterCount)} />
          <StatCard label="Own donations" value={formatDonationAmount(summary.totalOwnGrossUsd, "usd")} />
          <StatCard label="Link clicks" value={String(summary.totalClicks)} />
          <StatCard label="Referred donors" value={String(summary.totalAttributedCompleted)} />
          <StatCard label="Referred amount" value={formatDonationAmount(summary.totalAttributedGrossUsd, "usd")} />
        </div>
      )}

      <Panel>
        <PanelHeader title="Promoter leaderboard" headingLevel={2} />
        <ApiDataTable
          caption="Promoter share links, ranked by total impact"
          endpoint="/api/v1/donations/promoters"
          responseSchema={donationPromotersListResponseSchema}
          resolve={(response) =>
            response.promoters.map((promoter, index) => ({ ...promoter, rank: response.page.offset + index + 1 }))
          }
          resolvePage={(response) => response.page}
          onData={setData}
          paginate
          initialSort="-impact"
          columns={PROMOTER_COLUMNS}
          rowKey={(row) => row.code}
          empty="No promoter links found"
        />
      </Panel>
    </div>
  );
}
