import { useState } from "preact/hooks";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { RowActions } from "../../../../../../ui/RowActions";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { getJson } from "../../../../../../shared/api-client";
import { buildServerCollectionUrl, type CollectionLoader } from "../../../../../../hooks/useServerCollection";
import {
  eventProposalsListQuerySchema,
  eventProposalsResponseSchema,
} from "../../../../../../../shared/schemas/event-proposals";

/** This catalogue stays accepted-only even when an old URL carries a different status filter. */
const loadAccepted: CollectionLoader = (url, signal, schema) => {
  const source = new URL(url, "https://pkic.org");
  const query = eventProposalsListQuerySchema.parse({ ...Object.fromEntries(source.searchParams), status: "accepted" });
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
}: {
  eventSlug: string;
  onReview: (proposalId: string) => void;
  onSelect?: (proposal: { id: string; title: string }, native?: boolean) => void;
  onDragEnd?: () => void;
}) {
  const [canRead, setCanRead] = useState(false);
  return (
    <Panel>
      <PanelHeader title="Accepted proposals" />
      <PanelBody>
        <p>
          Drag an accepted proposal onto the agenda, or choose Schedule from its menu and select a time and location.
          Review the exact placement before saving. You can also import a proposal without scheduling it.
        </p>
        <ApiDataTable
          caption="Accepted proposals"
          endpoint={`/api/v1/events/${encodeURIComponent(eventSlug)}/proposals`}
          urlState="accepted-backlog"
          responseSchema={eventProposalsResponseSchema}
          load={loadAccepted}
          params={{ status: "accepted" }}
          resolve={(response) => response.proposals}
          resolvePage={(response) => response.page}
          onData={(response) => setCanRead(response.access.canRead)}
          paginate
          initialSort="title"
          searchPlaceholder="title, proposer or review"
          rowKey={(proposal) => proposal.id}
          empty="No accepted proposals match this search."
          columns={[
            {
              header: "Proposal",
              width: "primary",
              cell: (proposal) => (
                <strong
                  draggable={Boolean(onSelect && canRead && !proposal.agendaImported)}
                  onDragStart={(event) => {
                    if (!onSelect || !canRead || proposal.agendaImported) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer?.setData("application/x-pkic-accepted-proposal", proposal.id);
                    onSelect(proposal, true);
                  }}
                  onDragEnd={onDragEnd}
                >
                  {proposal.title}
                </strong>
              ),
              sort: { asc: "title", desc: "-title", defaultDirection: "asc" },
            },
            {
              header: "Proposer",
              cell: (proposal) =>
                [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ") ||
                "Unnamed proposer",
            },
            { header: "Source", cell: () => "Accepted proposal", width: "fit" },
            {
              header: "Agenda",
              width: "fit",
              cell: (proposal) =>
                proposal.agendaImported ? (
                  <span>In agenda</span>
                ) : (
                  <RowActions
                    subject={proposal.title}
                    actions={[
                      ...(onSelect
                        ? [
                            {
                              id: "schedule",
                              label: "Schedule on agenda",
                              disabled: !canRead,
                              onSelect: () => onSelect(proposal),
                            },
                          ]
                        : []),
                      {
                        id: "import",
                        label: "Import without scheduling",
                        disabled: !canRead,
                        onSelect: () => onReview(proposal.id),
                      },
                    ]}
                  />
                ),
            },
          ]}
        />
      </PanelBody>
    </Panel>
  );
}
