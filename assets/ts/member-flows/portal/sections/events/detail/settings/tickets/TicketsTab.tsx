/**
 * Settings → Registration → Tickets, Codes and Payments: what registering
 * costs and who gets which ticket; the codes and sponsor passes that change
 * that; and how payment is chased. Each is its own tab over one configuration.
 * Prices, one ticket and the sponsor passes each open their own page under
 * their tab; a ticket opens to read first, with its editor below it.
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
import { TicketOrganizationsPanel } from "./TicketOrganizationsPanel";
import { TicketPaymentPanel } from "./TicketPaymentPanel";
import { TicketPricesEditor } from "./TicketPricesEditor";
import { TicketStepTextsPanel } from "./TicketStepTextsPanel";
import { TicketTypeEditor } from "./TicketTypeEditor";
import { TicketTypeView } from "./TicketTypeView";
import { sortedPeriods, ticketPriceGrid } from "./ticket-price-grid";
import { ticketsEndpoint } from "./tickets-endpoint";

/** The segment below the tab where sponsor passes are edited. */
const SPONSOR_PASSES_SEGMENT = "sponsor-passes";
/** The segment below a ticket's page where it is edited. */
const EDIT_SEGMENT = "edit";

type TicketType = EventTicketsConfiguration["types"][number];

/** The registration settings tabs this configuration fills. */
export type TicketSettingsSection = "tickets" | "codes" | "payments";

function givenTo(type: TicketType): string {
  if (type.presetOrganizations > 0)
    return `${formatNumber(type.presetOrganizations)} ${type.presetOrganizations === 1 ? "organization" : "organizations"} decided`;
  if (type.isDefault) return "Everyone else";
  return type.classifierDescription ? "Organizations that match" : "People with a code";
}

export function TicketsTab({
  slug,
  canWrite,
  section = "tickets",
  detail,
  segment,
  basePath,
}: {
  slug: string;
  canWrite: boolean;
  section?: TicketSettingsSection;
  /** The tab's own route, when it is not the event's own settings: a group's event workspace. */
  basePath?: string;
  /** The segment below the tab: `prices`, `new` or a ticket's id under Tickets; `sponsor-passes` under Codes. */
  detail?: string;
  /** The page below that segment: `edit` under a ticket. */
  segment?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const codes = useRef<ApiTableActions | null>(null);
  const base = basePath ?? `/events/${slug}/settings/${section}`;
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
  if (section === "codes")
    return canWrite && detail === SPONSOR_PASSES_SEGMENT ? (
      <SponsorPassesEditor slug={slug} configuration={data} onSaved={done} onCancel={() => navigate(base)} />
    ) : (
      <div class="pk-stack">
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
        {canWrite && <TicketCodesPanel slug={slug} configuration={data} canWrite={canWrite} table={codes} />}
      </div>
    );
  if (section === "payments")
    return <TicketPaymentPanel slug={slug} configuration={data} canWrite={canWrite} onSaved={reload} />;
  if (canWrite && detail === "prices")
    return <TicketPricesEditor slug={slug} configuration={data} onSaved={done} onCancel={() => navigate(base)} />;
  if (canWrite && detail === "new")
    return (
      <TicketTypeEditor
        slug={slug}
        revision={data.revision}
        tickets={data.types}
        onSaved={done}
        onCancel={() => navigate(base)}
      />
    );
  const type = detail ? data.types.find((candidate) => candidate.id === detail) : undefined;
  if (type) {
    const page = `${base}/${type.id}`;
    return canWrite && segment === EDIT_SEGMENT ? (
      <TicketTypeEditor
        slug={slug}
        revision={data.revision}
        type={type}
        tickets={data.types}
        onSaved={async () => {
          await reload();
          navigate(page);
        }}
        onCancel={() => navigate(page)}
      />
    ) : (
      <TicketTypeView
        slug={slug}
        configuration={data}
        type={type}
        editHref={canWrite ? usePortalHashLocation.hrefs(`${page}/${EDIT_SEGMENT}`) : undefined}
        onChanged={reload}
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
        {data.totals.underReviewCount > 0 && (
          <StatCard
            label="Payment under review"
            value={formatNumber(data.totals.underReviewCount)}
            note={`${formatTicketAmount(data.totals.underReviewAmount, currency)} under review`}
            tone="danger"
          />
        )}
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
            rowAction={(row) => ({
              label: `Open the ${row.name} ticket`,
              href: usePortalHashLocation.hrefs(`${base}/${row.id}`),
            })}
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
              {
                id: "under_review",
                header: "Under review",
                width: "fit",
                align: "end",
                cell: (row) => formatNumber(row.underReview),
              },
            ]}
          />
        </PanelBody>
      </Panel>
      {/* A decision chooses between tickets, so it needs two on offer. */}
      {canWrite && data.types.filter((type) => type.active).length >= 2 && (
        <TicketOrganizationsPanel slug={slug} configuration={data} onChanged={reload} />
      )}
      <TicketStepTextsPanel slug={slug} configuration={data} canWrite={canWrite} onSaved={reload} />
    </div>
  );
}
