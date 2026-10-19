import { AgendaSession } from "../../../../../../site/AgendaSession";
import { Menu } from "../../../../../../ui/Menu";
import { Badge as ToneBadge } from "../../../../../../ui/Badge";
import { Button } from "../../../../../../ui/Button";
import { pendingSpeakersLabel } from "../../../../../../../shared/proposal-speaker-acceptance";
import { proposalAgendaContent } from "../../../../../../../shared/proposal-agenda-content";
import { clockTimeZone, type ClockZone } from "../../../../../../../shared/event-clock";
import { formatClockInZone, formatDayList } from "../../../../../../../shared/format-date";
import { instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import "../../../../../../site/ContentAgenda.css";
import "../../../../../../ui/ButtonToggle.css";
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
  type EventProposalSummary,
} from "../../../../../../../shared/schemas/event-proposals";

/** Which accepted proposals the sources list: those still to place, or those already on the agenda. */
export type AcceptedProposalPlacement = "unplaced" | "placed";

const PLACEMENT_FILTERS = { unplaced: "unimported", placed: "imported" } as const;

/** This catalog stays accepted-only even when an old URL carries a different status filter. */
const loadAccepted: CollectionLoader = (url, signal, schema) => {
  const source = new URL(url, "https://pkic.org");
  const query = eventProposalsListQuerySchema.parse({
    ...Object.fromEntries(source.searchParams),
    status: "accepted",
    agenda: source.searchParams.get("agenda") === "imported" ? "imported" : "unimported",
  });
  const params = Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  return getJson(buildServerCollectionUrl(source.pathname, params), schema, { signal });
};

/** "Thu Dec 3 14:00 · Room B" on the event's clock, or where an unscheduled proposal waits. */
function placementLabel(proposal: EventProposalSummary, clock: ClockZone) {
  const placed = proposal.agendaPlacement;
  if (!placed) return "In unscheduled sessions";
  const date = instantToDateTimeLocal(placed.startAt, clockTimeZone(clock)).slice(0, 10);
  return [`${formatDayList([date])} ${formatClockInZone(placed.startAt, clock)}`, placed.roomName]
    .filter(Boolean)
    .join(" · ");
}

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
  placement = "unplaced",
  onPlacementChange,
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
  timeZone?: ClockZone;
  placement?: AcceptedProposalPlacement;
  onPlacementChange?: (placement: AcceptedProposalPlacement) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controlsBusy = busy || adding;
  const [canRead, setCanRead] = useState(false);
  const placing = placement === "unplaced";
  return (
    <Panel class="pk-agenda-source-panel" aria-label="Accepted proposals">
      <PanelBody flush>
        {onPlacementChange && (
          <div class="pk-agenda-source-panel__placement">
            <div class="pk-segmented" role="group" aria-label="Accepted proposals to show">
              {(
                [
                  ["unplaced", "Not yet placed"],
                  ["placed", "Placed"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  aria-pressed={placement === value ? "true" : "false"}
                  onClick={() => onPlacementChange(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        )}
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
          params={{ status: "accepted", agenda: PLACEMENT_FILTERS[placement] }}
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
                ...(onAdd && placing
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
          empty={
            placing
              ? "No accepted proposals left to place. Placed proposals are listed under Placed."
              : "No accepted proposal is on the agenda yet."
          }
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
                      // Statuses read under the speakers, where the planner cards show theirs, clear of the title.
                      notice:
                        !placing || proposal.pending_speaker_count > 0 ? (
                          <>
                            {!placing && (
                              <ToneBadge tone="neutral" dot={false}>
                                {placementLabel(proposal, timeZone)}
                              </ToneBadge>
                            )}
                            {proposal.pending_speaker_count > 0 && (
                              // Only accepted speakers are placed on the agenda; the rest join once they accept.
                              <ToneBadge tone="warn">{pendingSpeakersLabel(proposal.pending_speaker_count)}</ToneBadge>
                            )}
                          </>
                        ) : null,
                      controls: (
                        <div class="pk-cluster">
                          <RowActions
                            subject={proposal.title}
                            actions={[
                              ...(onSelect && placing
                                ? [
                                    {
                                      id: "schedule",
                                      label: "Choose a calendar slot",
                                      disabled: controlsBusy || interactionsDisabled || !canRead,
                                      onSelect: () => onSelect(proposal),
                                    },
                                  ]
                                : []),
                              ...(onAdd && placing
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
                        placing &&
                        onSelect &&
                        canRead &&
                        !controlsBusy &&
                        !interactionsDisabled &&
                        !proposal.agendaImported
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
