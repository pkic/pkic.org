/**
 * The audience on screen, as the studio controls it and the room sees it:
 * the LIVE monitor with its sound toggle, the Graphics panel's rows for top
 * questions, chat and reactions, those graphics on a projector screen and
 * on the livestream overlay, sized in the layout settings, and the reaction
 * bar attendees press. Synthetic room, fixed clock.
 */
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { PreviewSection } from "./PreviewShell";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  type LiveStage,
} from "../../../shared/schemas/live-session-room";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
} from "../../../shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_ELEMENTS,
  liveOverlayPixelBox,
  type LiveOverlayLayout,
  type LiveOverlayLayoutElements,
} from "../../../shared/schemas/live-overlay-layout";
import { OverlayLayoutEditor } from "../../member-flows/portal/sections/events/detail/settings/live-layouts/OverlayLayoutEditor";
import { ScreenView } from "../../event-screens/ScreenApp";
import { LiveReactionBar } from "../../live-session/LiveReactionBar";
import { LiveOverlayPresentation } from "../../live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { GraphicsPanel } from "../../member-flows/portal/sections/events/detail/live/studio/GraphicsPanel";
import { monitorPanelView } from "../../member-flows/portal/sections/events/detail/live/studio/MonitorPanel";
import { StudioPanelFrame } from "../../member-flows/portal/sections/events/detail/live/studio/StudioPanelFrame";
import type { StudioPanel } from "../../member-flows/portal/sections/events/detail/live/studio/studio-layout";
import { sampleOverlayRoom } from "../../member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";
import "../../member-flows/portal/sections/events/detail/live/studio/StudioGrid.css";
import "../../member-flows/portal/sections/events/detail/settings/live-layouts/OverlayLayouts.css";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";
import "./event-screens-preview.css";

const noCommand = () => undefined;
const noHandlers = {
  onPointerDown: noCommand,
  onPointerMove: noCommand,
  onPointerUp: noCommand,
  onPointerCancel: noCommand,
  onLostPointerCapture: noCommand,
};

const ROOM = sampleOverlayRoom(SCREEN_FIXTURE_NOW);
const LISTS: Pick<LiveStage, "topQuestions" | "chatFeed"> = {
  topQuestions: {
    config: { count: 3 },
    questions: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        text: "How do we find every certificate we depend on before the migration starts?",
        authorName: "Riley Sample",
        votes: 24,
      },
      {
        id: "40000000-0000-4000-8000-000000000002",
        text: "Which algorithms should we pilot first in a private CA?",
        authorName: null,
        votes: 17,
      },
      {
        id: "40000000-0000-4000-8000-000000000003",
        text: "Is hybrid signing worth the extra certificate size on constrained devices?",
        authorName: "Jordan Placeholder",
        votes: 9,
      },
    ],
  },
  chatFeed: {
    config: { count: 4, delaySeconds: 10 },
    messages: [
      {
        id: "40000000-0000-4000-8000-000000000011",
        authorName: "Alex Example",
        text: "Great overview of the inventory step.",
      },
      {
        id: "40000000-0000-4000-8000-000000000012",
        authorName: "Casey Demo",
        text: "Will the slides be shared after the session?",
      },
      {
        id: "40000000-0000-4000-8000-000000000013",
        authorName: "Riley Sample",
        text: "Our HSM vendor said the same about firmware updates.",
      },
      {
        id: "40000000-0000-4000-8000-000000000014",
        authorName: "Pat Panelist",
        text: "Room B is full, watching the stream from the foyer.",
      },
    ],
  },
};

/**
 * An organizer's layout for the room's projector during Q&A: top questions
 * large on the left, reactions up the right, every other element hidden. It
 * is sized in the event's layout settings like any other card.
 */
const FULL_FRAME = LIVE_OVERLAY_PRESET_LAYOUTS["full-frame"].elements;
const QA_ELEMENTS = Object.fromEntries(
  LIVE_OVERLAY_ELEMENTS.map((element) => [
    element,
    { ...FULL_FRAME[element], visible: element === "topQuestions" || element === "reactions" },
  ]),
) as LiveOverlayLayoutElements;
QA_ELEMENTS.topQuestions = {
  visible: true,
  shared: false,
  ...liveOverlayPixelBox(96, 96, 1400, 888, { horizontal: "left", vertical: "middle" }),
};
const QA_LAYOUT: LiveOverlayLayout = {
  slug: "projector-qa",
  name: "Projector Q&A",
  preset: "full-frame",
  builtIn: false,
  saved: true,
  elements: QA_ELEMENTS,
  updatedAt: "2026-11-30T09:00:00.000Z",
};

