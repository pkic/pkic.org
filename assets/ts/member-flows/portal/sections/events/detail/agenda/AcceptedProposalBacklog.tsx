import { AgendaSession } from "../../../../../../site/AgendaSession";
import { Menu } from "../../../../../../ui/Menu";
import { proposalAgendaContent } from "../../../../../../../shared/proposal-agenda-content";
import "../../../../../../site/ContentAgenda.css";
import "./AgendaSourceCards.css";
import { acceptedProposalIds } from "./accepted-proposal-batches";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useState } from "preact/hooks";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { RowActions } from "../../../../../../ui/RowActions";
import { Panel, PanelBody } from "../../../../../../ui/Panel";
import { getJson } from "../../../../../../shared/api-client";
import { buildServerCollectionUrl, type CollectionLoader } from "../../../../../../hooks/useServerCollection";
import {
  eventProposalsListQuerySchema,
  eventProposalsResponseSchema,
} from "../../../../../../../shared/schemas/event-proposals";

/** This catalogue stays accepted-only even when an old URL carries a different status filter. */
const loadAccepted: CollectionLoader = (url, signal, schema) => {
  const source = new URL(url, "https://pkic.org");
  const query = eventProposalsListQuerySchema.parse({
    ...Object.fromEntries(source.searchParams),
    status: "accepted",
    agenda: "unimported",
  });
  const params = Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  return getJson(buildServerCollectionUrl(source.pathname, params), schema, { signal });
};

export function AcceptedProposalBacklog({
  eventSlug,
  onReview,
  onSelect,
  onDragEnd,
  onAdd,
  adding = false,
  addError = "",
  addProgress = "",
  interactionsDisabled = false,
  timeZone = "UTC",
}: {
  eventSlug: string;
  onReview: (proposalId: string) => void;
  onSelect?: (proposal: { id: string; title: string }, native?: boolean) => void;
  onDragEnd?: () => void;
  onAdd?: (proposalIds?: string[]) => void;
  adding?: boolean;
  addError?: string;
  addProgress?: string;
  interactionsDisabled?: boolean;
  timeZone?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controlsBusy = busy || adding;
  const [canRead, setCanRead] = useState(false);
  return (
    <Panel class="pk-agenda-source-panel" aria-label="Accepted proposals">
      <PanelBody flush>
        <ApiDataTable
          inset={
            addProgress || addError || error ? (
              <>
                {addProgress && <p role="status">{addProgress}</p>}
                {addError && <ErrorAlert error={addError} />}
                {error && <ErrorAlert error={error} />}
              </>
            ) : undefined
          }
          caption="Accepted proposals"
          endpoint={`/api/v1/events/${encodeURIComponent(eventSlug)}/proposals`}
          urlState="accepted-backlog"
          responseSchema={eventProposalsResponseSchema}
          load={loadAccepted}
          params={{ status: "accepted", agenda: "unimported" }}
          resolve={(response) => response.proposals}
          resolvePage={(response) => response.page}
          onData={(response) => {
            setCanRead(response.access.canRead);
          }}
          toolbar={(_, query, sorting) => (
            <Menu
              label="Accepted proposal actions"
              items={[
                ...(sorting
                  ? [
                      {
                        id: "title",
                        label: "Title A–Z",
                        checked: sorting.sort === "title",
                        onSelect: () => sorting.onSort("title"),
                      },
                      {
                        id: "-title",
                        label: "Title Z–A",
                        checked: sorting.sort === "-title",
                        onSelect: () => sorting.onSort("-title"),
                      },
                    ]
                  : []),
                ...(onAdd
                  ? [
                      {
                        id: "schedule-all",
                        label: "Place all matching in free slots",
                        disabled: controlsBusy || !canRead,
                        separatorBefore: true,
                        onSelect: async () => {
                          setBusy(true);
                          setError("");
                          try {
                            onAdd(await acceptedProposalIds(eventSlug, query));
                          } catch (error) {
                            setError(error instanceof Error ? error.message : "Could not read accepted proposals.");
                          } finally {
                            setBusy(false);
                          }
                        },
                      },
                    ]
                  : []),
              ]}
            />
          )}
          paginate
          initialSort="title"
          searchPlaceholder="Search proposals"
          rowKey={(proposal) => proposal.id}
          empty="No accepted proposals match this search. Proposals already on the agenda are not listed."
          columns={[]}
          renderItems={(proposals) => (
            <div class="pk-stack pk-agenda-source-cards" aria-label="Accepted proposal cards">
              {proposals.map((proposal) => (
                <div key={proposal.id} class="pk-agenda-source-cards__item" data-agenda-proposal={proposal.id}>
                  <AgendaSession
                    session={proposalAgendaContent(proposal)}
                    locations={[]}
                    timeZone={timeZone}
                    dialogId={`accepted-proposal-${proposal.id}`}
                    editor={{
                      controls: (
                        <div class="pk-cluster">
                          <RowActions
                            subject={proposal.title}
                            actions={[
                              ...(onSelect
                                ? [
                                    {
                                      id: "schedule",
                                      label: "Choose a calendar slot",
                                      disabled: controlsBusy || interactionsDisabled || !canRead,
                                      onSelect: () => onSelect(proposal),
                                    },
                                  ]
                                : []),
                              ...(onAdd
                                ? [
                                    {
                                      id: "import",
                                      label: "Place in next free slot",
                                      disabled: controlsBusy || !canRead,
                                      onSelect: () => onAdd([proposal.id]),
                                    },
                                  ]
                                : []),
                              {
                                id: "review",
                                label: "Review proposal",
                                disabled: controlsBusy || !canRead,
                                onSelect: () => onReview(proposal.id),
                              },
                            ]}
                          />
                        </div>
                      ),
                      onDragStart:
                        onSelect && canRead && !controlsBusy && !interactionsDisabled && !proposal.agendaImported
                          ? (event) => {
                              const card = event.currentTarget;
                              const bounds = card.getBoundingClientRect();
                              event.dataTransfer?.setData("application/x-pkic-accepted-proposal", proposal.id);
                              event.dataTransfer?.setDragImage(
                                card,
                                event.clientX - bounds.left,
                                event.clientY - bounds.top,
                              );
                              onSelect(proposal, true);
                            }
                          : undefined,
                      onDragEnd,
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        />
      </PanelBody>
    </Panel>
  );
}
