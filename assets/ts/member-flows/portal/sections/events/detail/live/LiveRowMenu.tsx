import {
  LIVE_AUX_OUTPUT_DETAILS,
  LIVE_STUDIO_AUX_OUTPUTS,
  type LiveAuxOutput,
} from "../../../../../../../shared/live-room-outputs";
import { liveStageDisplayGraphics } from "../../../../../../../shared/live-stage-display-plan";
import {
  liveScreenComposition,
  liveScreenDraws,
  liveScreenFollows,
  liveScreenSyncs,
  type LiveScreenGraphic,
} from "../../../../../../../shared/live-screen-sync";
import type { LiveStage } from "../../../../../../../shared/schemas/live-session-room";
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

/** The graphic of a composition a row's layer is. */
const graphicOf = (layer: LiveLayer): LiveScreenGraphic => (layer.kind === "timer" ? "timerGraphics" : layer.kind);

/**
 * Whether a screen that syncs shows this kind of graphic from Program: the
 * graphics it follows that it draws. The stage display reads Program's
 * agenda only for its footer, so an agenda graphic is not shown there.
 */
function followsKind(output: LiveSyncedScreen, layer: LiveLayer): boolean {
  return liveScreenFollows(output, graphicOf(layer)) && !(output === "stage-display" && layer.kind === "schedule");
}

/** Whether a screen draws a graphic of its composition: the stage display only a question in place of a poll, and only countdowns. */
function draws(output: LiveSyncedScreen, shown: LiveStage, layer: LiveLayer, timers: LiveTargets["state"]["timers"]) {
  if (output === "stage-display" && layer.kind === "poll" && shown.question) return false;
  if (output === "stage-display" && layer.kind === "timer")
    return liveStageDisplayGraphics(shown, timers).some((graphic) => graphic.timerId === layer.graphic.timerId);
  return liveLayerShown(shown, layer);
}

/** Whether a screen shows a graphic because it is on Program, not because it was put there. */
function followsProgram(
  targets: LiveTargets,
  layer: LiveLayer,
  where: ReturnType<typeof liveLayerTargets>,
  output: LiveSyncedScreen,
): boolean {
  const { state } = targets;
  if (!where.program || where.aux(output) || !liveScreenSyncs(state.screenSync, output)) return false;
  if (!followsKind(output, layer)) return false;
  const shown = liveScreenComposition(output, {
    own: state.outputs[output],
    program: state.stage,
    sync: state.screenSync,
    timers: state.timers,
  });
  return draws(output, shown, layer, state.timers);
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

/** A switch per screen of the room that can draw the graphic, in its tally color, checked where the graphic was put, each saying what a click does. */
export function liveScreenItems(targets: LiveTargets, layer: LiveLayer): MenuItem[] {
  const { on, following } = liveScreens(targets, layer);
  const live = liveLayerTargets(targets, layer).program;
  // A screen that cannot draw the graphic is left out, unless it holds one already and needs a way to take it off.
  const offered = LIVE_STUDIO_AUX_OUTPUTS.filter(
    (output) => liveScreenDraws(output, graphicOf(layer)) || on.includes(output),
  );
  return offered.map((output) => {
    const put = on.includes(output);
    const kept = put && live && liveScreenSyncs(targets.state.screenSync, output) && followsKind(output, layer);
    return {
      id: `screen-${output}`,
      label: LIVE_AUX_OUTPUT_DETAILS[output].label,
      // The screen's tally dot, so its name matches the monitor's color without looking up.
      icon: <span class="pk-live-screen-dot" data-tally={output} />,
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
