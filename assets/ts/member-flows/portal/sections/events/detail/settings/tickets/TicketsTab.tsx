/**
 * Settings → Registration → Tickets: what registering costs, who gets which
 * ticket, the codes that change that, and how payment is chased. Editing
 * prices or one ticket opens its own page under this tab.
 */
import { useRef } from "preact/hooks";
import { getJson } from "../../../../../../../shared/api-client";
import {
  eventTicketsConfigurationSchema,
  type EventTicketsConfiguration,
} from "../../../../../../../../shared/schemas/event-tickets";
import { formatTicketAmount, formatTicketMoney } from "../../../../../../../../shared/event-ticket-display";
import { formatCalendarDate } from "../../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../../shared/format-number";
import type { ApiTableActions } from "../../../../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../../components/Spinner";
import { TicketPriceTable } from "../../../../../../../components/events/tickets/TicketPriceTable";
import { useData } from "../../../../../../../hooks/useData";
import { ButtonLink } from "../../../../../../../ui/Button";
import { DataTable } from "../../../../../../../ui/DataTable";
import { EmptyState } from "../../../../../../../ui/EmptyState";
import { Menu } from "../../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { StatCard } from "../../../../../../../ui/StatCard";
import { formatZoneCity } from "../../../../../../../../shared/format-date";
import { usePortalHashLocation } from "../../../../../hash-location";
import { SponsorPassesEditor } from "./SponsorPassesEditor";
import { SponsorPassesPanel } from "./SponsorPassesPanel";
import { TicketCodesPanel } from "./TicketCodesPanel";
import { TicketPaymentPanel } from "./TicketPaymentPanel";
import { TicketPricesEditor } from "./TicketPricesEditor";
import { TicketStepTextsPanel } from "./TicketStepTextsPanel";
import { TicketTypeEditor } from "./TicketTypeEditor";
import { sortedPeriods, ticketPriceGrid } from "./ticket-price-grid";
import { ticketsEndpoint } from "./tickets-endpoint";

/** The segment below the tab where sponsor passes are edited. */
const SPONSOR_PASSES_SEGMENT = "sponsor-passes";

type TicketType = EventTicketsConfiguration["types"][number];

function givenTo(type: TicketType): string {
  if (type.presetOrganizations > 0)
    return `${formatNumber(type.presetOrganizations)} ${type.presetOrganizations === 1 ? "organization" : "organizations"} decided`;
  if (type.isDefault) return "Everyone else";
  return type.classifierDescription ? "Organizations that match" : "People with a code";
}

