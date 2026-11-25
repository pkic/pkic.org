import {
  liveOutputDetails,
  liveOutputRole,
  liveRoomOutputs,
  liveStudioOutputs,
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
import {
  DEFAULT_LIVE_ROOM_OUTPUTS,
  type LiveRoomOutput,
  type LiveRoomOutputRole,
} from "../../../../../../../shared/schemas/live-room-output-setup";
import { liveOutputComposition, type LiveStage } from "../../../../../../../shared/schemas/live-session-room";
import { resolveLiveSceneElements } from "../../../../../../../shared/live-scene-elements";
import { liveOutputScene } from "../../../../../../live-session/live-output-projection";
import { Menu, type MenuItem } from "../../../../../../ui/Menu";
import {
  liveLayerElement,
  liveLayerShown,
  liveLayerTargets,
  liveOutputsDisabled,
  sendLayerToggle,
  type LiveLayer,
  type LiveTargets,
} from "./live-output-targets";
import { liveTallyAttributes } from "./live-tally";
import "./live-tally.css";
import "./LiveRowMenu.css";

/**
 * Where a graphic is among the room's screens: the screens it is on and
 * stays on, and the screens that show it while it is on Program, because
 * they sync with Program. A screen that follows Program holds what the room
 * carried over from Program and shows it when its own scene includes it;
 * the speaker's screen shows Program's graphic wherever it has none of its
 * own of that kind.
 */
export interface LiveScreens {
  on: readonly LiveAuxOutput[];
  /** Screens that show it while it is on Program, and lose it when it goes off air. */
  following: readonly LiveAuxOutput[];
  /** The room's outputs, which name and color them. */
  outputs: readonly LiveRoomOutput[];
}

/** A graphic that goes nowhere yet, such as a pending question or a draft poll. */
export const NO_LIVE_SCREENS: LiveScreens = { on: [], following: [], outputs: DEFAULT_LIVE_ROOM_OUTPUTS };

/** The graphic of a composition a row's layer is. */
const graphicOf = (layer: LiveLayer): LiveScreenGraphic => (layer.kind === "timer" ? "timerGraphics" : layer.kind);

/**
 * Whether a screen that syncs shows this kind of graphic from Program: the
 * graphics it follows that it draws. The stage display reads Program's
 * agenda only for its footer, so an agenda graphic is not shown there.
 */
function followsKind(role: LiveRoomOutputRole | null, layer: LiveLayer): boolean {
  return liveScreenFollows(role, graphicOf(layer)) && !(role === "speaker" && layer.kind === "schedule");
}

/** Whether a screen draws a graphic of its composition: the stage display only a question in place of a poll, and only countdowns. */
function draws(
  role: LiveRoomOutputRole | null,
  shown: LiveStage,
  layer: LiveLayer,
  timers: LiveTargets["state"]["timers"],
) {
  if (role === "speaker" && layer.kind === "poll" && shown.question) return false;
  if (role === "speaker" && layer.kind === "timer")
    return liveStageDisplayGraphics(shown, timers).some((graphic) => graphic.timerId === layer.graphic.timerId);
  return liveLayerShown(shown, layer);
}

/**
 * Whether a screen that follows Program holds a graphic that is on Program
 * too: the room takes it off that screen when it goes off air.
 */
function carriedFromProgram(
  targets: LiveTargets,
  where: ReturnType<typeof liveLayerTargets>,
  output: LiveAuxOutput,
): boolean {
  const { state } = targets;
  const outputs = liveRoomOutputs(state.session);
  return (
    where.program &&
    where.aux(output) &&
    liveOutputRole(outputs, output) === "follow" &&
    liveScreenSyncs(state.screenSync, outputs, output)
  );
}

/** Whether a screen shows a graphic while it is on Program, and loses it when it goes off air. */
function followsProgram(
  targets: LiveTargets,
  layer: LiveLayer,
  where: ReturnType<typeof liveLayerTargets>,
  output: LiveAuxOutput,
): boolean {
  const { state } = targets;
  const outputs = liveRoomOutputs(state.session);
  const role = liveOutputRole(outputs, output);
  // A screen that follows Program draws in its own scene: a graphic that scene leaves out does not show there.
  if (carriedFromProgram(targets, where, output))
    return resolveLiveSceneElements(state, liveOutputScene(state, output))[liveLayerElement(layer)].visible;
  if (!where.program || where.aux(output) || !liveScreenSyncs(state.screenSync, outputs, output)) return false;
  if (!followsKind(role, layer)) return false;
  const shown = liveScreenComposition(output, {
    own: liveOutputComposition(state.outputs, output),
    program: state.stage,
    sync: state.screenSync,
    timers: state.timers,
    outputs,
  });
  return draws(role, shown, layer, state.timers);
}

/** The room's screens a graphic is on now. */
export function liveScreens(targets: LiveTargets, layer: LiveLayer): LiveScreens {
  const where = liveLayerTargets(targets, layer);
  const outputs = liveRoomOutputs(targets.state.session);
  const keys = liveStudioOutputs(outputs);
  return {
    on: keys.filter((output) => where.aux(output) && !carriedFromProgram(targets, where, output)),
    following: keys.filter((output) => followsProgram(targets, layer, where, output)),
    outputs,
  };
}

/**
 * How a graphic stands on one screen: off, on and staying, on a screen that
 * follows Program while it is live there too (`carried`), kept on the
 * speaker's screen while it is live, or shown there only because it is live.
 */
type ScreenStanding = "off" | "on" | "carried" | "kept" | "following";

/** What a click on a screen's item does, in the words of the room. */
function screenDescription(screen: string, standing: ScreenStanding): string {
  const says: Record<ScreenStanding, string> = {
    off: `Show it on ${screen}.`,
    on: `On ${screen}. Click to take it off.`,
    carried: `On ${screen} while it is live. Click to take it off ${screen}.`,
    kept: `Kept on ${screen}. Click to show it there only while it is live.`,
    following: `On ${screen} because it is live. Click to keep it there after it goes off air.`,
  };
  return says[standing];
}

/** A switch per screen of the room that can draw the graphic, in its tally color, checked where the graphic was put, each saying what a click does. */
export function liveScreenItems(targets: LiveTargets, layer: LiveLayer): MenuItem[] {
  const { following } = liveScreens(targets, layer);
  const where = liveLayerTargets(targets, layer);
  const outputs = liveRoomOutputs(targets.state.session);
  // A screen that cannot draw the graphic is left out, unless it holds one already and needs a way to take it off.
  const offered = liveStudioOutputs(outputs).filter(
    (output) => liveScreenDraws(liveOutputRole(outputs, output), graphicOf(layer)) || where.aux(output),
  );
  return offered.map((output) => {
    const put = where.aux(output);
    const role = liveOutputRole(outputs, output);
    const synced = liveScreenSyncs(targets.state.screenSync, outputs, output);
    const standing: ScreenStanding = carriedFromProgram(targets, where, output)
      ? "carried"
      : put && where.program && synced && followsKind(role, layer)
        ? "kept"
        : put
          ? "on"
          : following.includes(output)
            ? "following"
            : "off";
    const { label } = liveOutputDetails(outputs, output);
    return {
      id: `screen-${output}`,
      label,
      // The screen's tally dot, so its name matches the monitor's color without looking up.
      icon: <span class="pk-live-screen-dot" {...liveTallyAttributes(outputs, output)} />,
      description: screenDescription(label, standing),
      checked: put,
      multiple: true,
      keepOpen: true,
      disabled: liveOutputsDisabled(targets),
      onSelect: () => sendLayerToggle(targets, layer, output),
    };
  });
}

/** The screens first, then the row's own actions after a separator. */
export function withScreenItems(screens: readonly MenuItem[], items: readonly MenuItem[]): MenuItem[] {
  return [...screens, ...items.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item))];
}

