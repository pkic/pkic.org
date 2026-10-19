import { signal } from "@preact/signals";
import { memo } from "preact/compat";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import type { LiveAuxOutput } from "../../../../../../../../shared/live-room-outputs";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import { Button } from "../../../../../../../ui/Button";
import { Dialog } from "../../../../../../../ui/Dialog";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { Menu } from "../../../../../../../ui/Menu";
import { SectionHeading } from "../../../../../../../ui/SectionHeading";
import { LiveDeskStream } from "../LiveDeskStream";
import { LiveMonitorPointers, useLivePointerReport } from "../presence/LiveMonitorPointers";
import {
  STUDIO_OUTPUTS,
  STUDIO_OUTPUT_DETAILS,
  setStudioOutputLayout,
  studioOutputLayout,
  toggleStudioOutput,
  type StudioOutput,
  type StudioPanel,
} from "./studio-layout";
import type { StudioPanelView } from "./StudioGrid";
import type { StudioChange } from "./useStudioLayout";
import "../live-tally.css";
import "./MonitorPanel.css";

/** The switcher's actions the Preview and Program monitors offer with their controls. */
export interface MonitorSwitcher {
  /** Takes every graphic off one output at once; Program's clear the desk offers to undo. */
  clear: (output: StudioOutput) => void;
  disabled: boolean;
}

/** What the monitors show: the operators' shared Preview, and the room as it is on air. */
export interface MonitorSources {
  preview: LiveRoomState;
  /** The session the physical room has on air, which may be another session; null when none is. */
  program: LiveRoomState | null;
  slug: string;
  roomId: string;
  startAt: string;
}

const tally = (output: StudioOutput) =>
  output === "preview" || output === "program" ? output : output === "livestream" ? "stream" : "aux";

/** The room as one output composes it: Preview from the shared Preview, every other output from the room on air. */
const projectionOf = (output: StudioOutput, sources: MonitorSources) =>
  output === "preview" ? sources.preview : sources.program;

/** Whether an output's composition holds any graphic; stage screens always draw their own clock and notes. */
function showsGraphics(output: StudioOutput, state: LiveRoomState): boolean {
  if (output === "stage-display" || output === "stage-preview") return true;
  const composition: Record<string, unknown> =
    output === "preview" || output === "program" ? state.stage : state.outputs[output as LiveAuxOutput];
  return Object.entries(composition).some(
    ([key, value]) =>
      value !== null &&
      !(Array.isArray(value) && value.length === 0) &&
      !key.endsWith("Change") &&
      key !== "lowerThirdMotion",
  );
}

/** The parts of the room an output's picture is drawn from; anything else changing leaves the picture alone. */
function samePicture(output: StudioOutput, left: LiveRoomState | null, right: LiveRoomState | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const composition = (state: LiveRoomState) =>
    output === "preview" || output === "program" || output === "livestream" ? state.stage : state.outputs[output];
  return (
    composition(left) === composition(right) &&
    left.timers === right.timers &&
    left.polls === right.polls &&
    left.session === right.session &&
    left.overlayLayouts === right.overlayLayouts &&
    left.burst === right.burst &&
    left.speakerMessage === right.speakerMessage
  );
}

/**
 * One output's picture. It renders again only when its own composition or
 * what it draws from changes, so chat, questions and presence, and resizing
 * the panel around it, leave it alone.
 */