export function TicketsTab({
  slug,
  canWrite,
  detail,
  basePath,
}: {
  slug: string;
  canWrite: boolean;
  /** The tab's own route, when it is not the event's own settings: a group's event workspace. */
  basePath?: string;
  /** The segment below the tab: `prices`, `sponsor-passes`, `new`, or a ticket's id. */
  detail?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const codes = useRef<ApiTableActions | null>(null);
  const base = basePath ?? `/events/${slug}/settings/tickets`;
  const { data, loading, error, reload } = useData(
    () => getJson(ticketsEndpoint(slug), eventTicketsConfigurationSchema),
    [slug],
  );
  if (loading && !data) return <Spinner label="Loading tickets…" />;
  if (error || !data) return <ErrorAlert error={error ?? "The tickets could not be loaded."} />;
  const done = async () => {
    await reload();
    navigate(base);
  };
  if (canWrite && detail === "prices")
    return <TicketPricesEditor slug={slug} configuration={data} onSaved={done} onCancel={() => navigate(base)} />;
  if (canWrite && detail === SPONSOR_PASSES_SEGMENT)
    return <SponsorPassesEditor slug={slug} configuration={data} onSaved={done} onCancel={() => navigate(base)} />;
  if (canWrite && detail) {
    const type = data.types.find((candidate) => candidate.id === detail);
    if (detail === "new" || type)
      return (
        <TicketTypeEditor
          slug={slug}
          revision={data.revision}
          type={type}
          firstTicket={data.types.length === 0}
          onSaved={done}
          onCancel={() => navigate(base)}
        />
      );
  }
  const { currency } = data.settings;
  const grid = ticketPriceGrid(data);
  const next = sortedPeriods(data.periods).find(
    (period) =>
      period.startsOn !== null &&
      period.startsOn > (data.periods.find((current) => current.id === data.currentPeriodId)?.startsOn ?? ""),
  );
  if (data.types.length === 0)
    return (
      <Panel aria-label="Tickets">
        <PanelBody>
          <EmptyState
            title="This event has no tickets"
            body="Registration is free for everyone until you add a ticket with a price."
          >
            {canWrite && (
              <ButtonLink variant="primary" href={usePortalHashLocation.hrefs(`${base}/new`)}>
                Add ticket
              </ButtonLink>
            )}
          </EmptyState>
        </PanelBody>
      </Panel>
    );
  return (
    <div class="pk-stack">
      <div class="pk-stat-row">
        <StatCard
          label="Collected"
          value={formatTicketMoney(data.totals.collected, currency)}
          note={`${formatNumber(data.totals.paidCount)} paid`}
        />
        <StatCard
          label="Awaiting payment"
          value={formatNumber(data.totals.awaitingCount)}
          note={
            data.totals.awaitingCount ? `${formatTicketAmount(data.totals.awaitingAmount, currency)} open` : undefined
          }
          tone={data.totals.awaitingCount ? "warn" : undefined}
        />
        <StatCard label="Free tickets" value={formatNumber(data.totals.freeCount)} />
        <StatCard label="Next price change" value={next?.startsOn ? formatCalendarDate(next.startsOn) : "None"} />
      </div>
      <Panel aria-label="Prices">
        <PanelHeader
          title="Prices"
          menu={
            canWrite ? (
              <Menu
                label="Price actions"
                align="end"
                items={[{ id: "edit", label: "Edit prices", href: usePortalHashLocation.hrefs(`${base}/prices`) }]}
              />
            ) : undefined
          }
        />
        <PanelBody flush>
          <TicketPriceTable periods={grid.periods} groups={grid.groups} />
        </PanelBody>
        <PanelBody>
          <p class="pk-small pk-muted">
            Prices are in {currency.toUpperCase()}. Each change starts at midnight in {formatZoneCity(data.timeZone)} (
            {data.timeZone}).
          </p>
        </PanelBody>
      </Panel>
      <Panel aria-label="Tickets">
        <PanelHeader title="Tickets">
          {canWrite && (
            <ButtonLink variant="primary" href={usePortalHashLocation.hrefs(`${base}/new`)}>
              Add ticket
            </ButtonLink>
          )}
        </PanelHeader>
        <PanelBody flush>
          <DataTable<TicketType>
            caption="Tickets"
            rows={data.types}
            rowKey={(row) => row.id}
            rowAction={
              canWrite
                ? (row) => ({ label: `Edit ${row.name}`, href: usePortalHashLocation.hrefs(`${base}/${row.id}`) })
                : undefined
            }
            columns={[
              {
                id: "name",
                header: "Ticket",
                cell: (row) => (
                  <>
                    <strong>{row.name}</strong>
                    <div class="pk-small pk-muted">
                      {row.key}
                      {row.active ? "" : " · Not offered"}
                    </div>
                  </>
                ),
              },
              { id: "given", header: "Given to", cell: givenTo },
              {
                id: "registered",
                header: "Registered",
                width: "fit",
                align: "end",
                cell: (row) => formatNumber(row.registered),
              },
              { id: "paid", header: "Paid", width: "fit", align: "end", cell: (row) => formatNumber(row.paid) },
              {
                id: "awaiting",
                header: "Awaiting payment",
                width: "fit",
                align: "end",
                cell: (row) => formatNumber(row.awaitingPayment),
              },
            ]}
          />
        </PanelBody>
      </Panel>
      <SponsorPassesPanel
        slug={slug}
        configuration={data}
        canWrite={canWrite}
        editHref={usePortalHashLocation.hrefs(`${base}/${SPONSOR_PASSES_SEGMENT}`)}
        onChanged={async () => {
          await reload();
          await codes.current?.reload();
        }}
      />
      <TicketCodesPanel slug={slug} configuration={data} canWrite={canWrite} table={codes} />
      <TicketStepTextsPanel slug={slug} configuration={data} canWrite={canWrite} onSaved={reload} />
      <TicketPaymentPanel slug={slug} configuration={data} canWrite={canWrite} onSaved={reload} />
    </div>
  );
}