/** The trigger's tooltip: what the menu holds and the screens the graphic is on, then what opening it is for. */
export function liveScreensTitle({ on, following, outputs }: LiveScreens): string {
  const names = (keys: readonly LiveAuxOutput[]) =>
    keys.map((output) => liveOutputDetails(outputs, output).label).join(" and ");
  const where = [
    on.length ? `on ${names(on)}` : null,
    following.length ? `on ${names(following)} because it is live` : null,
  ].filter(Boolean);
  return `${["Room screens and actions", ...where].join(" · ")}\nOpen to put it on a room screen or take it off, and for its other actions.`;
}

/**
 * A row menu's trigger: the ⋯, with a dot under it in each screen's color
 * for every screen the graphic is on; a ring for each screen that shows it
 * from Program.
 */
export function LiveScreenTrigger({ screens }: { screens: LiveScreens }) {
  const { on, following, outputs } = screens;
  return (
    <>
      <span aria-hidden="true">⋯</span>
      {on.length || following.length ? (
        <span class="pk-live-screen-dots" aria-hidden="true">
          {on.map((output) => (
            <span key={output} {...liveTallyAttributes(outputs, output)} />
          ))}
          {following.map((output) => (
            <span key={`${output}-following`} {...liveTallyAttributes(outputs, output)} data-following="" />
          ))}
        </span>
      ) : null}
    </>
  );
}

/**
 * The room's screens a graphic was put on, by their codes in their tally
 * colors beside PVW and PGM, so a row says at a glance that the projector
 * shows it. A screen that shows it only by following Program keeps its ring
 * on the menu.
 */
export function LiveScreenTags({ screens }: { screens: LiveScreens }) {
  if (!screens.on.length) return null;
  return (
    <span class="pk-live-screen-tags">
      {screens.on.map((output) => {
        const { label, short } = liveOutputDetails(screens.outputs, output);
        return (
          <abbr
            key={output}
            class="pk-live-screen-tag"
            {...liveTallyAttributes(screens.outputs, output)}
            title={`On ${label}\nTake it off from the row's ⋯ menu.`}
          >
            {short}
          </abbr>
        );
      })}
    </span>
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
