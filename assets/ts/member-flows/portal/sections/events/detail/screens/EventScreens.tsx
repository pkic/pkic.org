/**
 * The event's screens: where each stands, what it shows and whether it is
 * online. Staff who manage screens pair, edit and revoke them here; room
 * operators see the same list without those actions.
 */
import { useState } from "preact/hooks";
import { screenConnection, screenConnectionDisplay } from "../../../../../../../shared/event-screen-connection";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { LIVE_SCREEN_OUTPUT_DETAILS } from "../../../../../../../shared/live-room-outputs";
import {
  eventScreensListSchema,
  type EventScreenPairingCreate,
  type ScreenRecord,
  type ScreenUpdate,
} from "../../../../../../../shared/schemas/event-screens";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { Badge } from "../../../../../../ui/Badge";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { RowActions } from "../../../../../../ui/RowActions";
import type { ScreenLayoutChoice, ScreenRoomChoice } from "./ScreenAssignmentFields";
import { ScreenEditDialog } from "./ScreenEditDialog";
import { ScreenPairDialog } from "./ScreenPairDialog";
import "../../../../../../ui/Content.css";

export interface EventScreenCommands {
  pair: (body: EventScreenPairingCreate) => Promise<void>;
  update: (screen: ScreenRecord, body: ScreenUpdate) => Promise<void>;
  revoke: (screen: ScreenRecord) => Promise<void>;
}

function ScreenShows({ assignment }: { assignment: ScreenRecord["assignment"] }) {
  if (!assignment) return <span class="pk-muted">Not assigned</span>;
  return (
    <>
      {assignment.roomName} · {LIVE_SCREEN_OUTPUT_DETAILS[assignment.output].label}
    </>
  );
}

function ScreenStatus({ screen, now }: { screen: ScreenRecord; now: number }) {
  const { label, tone } = screenConnectionDisplay(screenConnection(screen.session, now));
  return tone ? <Badge tone={tone}>{label}</Badge> : <>{label}</>;
}

export function EventScreens({
  slug,
  rooms,
  layouts,
  canManage,
  commands,
  now = Date.now(),
  load,
}: {
  slug: string;
  rooms: readonly ScreenRoomChoice[];
  layouts: readonly ScreenLayoutChoice[];
  canManage: boolean;
  commands: EventScreenCommands;
  /** The instant statuses are read against. */
  now?: number;
  load?: CollectionLoader;
}) {
  const [pairing, setPairing] = useState(false);
  const [editing, setEditing] = useState<ScreenRecord | null>(null);

  async function revoke(screen: ScreenRecord) {
    const confirmed = await confirmAction({
      title: `Revoke “${screen.name}”?`,
      body: "The screen signs out and shows a pairing code again. Pair it to bring it back.",
      confirmLabel: "Revoke screen",
      tone: "danger",
    });
    if (confirmed) await commands.revoke(screen);
  }

  return (
    <div class="pk pk-stack">
      <ApiDataTable
        urlState="screens"
        caption="Screens"
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/screens`}
        responseSchema={eventScreensListSchema}
        resolve={(response) => response.screens}
        resolvePage={(response) => response.page}
        load={load}
        paginate
        initialSort="name"
        searchPlaceholder="Search screens…"
        createAction={
          canManage ? { label: "Pair screen", showLabel: true, onSelect: () => setPairing(true) } : undefined
        }
        rowKey={(screen) => screen.id}
        columns={[
          {
            header: "Name",
            cell: (screen) => <span class="pk-strong">{screen.name}</span>,
            sort: { asc: "name", desc: "-name" },
          },
          { header: "Screen ID", cell: (screen) => <span class="pk-mono">{screen.id}</span>, width: "fit" },
          { header: "Shows", cell: (screen) => <ScreenShows assignment={screen.assignment} /> },
          { header: "Status", cell: (screen) => <ScreenStatus screen={screen} now={now} />, width: "fit" },
          {
            header: "Last seen",
            cell: (screen) => formatDateTime(screen.session.lastSeenAt),
            sort: { asc: "lastSeenAt", desc: "-lastSeenAt", defaultDirection: "desc" },
            width: "fit",
          },
          ...(canManage
            ? [
                {
                  header: "",
                  cell: (screen: ScreenRecord) => (
                    <RowActions
                      subject={screen.name}
                      actions={[
                        { id: "edit", label: "Edit", onSelect: () => setEditing(screen) },
                        {
                          id: "revoke",
                          label: "Revoke",
                          danger: true,
                          separatorBefore: true,
                          disabled: screen.session.state === "none",
                          onSelect: () => void revoke(screen),
                        },
                      ]}
                    />
                  ),
                },
              ]
            : []),
        ]}
        empty={
          <EmptyState
            title="No screens yet"
            body="An unpaired screen shows a pairing code and its screen ID. Enter both with Pair screen."
          />
        }
      />
      {canManage && (
        <ScreenPairDialog
          open={pairing}
          rooms={rooms}
          layouts={layouts}
          onPair={commands.pair}
          onClose={() => setPairing(false)}
        />
      )}
      {editing && (
        <ScreenEditDialog
          screen={editing}
          rooms={rooms}
          layouts={layouts}
          onSave={commands.update}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
