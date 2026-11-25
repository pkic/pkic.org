/**
 * The sponsors of this event alone, as its organizers see them. Consortium
 * sponsors support every event and are managed by PKIC; this list holds the
 * one-time sponsors organizers add for their event.
 */
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { sponsorshipsListResponseSchema } from "../../../../../../../../shared/schemas/sponsorship-management";
import { ApiDataTable, type ApiTableActions } from "../../../../../../../components/ApiDataTable";
import { statusLabel } from "../../../../../../../components/Badge";
import type { CollectionLoader } from "../../../../../../../hooks/useServerCollection";
import { EmptyState } from "../../../../../../../ui/EmptyState";
import { Panel, PanelHeader } from "../../../../../../../ui/Panel";
import { toast } from "../../../../../ui";
import { AddEventSponsorDialog } from "./AddEventSponsorDialog";

export function EventSponsorsPanel({
  eventId,
  canWrite,
  loadSponsors,
  menu,
  children,
}: {
  eventId: string;
  canWrite: boolean;
  /** The panel's ellipsis menu, for actions on the event's sponsor settings as a whole. */
  menu?: ComponentChildren;
  /** Content below the sponsor list, such as the event's sponsor tier settings. */
  children?: ComponentChildren;
  /** Replaces the request for the sponsors, where there is no server to ask. */
  loadSponsors?: CollectionLoader;
}) {
  const table = useRef<ApiTableActions | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <Panel aria-label="Event sponsors">
      <PanelHeader title="Event sponsors" menu={menu} />
      <ApiDataTable
        urlState="event-sponsors"
        endpoint="/api/v1/sponsors"
        params={{ visibility: "all", eventId }}
        responseSchema={sponsorshipsListResponseSchema}
        resolve={(value) => value.sponsorships}
        resolvePage={(value) => value.page}
        load={loadSponsors}
        actionsRef={table}
        caption="Event sponsors"
        paginate
        searchPlaceholder="Search sponsors…"
        initialSort="company"
        rowKey={(row) => row.id}
        createAction={canWrite ? { label: "Add event sponsor", onSelect: () => setAdding(true) } : undefined}
        empty={
          <EmptyState
            title="No event sponsors yet"
            body="Add a sponsor that supports this event only. Consortium sponsors support every event and are managed by the sponsorship team."
          />
        }
        columns={[
          {
            header: "Sponsor",
            hideable: false,
            sort: { asc: "company", desc: "-company" },
            cell: (row) => (
              <>
                <strong>{row.organizationName ?? row.nonMemberName ?? "Unnamed sponsor"}</strong>
                {(row.contactName || row.contactEmail) && (
                  <div class="pk-small pk-muted">{[row.contactName, row.contactEmail].filter(Boolean).join(" · ")}</div>
                )}
              </>
            ),
          },
          { header: "Tier", width: "fit", sort: { asc: "tier", desc: "-tier" }, cell: (row) => row.tier ?? "" },
          {
            header: "Stage",
            width: "fit",
            sort: { asc: "pipelineStage", desc: "-pipelineStage" },
            cell: (row) => statusLabel(row.pipelineStage),
          },
        ]}
      />
      {children}
      {adding && (
        <AddEventSponsorDialog
          eventId={eventId}
          onClose={() => setAdding(false)}
          onAdded={async (name) => {
            setAdding(false);
            await table.current?.reload();
            toast(`${name} added as an event sponsor.`, "success");
          }}
        />
      )}
    </Panel>
  );
}
