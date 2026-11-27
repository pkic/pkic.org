import { signal } from "@preact/signals";
import { memo } from "preact/compat";
import { useRef } from "preact/hooks";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import {
  LIVE_STAGE_PREVIEW_OUTPUT,
  liveOutputFixedScene,
  liveOutputRole,
  liveRoomOutputs,
  type LiveAuxOutput,
} from "../../../../../../../../shared/live-room-outputs";
import { liveScreenSyncs } from "../../../../../../../../shared/live-screen-sync";
import type { AgendaSnapshot } from "../../../../../../../../shared/schemas/event-agenda";
import type { LiveRoomOutput } from "../../../../../../../../shared/schemas/live-room-output-setup";
import type { LiveScreenSync, LiveSyncedScreen } from "../../../../../../../../shared/schemas/live-screen-sync";
import { liveOutputComposition } from "../../../../../../../../shared/schemas/live-session-stage";
import { liveOutputProjection, liveOutputScene } from "../../../../../../../live-session/live-output-projection";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import { Button } from "../../../../../../../ui/Button";
import { Dialog } from "../../../../../../../ui/Dialog";
import { IconSound, StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { Menu } from "../../../../../../../ui/Menu";
import { SectionHeading } from "../../../../../../../ui/SectionHeading";
import { LiveDeskStream } from "../LiveDeskStream";
import { LiveMonitorPointers, useLivePointerReport } from "../presence/LiveMonitorPointers";
import {
  studioMonitorChoices,
  setStudioPanelScenes,
  studioOutputDetails,
  studioOutputLayout,
  studioShownOutputs,
  toggleStudioOutput,
  type StudioOutput,
  type StudioPanel,
} from "./studio-layout";
import type { StudioPanelView } from "./StudioGrid";
import { ScenePicker } from "./ScenePicker";
import { SceneStrip } from "./SceneStrip";
import type { StudioChange } from "./useStudioLayout";
import { setStudioLivestreamSound, studioLivestreamAudible } from "./studio-livestream-sound";
import { liveTallyAttributes } from "../live-tally";
import "../live-tally.css";
import { SourceCount, SyncToggle } from "./MonitorOutputStatus";
import { liveSceneName } from "../live-layer-unseen";
import { clearHint } from "./StudioSwitcher";
import { usePictureInView } from "./use-picture-in-view";
import { PreviewSceneCanvas, PreviewSceneLock, PreviewSceneSave, previewSceneEditing } from "./PreviewSceneEditor";
import "./MonitorPanel.css";

/** The switcher's actions the Preview and Program monitors offer with their controls. */
export interface MonitorSwitcher {
  /** Takes every graphic off one output at once; Program's clear the desk offers to undo. */
  clear: (output: StudioOutput) => void;
  /** Whether the projector and the stage display follow Program, and the switch for each. */
  screenSync: LiveScreenSync;
  sync: (output: LiveSyncedScreen, sync: boolean) => void;
  /** Loads a scene into Preview; the next Take puts it on Program with Preview's graphics. */
  previewScene: (scene: string) => void;
  /** Changes the scene one of the room's screens draws, at once and for everyone. */
  screenScene: (output: LiveAuxOutput, scene: string) => void;
  disabled: boolean;
  /** Whether this operator sets up the live studio, and so may edit the event's scenes from Preview. */
  canEditScenes?: boolean;
  /** Copies the scene on Preview and unlocks the copy; absent for someone who may not change scenes. */
  duplicateScene?: () => void;
}

/** What the monitors show: the operators' shared Preview, and the room as it is on air. */
export interface MonitorSources {
  preview: LiveRoomState;
  /** The session the physical room has on air, which may be another session; null when none is. */
  program: LiveRoomState | null;
  /** The approved agenda, which the scene thumbnails fill Up next and the ticker from; null before the first approval. */
  agenda: AgendaSnapshot | null;
  /** Whether the studio reaches the room now; while it does not, the monitors hold their last picture. */
  connected: boolean;
  slug: string;
  roomId: string;
  startAt: string;
}

/** The outputs the room sets up, which name and color the monitors' outputs. */
const roomOf = (sources: MonitorSources) => liveRoomOutputs(sources.preview.session);

/** The room as one output composes it: Preview from the shared Preview, every other output from the room on air. */
const projectionOf = (output: StudioOutput, sources: MonitorSources) =>
  output === "preview" ? sources.preview : sources.program;

/** Composition keys that only say how a graphic looks, never that one is on. */
const GRAPHIC_SETTINGS: ReadonlySet<string> = new Set(["lowerThirdMotion", "reactionsGraphic"]);

/** Whether an output's composition holds any graphic; stage screens always draw their own clock and notes. */
function showsGraphics(output: StudioOutput, state: LiveRoomState): boolean {
  if (output === LIVE_STAGE_PREVIEW_OUTPUT || liveOutputRole(liveRoomOutputs(state.session), output) === "speaker")
    return true;
  const composition: Record<string, unknown> =
    output === "preview" || output === "program"
      ? state.stage
      : liveOutputProjection(state, output as LiveAuxOutput).stage;
  return Object.entries(composition).some(
    ([key, value]) =>
      value !== null &&
      value !== false &&
      !(Array.isArray(value) && value.length === 0) &&
      !key.endsWith("Change") &&
      !GRAPHIC_SETTINGS.has(key),
  );
}

/** The parts of the room an output's picture is drawn from; anything else changing leaves the picture alone. */
function samePicture(output: StudioOutput, left: LiveRoomState | null, right: LiveRoomState | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const composition = (state: LiveRoomState) =>
    output === "preview" || output === "program" || output === "livestream"
      ? state.stage
      : liveOutputComposition(state.outputs, output);
  return (
    composition(left) === composition(right) &&
    left.timers === right.timers &&
    left.polls === right.polls &&
    left.session === right.session &&
    left.overlayLayouts === right.overlayLayouts &&
    left.burst === right.burst &&
    left.speakerMessage === right.speakerMessage &&
    // A room screen that syncs also draws what is on Program, and the question lined up next.
    (output === "preview" ||
      output === "program" ||
      output === "livestream" ||
      (left.stage === right.stage &&
        left.screenSync === right.screenSync &&
        left.stageDisplayNext === right.stageDisplayNext))
  );
}

/**
 * One output's picture. It renders again only when its own composition or
 * what it draws from changes, so chat, questions and presence, and resizing
 * the panel around it, leave it alone.
 */
const Screen = memo(
  function Screen({
    output,
    layout,
    sources,
  }: {
    output: StudioOutput;
    layout: string | null;
    sources: MonitorSources;
  }) {
    if (output === "livestream")
      return <LiveDeskStream slug={sources.slug} roomId={sources.roomId} startAt={sources.startAt} />;
    const projection = projectionOf(output, sources);
    if (!projection) return <p class="pk-studio-monitor__idle">Nothing on air</p>;
    const picture = (
      <LiveOverlayPresentation
        view={output === "preview" || output === "program" ? "program" : output}
        layout={layout}
        projection={projection}
        roomId={sources.roomId}
        eventSlug={sources.slug}
      />
    );
    // An output showing no graphic says so in the picture, rather than looking like a broken screen.
    if (!showsGraphics(output, projection))
      return (
        <>
          {picture}
          <p class="pk-studio-monitor__idle">
            {output === "preview" ? "Nothing in preview" : "No graphics on this output"}
          </p>
        </>
      );
    return picture;
  },
  (previous, next) =>
    previous.output === next.output &&
    previous.layout === next.layout &&
    previous.sources.slug === next.sources.slug &&
    previous.sources.roomId === next.sources.roomId &&
    previous.sources.startAt === next.sources.startAt &&
    samePicture(next.output, projectionOf(previous.output, previous.sources), projectionOf(next.output, next.sources)),
);

/** One output's picture, saying so when it shows nothing; the phone's enlarged thumbnails draw the same. */
export { Screen as StudioOutputScreen };

/** Clear: an eraser, distinct from a panel's close cross. */
export function ClearIcon() {
  return (
    <StrokeIcon>
      <path d="M4.7 14 1.8 11.1c-.7-.7-.7-1.7 0-2.3l6.4-6.4c.7-.7 1.7-.7 2.3 0l3.7 3.7c.7.7.7 1.7 0 2.3L8.7 14" />
      <path d="M14.7 14h-10M3.3 7.3l6 6" />
    </StrokeIcon>
  );
}

export function ExpandIcon() {
  return (
    <StrokeIcon>
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
    </StrokeIcon>
  );
}

/** Sound on the LIVE monitor: muted until the operator turns it on, and kept that way in their browser. */
function LivestreamSoundToggle() {
  const audible = studioLivestreamAudible();
  const label = audible ? "Mute Livestream" : "Unmute Livestream";
  const hint = audible
    ? "Livestream sound: on\nClick to mute it. Only this browser plays it."
    : "Livestream sound: off\nClick to hear the livestream in this browser.";
  return (
    <Button icon variant="ghost" aria-label={label} title={hint} onClick={() => setStudioLivestreamSound(!audible)}>
      <IconSound audible={audible} />
    </Button>
  );
}

/** The monitor enlarged to the whole window, by panel and output; one at a time across the studio. */
const enlarged = signal<string | null>(null);
const enlargedKey = (panelId: string, output: StudioOutput) => `${panelId}:${output}`;

interface MonitorContext {
  panel: StudioPanel;
  room: readonly LiveRoomOutput[];
  sources: MonitorSources;
  switcher: MonitorSwitcher;
  change: StudioChange;
}

/**
 * The scene an output draws, beside the output's name, and the way to
 * change it: Preview's for the buses, the screen's own for a room screen. A
 * screen its room locked to a scene, the speaker's screen and the stage
 * preview offer none.
 */
function LayoutPicker({ output, context }: { output: StudioOutput; context: MonitorContext }) {
  const { sources, switcher, room } = context;
  if (output === "livestream" || output === LIVE_STAGE_PREVIEW_OUTPUT) return null;
  if (output === "preview" || output === "program")
    return (
      <ScenePicker
        output={output}
        sources={sources}
        disabled={context.switcher.disabled}
        onScene={context.switcher.previewScene}
      />
    );
  if (liveOutputRole(room, output) === "speaker" || liveOutputFixedScene(room, output)) return null;
  const details = studioOutputDetails(room, output);
  const layout = liveOutputScene(projectionOf(output, sources), output);
  const choices = liveOverlayLayoutChoices(sources.preview.overlayLayouts);
  const current = choices.find((choice) => choice.slug === layout) ?? choices[0]!;
  return (
    <Menu
      variant="plain"
      label={`Scene on ${details.label}: ${current.name}`}
      title={`Scene on ${details.label}: ${current.name}\nChoose a scene to change it on ${details.label} at once. What is on ${details.label} stays, and what comes on with the scene goes on.`}
      triggerClass="pk-studio-monitor__picker pk-studio-monitor__layout"
      heading={`Scene on ${details.label}`}
      items={choices.map((choice) => ({
        id: choice.slug,
        label: choice.name,
        checked: choice.slug === current.slug,
        disabled: switcher.disabled,
        onSelect: () => switcher.screenScene(output, choice.slug),
      }))}
    >
      <LayoutIcon />
    </Menu>
  );
}

/** A frame with its graphics' boxes: the layout an output is drawn in, named in its tooltip. */
export function LayoutIcon() {
  return (
    <StrokeIcon>
      <rect x="1.5" y="3" width="13" height="10" rx="1" />
      <path d="M4 10.5h5M10.5 5.5h2" />
    </StrokeIcon>
  );
}

/**
 * What an operator does with one monitor's output, at the end of its header:
 * its sync chip, then clear it, and full screen. Preview's scene open to edit
 * has no full screen: its canvas stands in for the picture.
 */
function MonitorActions({
  output,
  context,
  editing = false,
}: {
  output: StudioOutput;
  context: MonitorContext;
  editing?: boolean;
}) {
  const { panel, switcher, room } = context;
  const details = studioOutputDetails(room, output);
  const role = isBusOutput(output) ? null : liveOutputRole(room, output);
  return (
    <span class="pk-studio-monitor__controls">
      {/* The sync chip leads, so the count and the icons keep the same place on every monitor. */}
      {role === "follow" || role === "speaker" ? <SyncToggle output={output} room={room} switcher={switcher} /> : null}
      <SourceCount output={output} room={room} sources={context.sources} />
      {output === "preview" && switcher.canEditScenes ? <PreviewSceneSave /> : null}
      {output === "livestream" ? (
        <LivestreamSoundToggle />
      ) : (
        <Button
          icon
          variant="ghost"
          disabled={switcher.disabled}
          aria-label={`Clear ${details.label}`}
          title={clearHint(
            output === "program" || output === "preview" ? output : "screen",
            details.label,
            liveSceneName(context.sources.preview, null),
          )}
          onClick={() => switcher.clear(output)}
        >
          <ClearIcon />
        </Button>
      )}
      {editing ? null : (
        <Button
          icon
          variant="ghost"
          aria-label={`Full screen ${details.label}`}
          title={`Full screen ${details.label}\nShow this monitor large. Double-clicking its picture does the same.`}
          onClick={() => (enlarged.value = enlargedKey(panel.id, output))}
        >
          <ExpandIcon />
        </Button>
      )}
    </span>
  );
}

const isBusOutput = (output: StudioOutput) => output === "preview" || output === "program" || output === "livestream";

/**
 * The tag beside a room output's code: the scene an output you take to
 * shows, "Follows PGM" for one that syncs with Program, "Speaker" for the
 * speaker's screen. The buses and the stage preview keep their purpose.
 */
function outputTag(output: StudioOutput, context: MonitorContext): { text: string; hint?: string } {
  const { room, sources, switcher } = context;
  const details = studioOutputDetails(room, output);
  if (isBusOutput(output) || output === LIVE_STAGE_PREVIEW_OUTPUT) return { text: details.purpose };
  const role = liveOutputRole(room, output);
  if (role === "speaker")
    return {
      text: "Speaker",
      hint: "Speaker's screen\nShows the time, the next question and your messages to the speaker.",
    };
  if (role === "follow")
    return liveScreenSyncs(switcher.screenSync, room, output)
      ? {
          text: "Follows PGM",
          hint: "Follows Program\nWhat you change on Program changes here too, in this screen's own scene. A Transition to it shows Preview exactly. The PGM chip turns this off.",
        }
      : {
          text: "Sync off",
          hint: "Sync with Program is off\nThis screen stays as it is until you change it. The PGM chip turns sync back on.",
        };
  const scene = liveOutputScene(projectionOf(output, sources), output);
  const choices = liveOverlayLayoutChoices(sources.preview.overlayLayouts);
  const name = (choices.find((choice) => choice.slug === scene) ?? choices[0]!).name;
  return {
    text: name,
    hint: `Scene on ${details.label}: ${name}\nTransition to ${details.label} puts Preview's scene on it.`,
  };
}

/** The output's tally tag and its switcher abbreviation, PVW or PGM; its full name and purpose on hover. */
function OutputName({ output, room }: { output: StudioOutput; room: readonly LiveRoomOutput[] }) {
  const details = studioOutputDetails(room, output);
  return (
    <span class="pk-studio-monitor__name" {...liveTallyAttributes(room, output)}>
      <span class="pk-studio-monitor__dot" aria-hidden="true" />
      <abbr class="pk-studio-monitor__label" title={`${details.short} · ${details.label}\n${details.purpose}`}>
        {details.short}
      </abbr>
    </span>
  );
}

/**
 * One output's picture at 16:9, with other operators' pointers on it, and
 * the whole-window view it opens to.
 */
function MonitorScreen({ output, context }: { output: StudioOutput; context: MonitorContext }) {
  const { panel, sources, room } = context;
  const details = studioOutputDetails(room, output);
  const layout = studioOutputLayout(output);
  const pointer = useLivePointerReport(output);
  const key = enlargedKey(panel.id, output);
  // A monitor out of sight keeps its place and draws nothing until it comes into view.
  const screen = useRef<HTMLDivElement>(null);
  const inView = usePictureInView(screen);
  return (
    <>
      <div ref={screen} class="pk-studio-monitor__screen" onDblClick={() => (enlarged.value = key)} {...pointer}>
        {inView ? <Screen output={output} layout={layout} sources={sources} /> : null}
        <LiveMonitorPointers output={output} />
      </div>
      {enlarged.value === key ? (
        <Dialog
          open
          viewer
          class="pk-studio-monitor__viewer"
          title={details.label}
          closeLabel={`Close ${details.label}`}
          confirmLabel="Close"
          onConfirm={() => (enlarged.value = null)}
          onCancel={() => (enlarged.value = null)}
        >
          <div class="pk-studio-monitor__screen" {...liveTallyAttributes(room, output)} {...pointer}>
            <Screen output={output} layout={layout} sources={sources} />
            <LiveMonitorPointers output={output} />
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

/**
 * One output of a multiview: a card no wider than its picture, its name and
 * controls in the card's own header so they plainly belong to it.
 */
function MonitorTile({ output, context }: { output: StudioOutput; context: MonitorContext }) {
  const { room } = context;
  const tag = outputTag(output, context);
  return (
    <figure class="pk-studio-monitor__tile" {...liveTallyAttributes(room, output)}>
      <figcaption class="pk-studio-monitor__caption">
        <span class="pk-studio-monitor__output">
          <OutputName output={output} room={room} />
        </span>
        <LayoutPicker output={output} context={context} />
        {/* Program names its scene in this place instead. */}
        {output === "program" ? null : (
          <span class="pk-studio-monitor__purpose" title={tag.hint}>
            {tag.text}
          </span>
        )}
        <MonitorActions output={output} context={context} />
      </figcaption>
      <MonitorScreen output={output} context={context} />
    </figure>
  );
}

/** A free place in a multiview, which adds one of the outputs not shown yet. */
function FreeSlot({ missing, context }: { missing: readonly StudioOutput[]; context: MonitorContext }) {
  const { panel, change, room } = context;
  return (
    <div class="pk-studio-monitor__free">
      <Menu
        variant="plain"
        label="Add an output to this multiview"
        triggerClass="pk-studio-monitor__add"
        heading="Add an output"
        items={missing.map((output) => ({
          id: output,
          label: studioOutputDetails(room, output).label,
          onSelect: () => change((panels) => toggleStudioOutput(panels, panel.id, output, room)),
        }))}
      >
        <span aria-hidden="true">+</span> Add output
      </Menu>
    </div>
  );
}

/** The grid a multiview lays its outputs on: as square as it can be, two or three across. */
export function multiviewGrid(count: number): { columns: number; rows: number } {
  const columns = count <= 4 ? 2 : 3;
  return { columns, rows: Math.ceil(count / columns) };
}

/**
 * A monitor shows one output, or several as a multiview. The panel's header
 * holds the one output selector; a single monitor's controls sit beside it,
 * and each output of a multiview carries its own in its card.
 */
export function monitorPanelView(
  panel: StudioPanel,
  sources: MonitorSources,
  change: StudioChange,
  switcher: MonitorSwitcher,
): StudioPanelView {
  const room = roomOf(sources);
  const outputs = studioShownOutputs(panel.outputs ?? ["program"], room);
  const single = outputs.length === 1 ? outputs[0]! : null;
  const title = single ? studioOutputDetails(room, single).label : "Monitors";
  const context: MonitorContext = { panel, room, sources, switcher, change };
  const heading = (
    <SectionHeading level={3} class="pk-studio-panel__title">
      <Menu
        variant="plain"
        label={`Outputs on ${title}`}
        title={"Monitors in this panel\nChoose which outputs it shows: one, or several side by side."}
        triggerClass="pk-studio-monitor__picker pk-studio-monitor__output"
        heading="Show one or more"
        items={studioMonitorChoices(outputs, room).map((output) => ({
          id: output,
          label: studioOutputDetails(room, output).label,
          checked: outputs.includes(output),
          multiple: true,
          keepOpen: true,
          disabled: outputs.length === 1 && outputs[0] === output,
          onSelect: () => change((panels) => toggleStudioOutput(panels, panel.id, output, room)),
        }))}
      >
        {single ? <OutputName output={single} room={room} /> : title}
        <span aria-hidden="true"> ▾</span>
      </Menu>
    </SectionHeading>
  );
  // Preview shows the scenes under its picture unless the operator hid them.
  const scenesShown = panel.scenes !== false;
  const editing = single === "preview" && switcher.canEditScenes && previewSceneEditing.value;
  if (single)
    return {
      title,
      heading: (
        <span class="pk-studio-monitor__heading">
          {heading}
          {single === "preview" && switcher.canEditScenes ? <PreviewSceneLock disabled={switcher.disabled} /> : null}
          <LayoutPicker output={single} context={context} />
        </span>
      ),
      actions: <MonitorActions output={single} context={context} editing={editing} />,
      menu:
        single === "preview"
          ? [
              {
                id: "scenes",
                label: scenesShown ? "Hide scenes" : "Show scenes",
                tooltip: "The scene thumbnails under Preview. The scene picker in the header stays either way.",
                onSelect: () => change((panels) => setStudioPanelScenes(panels, panel.id, !scenesShown)),
              },
              ...(switcher.duplicateScene
                ? [
                    {
                      id: "duplicate-scene",
                      label: "Duplicate scene",
                      tooltip: "Copy the scene on Preview and edit the copy. The original stays as it is.",
                      disabled: switcher.disabled,
                      onSelect: switcher.duplicateScene,
                    },
                  ]
                : []),
            ]
          : undefined,
      body: (
        <div class="pk-studio-monitor-stack">
          <div class="pk-studio-monitor-frame">
            {editing ? (
              <PreviewSceneCanvas />
            ) : (
              <div class="pk-studio-monitor" data-single="" {...liveTallyAttributes(room, single)}>
                <MonitorScreen output={single} context={context} />
              </div>
            )}
          </div>
          {single === "preview" && scenesShown ? (
            <SceneStrip sources={sources} disabled={switcher.disabled} onScene={switcher.previewScene} />
          ) : null}
        </div>
      ),
    };
  const { columns, rows } = multiviewGrid(outputs.length);
  const missing = studioMonitorChoices(outputs, room).filter((output) => !outputs.includes(output));
  const free = missing.length ? Math.min(columns * rows - outputs.length, missing.length) : 0;
  return {
    title,
    heading,
    body: (
      <div class="pk-studio-monitor-frame">
        <div class="pk-studio-monitor" data-columns={columns} data-rows={rows}>
          {outputs.map((output) => (
            <MonitorTile key={output} output={output} context={context} />
          ))}
          {Array.from({ length: free }, (_, index) => (
            <FreeSlot key={`free-${index}`} missing={missing} context={context} />
          ))}
        </div>
      </div>
    ),
  };
}