const Screen = memo(
  function Screen({ output, layout, sources }: { output: StudioOutput; layout: string; sources: MonitorSources }) {
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

/** The monitor enlarged to the whole window, by panel and output; one at a time across the studio. */
const enlarged = signal<string | null>(null);
const enlargedKey = (panelId: string, output: StudioOutput) => `${panelId}:${output}`;

interface MonitorContext {
  panel: StudioPanel;
  sources: MonitorSources;
  switcher: MonitorSwitcher;
  change: StudioChange;
}

/** The overlay layout a monitor draws its output in, beside the output's name. */
function LayoutPicker({ output, context }: { output: StudioOutput; context: MonitorContext }) {
  const { panel, sources, change } = context;
  if (output === "livestream") return null;
  const details = STUDIO_OUTPUT_DETAILS[output];
  const layout = studioOutputLayout(panel, output);
  const choices = liveOverlayLayoutChoices(sources.preview.overlayLayouts);
  const current = choices.find((choice) => choice.slug === layout) ?? choices[0]!;
  return (
    <Menu
      variant="plain"
      label={`Layout on ${details.label}: ${current.name}`}
      title="Choose layout"
      triggerClass="pk-studio-monitor__picker pk-studio-monitor__layout"
      heading="Show as the layout"
      items={choices.map((choice) => ({
        id: choice.slug,
        label: choice.name,
        checked: choice.slug === current.slug,
        onSelect: () => change((panels) => setStudioOutputLayout(panels, panel.id, output, choice.slug)),
      }))}
    >
      {current.name}
      <span aria-hidden="true"> ▾</span>
    </Menu>
  );
}

/** What an operator does with one monitor's output, as icons at the end of its header: clear it, and full screen. */
function MonitorActions({ output, context }: { output: StudioOutput; context: MonitorContext }) {
  const { panel, switcher } = context;
  const details = STUDIO_OUTPUT_DETAILS[output];
  return (
    <span class="pk-studio-monitor__controls">
      {output === "livestream" ? null : (
        <Button
          icon
          variant="ghost"
          disabled={switcher.disabled}
          aria-label={`Clear ${details.label}`}
          title={
            output === "program"
              ? "Clear Program: remove every graphic at once. You can undo it for a few seconds."
              : `Clear ${details.label}: remove every graphic`
          }
          onClick={() => switcher.clear(output)}
        >
          <ClearIcon />
        </Button>
      )}
      <Button
        icon
        variant="ghost"
        aria-label={`Full screen ${details.label}`}
        title="Full screen"
        onClick={() => (enlarged.value = enlargedKey(panel.id, output))}
      >
        <ExpandIcon />
      </Button>
    </span>
  );
}

/** The output's tally tag and its switcher abbreviation, PVW or PGM; the full name on hover. */
function OutputName({ output }: { output: StudioOutput }) {
  const details = STUDIO_OUTPUT_DETAILS[output];
  return (
    <span class="pk-studio-monitor__name" data-tally={tally(output)}>
      <span class="pk-studio-monitor__dot" aria-hidden="true" />
      <abbr class="pk-studio-monitor__label" title={details.label}>
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
  const { panel, sources } = context;
  const details = STUDIO_OUTPUT_DETAILS[output];
  const layout = studioOutputLayout(panel, output);
  const pointer = useLivePointerReport(output);
  const key = enlargedKey(panel.id, output);
  return (
    <>
      <div class="pk-studio-monitor__screen" onDblClick={() => (enlarged.value = key)} {...pointer}>
        <Screen output={output} layout={layout} sources={sources} />
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
          <div class="pk-studio-monitor__screen" data-tally={tally(output)} {...pointer}>
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
  const details = STUDIO_OUTPUT_DETAILS[output];
  return (
    <figure class="pk-studio-monitor__tile" data-tally={tally(output)}>
      <figcaption class="pk-studio-monitor__caption">
        <span class="pk-studio-monitor__output" title={details.purpose}>
          <OutputName output={output} />
        </span>
        <LayoutPicker output={output} context={context} />
        <span class="pk-studio-monitor__purpose">{details.purpose}</span>
        <MonitorActions output={output} context={context} />
      </figcaption>
      <MonitorScreen output={output} context={context} />
    </figure>
  );
}

/** A free place in a multiview, which adds one of the outputs not shown yet. */
function FreeSlot({ missing, context }: { missing: readonly StudioOutput[]; context: MonitorContext }) {
  const { panel, change } = context;
  return (
    <div class="pk-studio-monitor__free">
      <Menu
        variant="plain"
        label="Add an output to this multiview"
        triggerClass="pk-studio-monitor__add"
        heading="Add an output"
        items={missing.map((output) => ({
          id: output,
          label: STUDIO_OUTPUT_DETAILS[output].label,
          onSelect: () => change((panels) => toggleStudioOutput(panels, panel.id, output)),
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
  const outputs = panel.outputs ?? ["program"];
  const single = outputs.length === 1 ? outputs[0]! : null;
  const title = single ? STUDIO_OUTPUT_DETAILS[single].label : "Monitors";
  const context: MonitorContext = { panel, sources, switcher, change };
  const heading = (
    <SectionHeading level={3} class="pk-studio-panel__title">
      <Menu
        variant="plain"
        label={`Outputs on ${title}`}
        title="Choose outputs"
        triggerClass="pk-studio-monitor__picker pk-studio-monitor__output"
        heading="Show one or more"
        items={STUDIO_OUTPUTS.map((output) => ({
          id: output,
          label: STUDIO_OUTPUT_DETAILS[output].label,
          checked: outputs.includes(output),
          multiple: true,
          keepOpen: true,
          disabled: outputs.length === 1 && outputs[0] === output,
          onSelect: () => change((panels) => toggleStudioOutput(panels, panel.id, output)),
        }))}
      >
        {single ? <OutputName output={single} /> : title}
        <span aria-hidden="true"> ▾</span>
      </Menu>
    </SectionHeading>
  );
  if (single)
    return {
      title,
      heading: (
        <span class="pk-studio-monitor__heading">
          {heading}
          <LayoutPicker output={single} context={context} />
        </span>
      ),
      actions: <MonitorActions output={single} context={context} />,
      body: (
        <div class="pk-studio-monitor-frame">
          <div class="pk-studio-monitor" data-single="" data-tally={tally(single)}>
            <MonitorScreen output={single} context={context} />
          </div>
        </div>
      ),
    };
  const { columns, rows } = multiviewGrid(outputs.length);
  const missing = STUDIO_OUTPUTS.filter((output) => !outputs.includes(output));
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