const QUESTIONS_FIVE = [
  ...LISTS.topQuestions!.questions,
  {
    id: "40000000-0000-4000-8000-000000000004",
    text: "How long should we keep classical fallback chains around?",
    authorName: "Casey Demo",
    votes: 6,
  },
  {
    id: "40000000-0000-4000-8000-000000000005",
    text: "Does the PQC Maturity Model cover HSM firmware?",
    authorName: null,
    votes: 4,
  },
];

/** The room with only the audience graphics on: on the projector's own composition, and on Program. */
function roomWith(projector: Partial<LiveStage>, program: Partial<LiveStage> = {}): LiveRoomState {
  return {
    ...ROOM,
    overlayLayouts: [{ slug: QA_LAYOUT.slug, name: QA_LAYOUT.name, elements: QA_LAYOUT.elements }],
    stage: { ...EMPTY_LIVE_AUX_COMPOSITION, ...program },
    outputs: { ...EMPTY_LIVE_OUTPUTS, projector: { ...EMPTY_LIVE_AUX_COMPOSITION, ...projector } },
  };
}

/** A projector screen at the venue, drawn through the screen's own display code. */
function ProjectorScreen({ state, layout = null }: { state: LiveRoomState; layout?: string | null }) {
  return (
    <div class="pk-preview__screen">
      <ScreenView
        screenId={SCREEN_FIXTURE.screenId}
        now={SCREEN_FIXTURE_NOW}
        display={{
          kind: "output",
          output: "projector",
          layout,
          roomId: SCREEN_FIXTURE.roomId,
          state,
          marker: null,
        }}
      />
    </div>
  );
}

/** The livestream overlay over a stand-in for the camera, as the production software composes it. */
function LivestreamOverlay({ state }: { state: LiveRoomState }) {
  return (
    <div class="pk-preview__screen pk-preview__camera">
      <LiveOverlayPresentation view="program" projection={state} broadcast />
    </div>
  );
}

/** Viewers reacting all the time, so a still picture catches reactions on their way up. */
function Reacting({ state, children }: { state: LiveRoomState; children: (state: LiveRoomState) => JSX.Element }) {
  const [sequence, setSequence] = useState(1);
  useEffect(() => {
    const next = setInterval(() => setSequence((value) => value + 1), 450);
    return () => clearInterval(next);
  }, []);
  const counts = [
    { applause: 2, thumbs_up: 1 },
    { love: 1, applause: 1 },
    { thumbs_up: 2, mind_blown: 1 },
  ][sequence % 3]!;
  return children({ ...state, burst: { sequence, counts } });
}

const LIVE_PANEL: StudioPanel = { id: "live-1", type: "monitor", x: 0, y: 0, w: 6, h: 9, outputs: ["livestream"] };
const MONITOR_SOURCES = {
  preview: ROOM,
  program: ROOM,
  slug: "pqc-conference-2026",
  roomId: SCREEN_FIXTURE.roomId,
  startAt: ROOM.session.startAt,
};

/** The LIVE monitor as an operator opens it; the box stands in for the YouTube player. */
function LiveMonitor() {
  const view = monitorPanelView(LIVE_PANEL, MONITOR_SOURCES, noCommand, { clear: noCommand, disabled: false });
  return (
    <div class="pk-studio-grid-frame" data-density="compact">
      <div class="pk-studio-grid">
        <StudioPanelFrame
          panel={LIVE_PANEL}
          panels={[LIVE_PANEL]}
          title={view.title}
          heading={view.heading}
          actions={view.actions}
          change={noCommand}
          defaultSize={{ w: 6, h: 9 }}
          cell={noCommand}
          dragHandle={noHandlers}
          resizeHandle={() => noHandlers}
        >
          <div class="pk-studio-monitor-frame">
            <div class="pk-studio-monitor" data-single="" data-tally="stream">
              <div class="pk-studio-monitor__screen">
                <p class="pk-studio-monitor__idle">Livestream player, playing muted</p>
              </div>
            </div>
          </div>
        </StudioPanelFrame>
      </div>
    </div>
  );
}

const GRAPHICS_PANEL: StudioPanel = { id: "graphics-1", type: "graphics", x: 0, y: 0, w: 6, h: 14 };

function Graphics() {
  const state = roomWith({ topQuestions: LISTS.topQuestions, reactions: true }, { chatFeed: LISTS.chatFeed });
  return (
    <div class="pk-studio-grid-frame" data-density="compact">
      <div class="pk-studio-grid">
        <StudioPanelFrame
          panel={GRAPHICS_PANEL}
          panels={[GRAPHICS_PANEL]}
          title="Graphics"
          change={noCommand}
          defaultSize={{ w: 6, h: 14 }}
          cell={noCommand}
          dragHandle={noHandlers}
          resizeHandle={() => noHandlers}
        >
          <GraphicsPanel
            targets={{
              state: { ...state, preview: state.stage },
              programActive: true,
              disabled: false,
              sendProgram: () => true,
            }}
            slug="pqc-conference-2026"
            approvedAgenda={null}
            occurrenceId={ROOM.session.occurrenceId}
            roomId={SCREEN_FIXTURE.roomId}
            now={SCREEN_FIXTURE_NOW}
          />
        </StudioPanelFrame>
      </div>
    </div>
  );
}

