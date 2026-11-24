/**
 * Every organization in the portal, with the ticket it gets now. Organizers
 * pick organizations by name or domain, test them against this event's
 * tickets in batches, and save the answers as their own decisions, one row or
 * all checked rows at once. A test stores nothing; only Save does.
 */
import { useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { postJson } from "../../../../../../../shared/api-client";
import { successResponseSchema } from "../../../../../../../../shared/schemas/api-common";
import type { EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import {
  eventTicketOrganizationListSchema,
  eventTicketOrganizationTrialResponseSchema,
  TICKET_DECISIONS_MAX,
  TICKET_TRIAL_MAX_ORGANIZATIONS,
  type EventTicketOrganization,
  type EventTicketOrganizationTrialResult,
} from "../../../../../../../../shared/schemas/event-ticket-organizations";
import { ApiDataTable, type ApiTableActions } from "../../../../../../../components/ApiDataTable";
import type { CollectionLoader } from "../../../../../../../hooks/useServerCollection";
import { BulkBar } from "../../../../../../../ui/BulkBar";
import { Button } from "../../../../../../../ui/Button";
import { EmptyState } from "../../../../../../../ui/EmptyState";
import { Panel, PanelHeader } from "../../../../../../../ui/Panel";
import { RowActions } from "../../../../../../../ui/RowActions";
import { toast } from "../../../../../ui";
import { TicketOrganizationDialog, type TicketOrganizationStart } from "./TicketOrganizationDialog";
import { ticketsEndpoint } from "./tickets-endpoint";

type Row = EventTicketOrganization;
type EventTicketOrganizationList = z.infer<typeof eventTicketOrganizationListSchema>;

const keyOf = (row: Row) => row.organizationId;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export function TicketOrganizationsWorkbench({
  slug,
  configuration,
  onChanged,
  loadOrganizations,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  /** Told after decisions are saved, so the tickets' counts follow. */
  onChanged: () => Promise<void>;
  /** Replaces the request for the organizations, where there is no server to ask. */
  loadOrganizations?: CollectionLoader;
}) {
  const table = useRef<ApiTableActions | null>(null);
  const [shown, setShown] = useState<EventTicketOrganizationList | null>(null);
  // The rows behind the checked boxes, kept while the reader pages through the list.
  const checkedRows = useRef(new Map<string, Row>());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [results, setResults] = useState<ReadonlyMap<string, EventTicketOrganizationTrialResult>>(new Map());
  const [busy, setBusy] = useState<"testing" | "saving" | null>(null);
  const [progress, setProgress] = useState("");
  const [start, setStart] = useState<TicketOrganizationStart | null>(null);
  const tickets = configuration.types.filter((type) => type.active);
  const classifierOn = tickets.filter((type) => type.classifierDescription).length >= 2;
  const nameOf = (key: string) => configuration.types.find((type) => type.key === key)?.name ?? key;
  const endpoint = `${ticketsEndpoint(slug)}/organizations`;
  const overCap = selected.size > TICKET_DECISIONS_MAX;

  function select(next: ReadonlySet<string>) {
    for (const row of shown?.organizations ?? []) {
      const key = keyOf(row);
      if (next.has(key)) checkedRows.current.set(key, row);
    }
    for (const key of [...checkedRows.current.keys()]) if (!next.has(key)) checkedRows.current.delete(key);
    setSelected(next);
  }

  async function test(rows: readonly Row[]) {
    if (busy || rows.length === 0) return;
    setBusy("testing");
    let answered = 0;
    try {
      for (const batch of chunks(rows, TICKET_TRIAL_MAX_ORGANIZATIONS)) {
        setProgress(`Testing ${String(answered + 1)}–${String(answered + batch.length)} of ${String(rows.length)}…`);
        const response = await postJson(
          `${endpoint}/trials`,
          {
            organizations: batch.map((row) => ({ organizationId: row.organizationId })),
          },
          eventTicketOrganizationTrialResponseSchema,
        );
        setResults((current) => {
          const next = new Map(current);
          response.results.forEach((result, index) => next.set(keyOf(batch[index]!), result));
          return next;
        });
        answered += batch.length;
      }
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The test did not finish. Try again.", "error");
    } finally {
      setProgress("");
      setBusy(null);
    }
  }

  async function save(rows: readonly Row[]) {
    if (busy) return;
    const decisions = rows.flatMap((row) => {
      const ticketKey = results.get(keyOf(row))?.decidedTicketKey;
      return ticketKey && ticketKey !== row.ticketKey ? [{ organizationId: row.organizationId, ticketKey }] : [];
    });
    if (decisions.length === 0) return toast("No test answer to save. Test the organizations first.", "error");
    setBusy("saving");
    try {
      await postJson(`${endpoint}/decisions`, { decisions }, successResponseSchema);
      select(new Set());
      await table.current?.reload();
      await onChanged();
      toast(
        decisions.length === 1
          ? "Ticket saved for 1 organization."
          : `Tickets saved for ${String(decisions.length)} organizations.`,
        "success",
      );
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The tickets could not be saved. Try again.", "error");
    } finally {
      setBusy(null);
    }
  }

  function testAnswer(row: Row) {
    const result = results.get(keyOf(row));
    if (!result) return "";
    if (result.error === "not_found") return <span class="pk-muted">No longer in the portal</span>;
    if (result.error || !result.answers) return <span class="pk-muted">No answer. Test again.</span>;
    const top = result.answers[0];
    if (result.decidedTicketKey) {
      const decided = result.answers.find((answer) => answer.ticketKey === result.decidedTicketKey);
      return `${nameOf(result.decidedTicketKey)}, ${String(decided?.percent ?? 0)}% sure`;
    }
    return (
      <span class="pk-muted">Not sure enough{top ? `: ${nameOf(top.ticketKey)}, ${String(top.percent)}%` : ""}</span>
    );
  }

  const checked = () => [...checkedRows.current.values()];
  return (
    <Panel aria-label="Organizations in the portal">
      <PanelHeader title="Organizations in the portal" breadcrumb />
      {progress && (
        <p aria-live="polite" class="pk-small pk-muted">
          {progress}
        </p>
      )}
      <ApiDataTable
        urlState="ticket-workbench"
        endpoint={endpoint}
        params={{ among: "portal" }}
        responseSchema={eventTicketOrganizationListSchema}
        resolve={(value) => value.organizations}
        resolvePage={(value) => value.page}
        load={loadOrganizations}
        onData={setShown}
        onQueryChange={() => select(new Set())}
        actionsRef={table}
        caption="Organizations in the portal"
        paginate
        initialPageSize={25}
        searchPlaceholder="Search organization names or domains…"
        initialSort="organization"
        rowKey={keyOf}
        selection={{
          selected,
          onChange: select,
          rowLabel: (key) => shown?.organizations.find((row) => keyOf(row) === key)?.organizationName ?? key,
          disabled: busy !== null,
        }}
        bulkBar={
          <BulkBar count={selected.size} total={shown?.page.total ?? selected.size} onClear={() => select(new Set())}>
            {overCap && <span class="pk-small">Choose up to {TICKET_DECISIONS_MAX} organizations at a time.</span>}
            {classifierOn && (
              <Button
                variant="secondary"
                loading={busy === "testing"}
                disabled={busy !== null || overCap}
                onClick={() => void test(checked())}
              >
                Test selected
              </Button>
            )}
            <Button
              variant="primary"
              loading={busy === "saving"}
              disabled={busy !== null || overCap || !checked().some((row) => results.get(keyOf(row))?.decidedTicketKey)}
              onClick={() => void save(checked())}
            >
              Save test answers
            </Button>
          </BulkBar>
        }
        empty={
          <EmptyState
            title="No organizations found"
            body="Search by another part of the name, or by a domain such as example.com."
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
                {row.domains.length > 0 && <div class="pk-small pk-muted">{row.domains.join(", ")}</div>}
              </>
            ),
          },
          {
            header: "Ticket now",
            cell: (row) =>
              row.ticketKey ? (
                <>
                  {nameOf(row.ticketKey)}
                  <div class="pk-small pk-muted">
                    {row.decidedBy === "organizer"
                      ? "Organizer"
                      : `Classifier, ${String(row.confidencePercent ?? 0)}% sure`}
                  </div>
                </>
              ) : (
                <span class="pk-muted">Not decided</span>
              ),
          },
          ...(classifierOn ? [{ header: "Test answer", cell: testAnswer }] : []),
          {
            // No header: the table names the actions column itself.
            header: "",
            hideable: false,
            width: "fit",
            cell: (row) => {
              const proposal = results.get(keyOf(row))?.decidedTicketKey;
              return (
                <RowActions
                  subject={row.organizationName}
                  actions={[
                    ...(classifierOn
                      ? [{ id: "test", label: "Test", disabled: busy !== null, onSelect: () => void test([row]) }]
                      : []),
                    ...(proposal && proposal !== row.ticketKey
                      ? [
                          {
                            id: "save",
                            label: `Save ${nameOf(proposal)}`,
                            disabled: busy !== null,
                            onSelect: () => void save([row]),
                          },
                        ]
                      : []),
                    {
                      id: "change",
                      label: "Choose ticket…",
                      onSelect: () =>
                        setStart({
                          organizationId: row.organizationId,
                          organizationName: row.organizationName,
                          domains: row.domains,
                          ticketKey: row.ticketKey ?? undefined,
                        }),
                    },
                  ]}
                />
              );
            },
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
            const opened = start;
            setStart((current) => (current === opened ? null : current));
            await table.current?.reload();
            await onChanged();
            toast(`${ticketName} saved for this organization.`, "success");
          }}
        />
      )}
    </Panel>
  );
}
