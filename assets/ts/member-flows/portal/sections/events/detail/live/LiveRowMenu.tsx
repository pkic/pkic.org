import {
  LIVE_AUX_OUTPUT_DETAILS,
  LIVE_STUDIO_AUX_OUTPUTS,
  type LiveAuxOutput,
} from "../../../../../../../shared/live-room-outputs";
import { liveStageDisplayGraphics } from "../../../../../../../shared/live-stage-display-plan";
import { Menu, type MenuItem } from "../../../../../../ui/Menu";
import { liveLayerTargets, sendLayerToggle, type LiveLayer, type LiveTargets } from "./live-output-targets";
import "./live-tally.css";
import "./LiveRowMenu.css";

/**
 * Where a graphic is among the room's screens: the screens it was put on,
 * and whether the stage display shows it anyway because it is on Program.
 * The stage display takes its question, poll and timers from Program
 * whenever it has none of its own.
 */
export interface LiveScreens {
  on: readonly LiveAuxOutput[];
  /** On Program, and the stage display shows it from there. */
  following: boolean;
}

/** A graphic that goes nowhere yet, such as a pending question or a draft poll. */
export const NO_LIVE_SCREENS: LiveScreens = { on: [], following: false };

/** Whether the stage display shows a graphic because it is on Program, not because it was put there. */
function followsProgram(targets: LiveTargets, layer: LiveLayer, where: ReturnType<typeof liveLayerTargets>): boolean {
  if (!where.program || where.aux("stage-display")) return false;
  const own = targets.state.outputs["stage-display"];
  const program = targets.state.stage;
  switch (layer.kind) {
    case "question":
      return !own.question;
    case "poll":
      // A question on the stage display, its own or Program's, takes the place of a poll.
      return !own.question && !program.question && !own.poll;
    case "timer":
      return liveStageDisplayGraphics(own, program, targets.state.timers).some(
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
    following: followsProgram(targets, layer, where),
  };
}

/** Kinds the stage display shows from Program when it has none of its own. */
const FOLLOWS_PROGRAM: ReadonlySet<LiveLayer["kind"]> = new Set(["question", "poll", "timer"]);

/** What a click on a screen's item does, in the words of the room: the audience's screen and the speaker's. */
function screenDescription(output: LiveAuxOutput, on: boolean, following: boolean, keptWhileLive: boolean): string {
  if (output === "projector")
    return on ? "On the audience screen. Click to take it off." : "Show it on the audience screen.";
  if (keptWhileLive) return "Kept on the speaker’s screen. Click to show it there only while it is live.";
  if (on) return "On the speaker’s screen. Click to take it off.";
  if (following) return "On the speaker’s screen because it is live. Click to keep it there after it goes off air.";
  return "Show it on the speaker’s screen.";
}

/** A switch per screen of the room, checked where the graphic was put, each saying what a click does. */
export function liveScreenItems(targets: LiveTargets, layer: LiveLayer): MenuItem[] {
  const { on, following } = liveScreens(targets, layer);
  const live = liveLayerTargets(targets, layer).program && FOLLOWS_PROGRAM.has(layer.kind);
  return LIVE_STUDIO_AUX_OUTPUTS.map((output) => ({
    id: `screen-${output}`,
    label: LIVE_AUX_OUTPUT_DETAILS[output].label,
    description: screenDescription(output, on.includes(output), following, live && on.includes(output)),
    checked: on.includes(output),
    multiple: true,
    keepOpen: true,
    disabled: targets.disabled,
    onSelect: () => sendLayerToggle(targets, layer, output),
  }));
}

/** The screens first, then the row's own actions after a separator. */
export function withScreenItems(screens: readonly MenuItem[], items: readonly MenuItem[]): MenuItem[] {
  return [...screens, ...items.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item))];
}

/** The trigger's tooltip: what the menu holds, then the screens the graphic is on. */
export function liveScreensTitle({ on, following }: LiveScreens): string {
  const parts = [
    on.length ? `On ${on.map((output) => LIVE_AUX_OUTPUT_DETAILS[output].label).join(" and ")}.` : null,
    following ? "On the stage display because it is live." : null,
  ].filter(Boolean);
  return ["Room screens and more actions.", ...parts].join(" ");
}

/**
 * A row menu's trigger: the ⋯, with a dot under it in each screen's color
 * for every screen the graphic is on; a ring for the stage display when it
 * shows the graphic from Program.
 */
export function LiveScreenTrigger({ screens }: { screens: LiveScreens }) {
  const { on, following } = screens;
  return (
    <>
      <span aria-hidden="true">⋯</span>
      {on.length || following ? (
        <span class="pk-live-screen-dots" aria-hidden="true">
          {on.map((output) => (
            <span key={output} data-tally={output} />
          ))}
          {following ? <span data-tally="stage-display" data-following="" /> : null}
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