/** The reaction bar under the stream, as an attendee sees it; `paused` shows it at the room's allowance. */
function ReactionBar({ paused }: { paused: boolean }) {
  const [refusal, setRefusal] = useState<LiveRoomState["refusal"]>(null);
  useEffect(() => {
    if (paused) setRefusal({ sequence: 1, code: "LIVE_ROOM_RATE_LIMITED", message: "Please wait a moment." });
  }, [paused]);
  return (
    <div class="pk-stack pk-stack--snug pk-preview__watch">
      <div class="pk-preview__screen pk-preview__camera" />
      <LiveReactionBar send={() => true} refusal={refusal} />
    </div>
  );
}

export const studioOnScreenSections: PreviewSection[] = [
  {
    id: "reaction-bar",
    title: "Reaction bar",
    note: "Under the stream in the virtual room and in the session's details: one press, one reaction, floating on the outputs that show reactions.",
    render: () => <ReactionBar paused={false} />,
  },
  {
    id: "reaction-bar-paused",
    title: "Reaction bar, paused",
    note: "At the room's allowance of 10 reactions in 10 seconds the bar stops sending and says so quietly beside it.",
    render: () => <ReactionBar paused />,
  },
  {
    id: "studio-live-monitor",
    title: "Studio LIVE monitor",
    note: "Starts by itself, muted, and keeps to the live edge; the speaker icon beside full screen turns the sound on and stays that way in this browser.",
    render: () => <LiveMonitor />,
  },
  {
    id: "studio-graphics-audience",
    title: "Graphics panel with the audience graphics",
    note: "Top questions, Chat and Reactions sit with the other graphics, each with Preview, Program and Screens; the lists' settings choose how many lines show.",
    render: () => <Graphics />,
  },
  {
    id: "onscreen-questions-projector",
    title: "Top questions on a projector screen",
    note: "The open questions with the most votes, most first; the room refills the list as votes and moderation change.",
    render: () => <ProjectorScreen state={roomWith({ topQuestions: LISTS.topQuestions })} />,
  },
  {
    id: "onscreen-questions-projector-large",
    title: "Top questions sized for a projector",
    note: "The screen shows the event's Projector Q&A layout, where an organizer made the Top questions box large in the layout settings.",
    render: () => (
      <Reacting
        state={roomWith({
          topQuestions: { ...LISTS.topQuestions!, config: { count: 5 }, questions: QUESTIONS_FIVE },
          reactions: true,
        })}
      >
        {(state) => <ProjectorScreen state={state} layout={QA_LAYOUT.slug} />}
      </Reacting>
    ),
  },
  {
    id: "layout-editor-audience",
    title: "Sizing Top questions in the layout settings",
    note: "Top questions, Chat and Reactions are elements like the other cards: shown or hidden, moved and sized per layout, and each screen or browser source names its layout.",
    render: () => (
      <OverlayLayoutEditor
        endpoint="/api/v1/events/pqc-conference-2026/overlays/layouts/projector-qa"
        positionsEndpoint="/api/v1/events/pqc-conference-2026/overlays/positions"
        layout={QA_LAYOUT}
        layouts={[QA_LAYOUT]}
        positions={{ elements: LIVE_OVERLAY_DEFAULT_POSITIONS, saved: false, updatedAt: null }}
        onSaved={noCommand}
        onDuplicate={noCommand}
        onDirty={noCommand}
      />
    ),
  },
  {
    id: "onscreen-chat-projector",
    title: "Chat on a projector screen",
    note: "The latest attendee messages the broadcast may show, newest at the bottom.",
    render: () => <ProjectorScreen state={roomWith({ chatFeed: LISTS.chatFeed })} />,
  },
  {
    id: "onscreen-lists-overlay",
    title: "Top questions and chat on the livestream overlay",
    note: "The same lists on Program, in their Full frame boxes beside the speaker.",
    render: () => <LivestreamOverlay state={roomWith({}, LISTS)} />,
  },
  {
    id: "onscreen-reactions-screen",
    title: "Reactions floating on a projector screen",
    note: "Viewers' reactions float up the side while an operator has them on for this output.",
    render: () => (
      <Reacting state={roomWith({ reactions: true, topQuestions: LISTS.topQuestions })}>
        {(state) => <ProjectorScreen state={state} />}
      </Reacting>
    ),
  },
];
