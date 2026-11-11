/**
 * The event's screens: where each stands, what it shows and whether it is
 * online. Staff who manage screens pair, edit and revoke them here; room
 * operators see the same list without those actions.
 */
import { useRef, useState } from "preact/hooks";
import { screenConnection, screenConnectionDisplay } from "../../../../../../../shared/event-screen-connection";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { LIVE_SCREEN_OUTPUT_DETAILS } from "../../../../../../../shared/live-room-outputs";
import { eventScreensListSchema, type ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import { useBoundaryClock } from "../../../../../../hooks/useBoundaryClock";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";
import { ApiDataTable, type ApiTableActions } from "../../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Badge } from "../../../../../../ui/Badge";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { RowActions } from "../../../../../../ui/RowActions";
import { toast } from "../../../../ui";
import { ScreenEditDialog } from "./ScreenEditDialog";
import { ScreenPairDialog } from "./ScreenPairDialog";
import { eventScreensPath, revokeScreenSession } from "./screen-requests";
import "../../../../../../ui/Content.css";

/** Statuses read against a clock that moves each minute, so "Offline · 12 min" keeps counting. */
const nextMinute = (now: number) => now - (now % 60_000) + 60_000;

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
  canManage,
  now: fixedNow,
  load,
}: {
  slug: string;
  /** Pair, edit and revoke; without it the list is read-only. */
  canManage: boolean;
  /** A fixed instant to read statuses against, for the gallery. */
  now?: number;
  /** Reads the list and the room choices; the gallery hands in its own. */
  load?: CollectionLoader;
}) {
  const clock = useBoundaryClock(nextMinute);
  const now = fixedNow ?? clock;
  const actions = useRef<ApiTableActions | null>(null);
  const [pairing, setPairing] = useState(false);
  const [editing, setEditing] = useState<ScreenRecord | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const reload = async () => {
    await actions.current?.reload();
  };

  async function revoke(screen: ScreenRecord) {
    const confirmed = await confirmAction({
      title: `Revoke “${screen.name}”?`,
      body: "The screen signs out and shows a pairing code again. Pair it to bring it back.",
      confirmLabel: "Revoke screen",
      tone: "danger",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await revokeScreenSession(screen.id);
      toast(`“${screen.name}” revoked`, "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("The screen could not be revoked."));
    }
    await reload();
  }

  return (
    <div class="pk pk-stack">
      {error && <ErrorAlert error={error} />}
      <ApiDataTable
        urlState="screens"
        caption="Screens"
        actionsRef={actions}
        endpoint={eventScreensPath(slug)}
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
            body={
              canManage
                ? "An unpaired screen shows a pairing code and its screen ID. Enter both with Pair screen."
                : "Screens appear here once staff who manage screens pair them."
            }
          />
        }
      />
      {canManage && (
        <ScreenPairDialog
          open={pairing}
          slug={slug}
          load={load}
          onPaired={async (screen) => {
            toast(`“${screen.name}” approved. Waiting for the screen to sign in.`, "success");
            await reload();
          }}
          onClose={() => setPairing(false)}
        />
      )}
      {editing && (
        <ScreenEditDialog
          slug={slug}
          screen={editing}
          load={load}
          onSaved={async (screen) => {
            toast(`“${screen.name}” saved`, "success");
            await reload();
          }}
          onChanged={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
