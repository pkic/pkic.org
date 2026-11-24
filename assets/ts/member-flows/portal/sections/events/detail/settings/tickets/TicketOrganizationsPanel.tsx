/**
 * Organizations: which ticket each organization gets and who decided it.
 * Organizers test the classifier on any organization, save the right ticket,
 * or clear a decision so the classifier asks again at the next registration.
 */
import { useRef, useState } from "preact/hooks";
import { deleteJson } from "../../../../../../../shared/api-client";
import { successResponseSchema } from "../../../../../../../../shared/schemas/api-common";
import type { EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import {
  eventTicketOrganizationListSchema,
  TICKET_DECIDERS,
  type EventTicketOrganization,
  type TicketDecider,
} from "../../../../../../../../shared/schemas/event-ticket-organizations";
import { ApiDataTable, type ApiTableActions } from "../../../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../../../components/ConfirmDialog";
import type { CollectionLoader } from "../../../../../../../hooks/useServerCollection";
import { ButtonLink } from "../../../../../../../ui/Button";
import { EmptyState } from "../../../../../../../ui/EmptyState";
import { Panel, PanelHeader } from "../../../../../../../ui/Panel";
import { RowActions } from "../../../../../../../ui/RowActions";
import { toast } from "../../../../../ui";
import { TicketOrganizationDialog, type TicketOrganizationStart } from "./TicketOrganizationDialog";
import { ticketsEndpoint } from "./tickets-endpoint";

const DECIDER_LABELS: Record<TicketDecider, string> = { organizer: "Organizer", classifier: "Classifier" };
const DECIDED_BY_OPTIONS = [
  { value: "", label: "Anyone" },
  ...TICKET_DECIDERS.map((decider) => ({ value: decider, label: DECIDER_LABELS[decider] })),
];

function decidedBy(row: EventTicketOrganization): string {
  if (!row.decidedBy) return "";
  return row.decidedBy === "organizer" ? "Organizer" : `Classifier, ${String(row.confidencePercent ?? 0)}% sure`;
}

export function TicketOrganizationsPanel({
  slug,
  configuration,
  onChanged,
  loadOrganizations,
  ticketKey,
  workbenchHref,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  /** Lists only the organizations that get this ticket, on the ticket's own page. */
  ticketKey?: string;
  /** The page that lists every portal organization, to test and decide many at once. */
  workbenchHref?: string;
  /** Told after a decision is saved or cleared, so the tickets' counts follow. */
  onChanged: () => Promise<void>;
  /** Replaces the request for the organizations, where there is no server to ask. */
  loadOrganizations?: CollectionLoader;
}) {
  const table = useRef<ApiTableActions | null>(null);
  const [start, setStart] = useState<TicketOrganizationStart | null>(null);
  const tickets = configuration.types.filter((type) => type.active);
  // The classifier chooses between tickets that describe who qualifies, so it needs two.
  const classifierOn = tickets.filter((type) => type.classifierDescription).length >= 2;
  const nameOf = (key: string) => configuration.types.find((type) => type.key === key)?.name ?? key;
  const endpoint = `${ticketsEndpoint(slug)}/organizations`;

  async function changed(message: string) {
    await table.current?.reload();
    await onChanged();
    toast(message, "success");
  }

  async function clear(row: EventTicketOrganization) {
    if (!row.id) return;
    const confirmed = await confirmAction({
      title: `Clear the decision for ${row.organizationName}?`,
      body: "The next person who registers from this organization gets the classifier's answer again. Other events that offer this ticket share the decision.",
      confirmLabel: "Clear decision",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteJson(`${endpoint}/decisions/${encodeURIComponent(row.id)}`, successResponseSchema);
      await changed("Decision cleared.");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The decision could not be cleared. Try again.", "error");
    }
  }

  const reopen = (row: EventTicketOrganization, testOnOpen: boolean) =>
    setStart({
      organizationName: row.organizationName,
      emailDomain: row.emailDomain,
      ticketKey: row.ticketKey ?? undefined,
      testOnOpen,
    });
  return (
    <Panel aria-label="Organizations">
      <PanelHeader title="Organizations">
        {workbenchHref && <ButtonLink href={workbenchHref}>Find organizations</ButtonLink>}
      </PanelHeader>
      <ApiDataTable
        urlState="ticket-organizations"
        endpoint={endpoint}
        params={ticketKey ? { ticketKey } : undefined}
        responseSchema={eventTicketOrganizationListSchema}
        resolve={(value) => value.organizations}
        resolvePage={(value) => value.page}
        load={loadOrganizations}
        actionsRef={table}
        caption="Organizations"
        paginate
        searchPlaceholder="Search organizations or email domains…"
        initialSort="-updated"
        createAction={{
          label: classifierOn ? "Test an organization" : "Choose an organization's ticket",
          onSelect: () => setStart({ organizationName: "", emailDomain: "" }),
        }}
        rowKey={(row) => row.id ?? row.organizationId ?? row.organizationName}
        empty={
          <EmptyState
            title={ticketKey ? "No organization gets this ticket yet" : "No organizations decided yet"}
            body="When someone registers, the classifier decides their organization's ticket if it is sure enough. Test an organization to see what it gives."
          />
        }
        columns={[
          {
            header: "Organization",
            hideable: false,
            sort: { asc: "organization", desc: "-organization" },
            cell: (row) => (
              <>
                <strong>{row.organizationName}</strong>
                {row.emailDomain && <div class="pk-small pk-muted">{row.emailDomain}</div>}
              </>
            ),
          },
          ...(ticketKey
            ? []
            : [
                {
                  header: "Ticket",
                  width: "fit" as const,
                  cell: (row: EventTicketOrganization) => (row.ticketKey ? nameOf(row.ticketKey) : ""),
                },
              ]),
          {
            header: "Decided by",
            width: "fit",
            filter: { param: "decidedBy", options: DECIDED_BY_OPTIONS },
            cell: decidedBy,
          },
          {
            // No header: the table names the actions column itself.
            header: "",
            hideable: false,
            width: "fit",
            cell: (row) => (
              <RowActions
                subject={row.organizationName}
                actions={[
                  ...(classifierOn ? [{ id: "test", label: "Test again", onSelect: () => reopen(row, true) }] : []),
                  { id: "change", label: "Change ticket…", onSelect: () => reopen(row, false) },
                  { id: "clear", label: "Clear decision", onSelect: () => void clear(row) },
                ]}
              />
            ),
          },
        ]}
      />
      {start && (
        <TicketOrganizationDialog
          slug={slug}
          tickets={tickets}
          classifierOn={classifierOn}
          start={start}
          onClose={() => setStart(null)}
          onSaved={async (ticketName) => {
            // A save that finishes after this dialog closed leaves a newer one open.
            const opened = start;
            setStart((current) => (current === opened ? null : current));
            await changed(`${ticketName} saved for this organization.`);
          }}
        />
      )}
    </Panel>
  );
}
