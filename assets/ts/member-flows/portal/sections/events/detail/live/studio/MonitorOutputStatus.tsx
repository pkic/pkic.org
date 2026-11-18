import { formatNumber } from "../../../../../../../../shared/format-number";
import { liveScreenSyncs } from "../../../../../../../../shared/live-screen-sync";
import type { LiveRoomOutput } from "../../../../../../../../shared/schemas/live-room-output-setup";
import type { LiveSyncedScreen } from "../../../../../../../../shared/schemas/live-screen-sync";
import { Button } from "../../../../../../../ui/Button";
import { IconMonitor, StrokeIcon } from "../../../../../../../ui/MediaIcons";
import type { MonitorSources, MonitorSwitcher } from "./MonitorPanel";
import { studioOutputDetails, type StudioOutput } from "./studio-layout";

/* A monitor header's status: whether a room screen syncs with Program, and how many sources draw the output. */

/** A chain link, broken while the screen does not sync. */
function SyncIcon({ synced }: { synced: boolean }) {
  return (
    <StrokeIcon>
      <path d="M7 4.5l1.3-1.3a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.3 1.3a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" />
      <path d={synced ? "M6.5 9.5 9.5 6.5" : "M2 2l12 12"} />
    </StrokeIcon>
  );
}

/** What a room screen shows besides its own graphics, said for an operator who is unsure mid-show. */
const SYNC_HINTS = {
  on: "Sync with Program: on\nShows what is live on Program, plus anything you put here. Click to show only what you put here.",
  off: "Sync with Program: off\nShows only what you put here. Click to also show what is live on Program.",
} as const;

/** Whether a room screen follows Program: on by default, a red PGM chip while on. */
export function SyncToggle({
  output,
  room,
  switcher,
}: {
  output: LiveSyncedScreen;
  room: readonly LiveRoomOutput[];
  switcher: MonitorSwitcher;
}) {
  const synced = liveScreenSyncs(switcher.screenSync, room, output);
  return (
    <Button
      variant="ghost"
      class="pk-studio-monitor__sync"
      data-tally="program"
      aria-pressed={synced}
      aria-label={`Sync ${studioOutputDetails(room, output).label} with Program`}
      title={synced ? SYNC_HINTS.on : SYNC_HINTS.off}
      disabled={switcher.disabled}
      onClick={() => switcher.sync(output, !synced)}
    >
      <SyncIcon synced={synced} />
      <span class="pk-studio-monitor__sync-text" aria-hidden="true">
        PGM
      </span>
    </Button>
  );
}

/**
 * How many browser sources and room screens draw this output now, so an
 * operator sees a feed that dropped. Program with none is the one to act on.
 */
export function SourceCount({
  output,
  room,
  sources,
}: {
  output: StudioOutput;
  room: readonly LiveRoomOutput[];
  sources: MonitorSources;
}) {
  // Away from the room, the studio cannot know who is still connected, so it claims nothing.
  if (output === "preview" || output === "livestream" || !sources.program || !sources.connected) return null;
  const count = sources.program.sources[output] ?? 0;
  const label = studioOutputDetails(room, output).label;
  const sentence =
    count === 0
      ? `Nothing shows ${label} now`
      : `${formatNumber(count)} ${count === 1 ? "browser source or screen shows" : "browser sources and screens show"} ${label} now`;
  const advice =
    count === 0
      ? "Check the browser source in your production software, or the screen in the room."
      : "If the number drops, a browser source or a screen lost its connection.";
  // An icon and the number, as the header is narrow; the sentence is its name, and its hint adds what to do.
  return (
    <span
      class="pk-studio-monitor__sources"
      role="img"
      aria-label={sentence}
      title={`${sentence}\n${advice}`}
      data-tone={count === 0 && output === "program" ? "warn" : undefined}
    >
      <IconMonitor class="pk-studio-monitor__sources-icon" />
      {formatNumber(count)}
    </span>
  );
}
