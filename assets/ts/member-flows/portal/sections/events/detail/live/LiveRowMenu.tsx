import {
  LIVE_AUX_OUTPUT_DETAILS,
  LIVE_STUDIO_AUX_OUTPUTS,
  type LiveAuxOutput,
} from "../../../../../../../shared/live-room-outputs";
import { liveStageDisplayGraphics } from "../../../../../../../shared/live-stage-display-plan";
import { liveSyncedComposition } from "../../../../../../../shared/live-screen-sync";
import type { LiveSyncedScreen } from "../../../../../../../shared/schemas/live-screen-sync";
import { Menu, type MenuItem } from "../../../../../../ui/Menu";
import {
  liveLayerShown,
  liveLayerTargets,
  sendLayerToggle,
  type LiveLayer,
  type LiveTargets,
} from "./live-output-targets";
import "./live-tally.css";
import "./LiveRowMenu.css";

/**
 * Where a graphic is among the room's screens: the screens it was put on,
 * and the screens that show it anyway because it is on Program and they sync
 * with Program. A synced screen takes a graphic from Program wherever it has
 * none of its own of that kind.
 */
export interface LiveScreens {
  on: readonly LiveAuxOutput[];
  /** Screens that show it from Program, not because it was put on them. */
  following: readonly LiveAuxOutput[];
}

/** A graphic that goes nowhere yet, such as a pending question or a draft poll. */
export const NO_LIVE_SCREENS: LiveScreens = { on: [], following: [] };

/** Kinds the stage display takes from Program; the projector takes every kind. */
const STAGE_DISPLAY_FOLLOWS: ReadonlySet<LiveLayer["kind"]> = new Set(["question", "poll", "timer"]);

/** Whether a screen that syncs with Program would show this graphic while it is live. */
function screenFollows(output: LiveSyncedScreen, layer: LiveLayer): boolean {
  return output === "projector" || STAGE_DISPLAY_FOLLOWS.has(layer.kind);
}

/** Whether a screen shows a graphic because it is on Program, not because it was put there. */
function followsProgram(
  targets: LiveTargets,
  layer: LiveLayer,
  where: ReturnType<typeof liveLayerTargets>,
  output: LiveSyncedScreen,
): boolean {
  const { state } = targets;
  if (!where.program || where.aux(output) || !state.screenSync[output]) return false;
  const own = state.outputs[output];
  const program = state.stage;
  if (output === "projector") return liveLayerShown(liveSyncedComposition(own, program), layer);
  switch (layer.kind) {
    case "question":
      return !own.question;
    case "poll":
      // A question on the stage display, its own or Program's, takes the place of a poll.
      return !own.question && !program.question && !own.poll;
    case "timer":
      return liveStageDisplayGraphics(own, program, state.timers).some(
        (graphic) => graphic.timerId === layer.graphic.timerId,
      );
    default:
      return false;
  }
}

/** The room's screens a graphic is on now. */
export function liveScreens(targets: LiveTargets, layer: LiveLayer): LiveScreens {
  const where = liveLayerTargets(targets, layer);
  return {
    on: LIVE_STUDIO_AUX_OUTPUTS.filter((output) => where.aux(output)),
    following: LIVE_STUDIO_AUX_OUTPUTS.filter((output) => followsProgram(targets, layer, where, output)),
  };
}

/** Each screen as the room calls it: the audience's screen and the speaker's. */
const SCREEN_NAMES: Record<LiveSyncedScreen, string> = {
  projector: "the audience screen",
  "stage-display": "the speaker’s screen",
};

/** What a click on a screen's item does, in the words of the room. */
function screenDescription(output: LiveSyncedScreen, on: boolean, following: boolean, keptWhileLive: boolean): string {
  const screen = SCREEN_NAMES[output];
  if (keptWhileLive) return `Kept on ${screen}. Click to show it there only while it is live.`;
  if (on) return `On ${screen}. Click to take it off.`;
  if (following) return `On ${screen} because it is live. Click to keep it there after it goes off air.`;
  return `Show it on ${screen}.`;
}

/** A switch per screen of the room, checked where the graphic was put, each saying what a click does. */
export function liveScreenItems(targets: LiveTargets, layer: LiveLayer): MenuItem[] {
  const { on, following } = liveScreens(targets, layer);
  const live = liveLayerTargets(targets, layer).program;
  return LIVE_STUDIO_AUX_OUTPUTS.map((output) => {
    const put = on.includes(output);
    const kept = put && live && targets.state.screenSync[output] && screenFollows(output, layer);
    return {
      id: `screen-${output}`,
      label: LIVE_AUX_OUTPUT_DETAILS[output].label,
      description: screenDescription(output, put, following.includes(output), kept),
      checked: put,
      multiple: true,
      keepOpen: true,
      disabled: targets.disabled,
      onSelect: () => sendLayerToggle(targets, layer, output),
    };
  });
}

/** The screens first, then the row's own actions after a separator. */
export function withScreenItems(screens: readonly MenuItem[], items: readonly MenuItem[]): MenuItem[] {
  return [...screens, ...items.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item))];
}

/** The trigger's tooltip: what the menu holds, then the screens the graphic is on. */
export function liveScreensTitle({ on, following }: LiveScreens): string {
  const names = (outputs: readonly LiveAuxOutput[]) =>
    outputs.map((output) => LIVE_AUX_OUTPUT_DETAILS[output].label).join(" and ");
  const parts = [
    on.length ? `On ${names(on)}.` : null,
    following.length ? `On ${names(following)} because it is live.` : null,
  ].filter(Boolean);
  return ["Room screens and more actions.", ...parts].join(" ");
}

/**
 * A row menu's trigger: the ⋯, with a dot under it in each screen's color
 * for every screen the graphic is on; a ring for each screen that shows it
 * from Program.
 */
export function LiveScreenTrigger({ screens }: { screens: LiveScreens }) {
  const { on, following } = screens;
  return (
    <>
      <span aria-hidden="true">⋯</span>
      {on.length || following.length ? (
        <span class="pk-live-screen-dots" aria-hidden="true">
          {on.map((output) => (
            <span key={output} data-tally={output} />
          ))}
          {following.map((output) => (
            <span key={`${output}-following`} data-tally={output} data-following="" />
          ))}
        </span>
      ) : null}
    </>
  );
}

/**
 * A studio row's menu for a graphic: the room's screens as switches at the
 * top, so a row keeps only PVW and PGM in line, then the row's own actions.
 * The trigger carries a dot for each screen the graphic is on.
 */
export function LiveRowMenu({
  targets,
  layer,
  label,
  heading,
  items = [],
}: {
  targets: LiveTargets;
  layer: LiveLayer;
  label: string;
  heading?: string;
  items?: readonly MenuItem[];
}) {
  const screens = liveScreens(targets, layer);
  return (
    <Menu
      label={label}
      heading={heading}
      align="end"
      title={liveScreensTitle(screens)}
      items={withScreenItems(liveScreenItems(targets, layer), items)}
    >
      <LiveScreenTrigger screens={screens} />
    </Menu>
  );
}
