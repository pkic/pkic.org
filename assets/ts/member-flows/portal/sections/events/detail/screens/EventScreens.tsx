/**
 * The event's screens: where each stands, what it shows and whether it is
 * online. With the monitor connected, a grid of cards shows each screen's
 * latest screenshot and last hour beside the list. Staff who manage screens
 * pair, edit, identify and reload them here, move one to a new device,
 * revoke one and remove one that is not signed in; room operators see the
 * same screens without those actions.
 */
import { useRef, useState } from "preact/hooks";
import { screenIssueCounts, sortByScreenIssues } from "../../../../../../../shared/event-screen-issues";
import { formatNumber } from "../../../../../../../shared/format-number";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { LIVE_SCREEN_OUTPUT_DETAILS } from "../../../../../../../shared/live-room-outputs";
import { eventScreensListSchema, type ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import { useBoundaryClock } from "../../../../../../hooks/useBoundaryClock";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";
import { ApiDataTable, type ApiTableActions } from "../../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { Chip } from "../../../../../../ui/Chip";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { Menu } from "../../../../../../ui/Menu";
import { RowActions } from "../../../../../../ui/RowActions";
import { toast } from "../../../../ui";
import { DiscoveryViewToggle, useDiscoveryView } from "../../../DiscoveryView";
import { ScreenEditDialog } from "./ScreenEditDialog";
import { ScreenHealthCell } from "./ScreenHealthCell";
import {
  ScreenConditionLine,
  ScreenMonitorCard,
  ScreenMonitorLost,
  screenCondition,
  screenOnline,
} from "./ScreenMonitorCard";
import { useScreenMonitorController, type ScreenMonitorFixture } from "./useScreenMonitorController";
import { ScreenPairDialog } from "./ScreenPairDialog";
import { ScreenReplaceDialog } from "./ScreenReplaceDialog";
import { eventScreensPath, removeScreen, revokeScreenSession } from "./screen-requests";
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

/** "1 critical · 2 warnings": how many screens are at each tier. */
function attentionSummary(counts: { critical: number; warning: number }): string {
  const parts = [
    counts.critical ? `${formatNumber(counts.critical)} critical` : "",
    counts.warning ? `${formatNumber(counts.warning)} ${counts.warning === 1 ? "warning" : "warnings"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No screens need attention";
}

export function EventScreens({
  slug,
  canManage,
  now: fixedNow,
  load,
  monitor: fixture,
}: {
  slug: string;
  /** Pair, edit and revoke; without it the list is read-only. */
  canManage: boolean;
  /** A fixed instant to read statuses against, for the gallery. */
  now?: number;
  /** Reads the list and the room choices; the gallery hands in its own. */
  load?: CollectionLoader;
  /** The gallery's fixed monitor view; otherwise the tab connects to the event's screen monitor. */
  monitor?: ScreenMonitorFixture;
}) {
  const clock = useBoundaryClock(nextMinute);
  const controller = useScreenMonitorController({ slug, fixture });
  const monitor = controller.view;
  const onCommand = controller.command;
  const now = fixedNow ?? (monitor ? controller.now : clock);
  const counts = screenIssueCounts(controller.issues.values());
  const needAttention = [...controller.issues].filter(([, issues]) => issues.length).map(([screenId]) => screenId);
  const [attention, setAttention] = useHashQueryParam("attention", "", ["", "1"]);
  // The filter needs at least one screen; with none left the full list shows.
  const attentionIds = attention && needAttention.length ? needAttention.sort().join(",") : "";
  const actions = useRef<ApiTableActions | null>(null);
  const [pairing, setPairing] = useState(false);
  const [editing, setEditing] = useState<ScreenRecord | null>(null);
  const [replacing, setReplacing] = useState<ScreenRecord | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { view, setView } = useDiscoveryView();
  const live = monitor?.live;
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

  async function remove(screen: ScreenRecord) {
    const confirmed = await confirmAction({
      title: `Remove “${screen.name}”?`,
      body: "Its name and assignment are deleted. Pair the device again to bring it back.",
      confirmLabel: "Remove screen",
      tone: "danger",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await removeScreen(screen.id);
      toast(`“${screen.name}” removed`, "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("The screen could not be removed."));
    }
    await reload();
  }

  const menu = (screen: ScreenRecord) => (
    <RowActions
      subject={screen.name}
      actions={[
        ...(onCommand
          ? [
              {
                id: "identify",
                label: "Identify",
                disabled: !live?.get(screen.id)?.online,
                onSelect: () => onCommand("screen.identify", screen),
              },
              {
                id: "reload",
                label: "Reload",
                disabled: !live?.get(screen.id)?.online,
                onSelect: () => onCommand("screen.reload", screen),
              },
            ]
          : []),
        {
          id: "edit",
          label: "Edit",
          separatorBefore: Boolean(onCommand),
          onSelect: () => setEditing(screen),
        },
        {
          id: "replace",
          label: "Replace device…",
          disabled: !screen.eventId,
          onSelect: () => setReplacing(screen),
        },
        {
          id: "revoke",
          label: "Revoke",
          danger: true,
          separatorBefore: true,
          disabled: screen.session.state === "none",
          onSelect: () => void revoke(screen),
        },
        {
          id: "remove",
          label: "Remove",
          danger: true,
          disabled: screen.session.state === "active",
          onSelect: () => void remove(screen),
        },
      ]}
    />
  );

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
        params={attentionIds ? { screenIds: attentionIds } : undefined}
        inset={
          controller.lostSince !== null ? <ScreenMonitorLost lostSince={controller.lostSince} now={now} /> : undefined
        }
        onData={(response) => controller.remember(response.screens)}
        load={load}
        paginate
        initialSort="name"
        searchPlaceholder="Search screens…"
        framed={!(monitor && view === "grid")}
        toolbar={
          monitor
            ? () => (
                <>
                  {(needAttention.length > 0 || attention) && (
                    <Chip pressed={Boolean(attentionIds)} onToggle={() => setAttention(attention ? "" : "1")}>
                      {attentionSummary(counts)}
                    </Chip>
                  )}
                  <DiscoveryViewToggle view={view} onChange={setView} />
                  <Menu
                    label="Screen notifications"
                    items={[
                      {
                        id: "notify",
                        label: "Notify me in this browser",
                        checked: controller.notifications.enabled,
                        multiple: true,
                        disabled: !controller.notifications.supported,
                        onSelect: () => void controller.notifications.toggle(),
                      },
                    ]}
                  />
                </>
              )
            : undefined
        }
        renderItems={
          monitor && view === "grid"
            ? (screens) => (
                <div class="pk-discovery-grid">
                  {sortByScreenIssues(screens, (screen) => controller.issuesOf(screen.id)).map((screen) => (
                    <ScreenMonitorCard
                      key={screen.id}
                      screen={screen}
                      status={monitor.live.get(screen.id)}
                      issues={controller.issuesOf(screen.id)}
                      lostSince={controller.lostSince}
                      samples={monitor.quality.get(screen.id) ?? []}
                      screenshot={monitor.screenshots.get(screen.id)}
                      now={now}
                      actions={canManage ? menu(screen) : undefined}
                    />
                  ))}
                </div>
              )
            : undefined
        }
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
          {
            header: "Shows",
            cell: (screen) => (
              <div class="pk-stack pk-stack--tight">
                <span>
                  <ScreenShows assignment={screen.assignment} />
                </span>
                <ScreenHealthCell status={live?.get(screen.id)} />
              </div>
            ),
          },
          {
            header: "Status",
            cell: (screen) => (
              <ScreenConditionLine
                condition={screenCondition(
                  screen,
                  live?.get(screen.id),
                  controller.issuesOf(screen.id),
                  now,
                  controller.lostSince,
                  Boolean(monitor),
                )}
              />
            ),
          },
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
                  cell: (screen: ScreenRecord) => menu(screen),
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
      {replacing && (
        <ScreenReplaceDialog
          screen={replacing}
          online={screenOnline(replacing, live?.get(replacing.id), now)}
          onReplaced={async (screen) => {
            toast(`“${screen.name}” moved to the new device. Waiting for it to sign in.`, "success");
            await reload();
          }}
          onChanged={reload}
          onClose={() => setReplacing(null)}
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
