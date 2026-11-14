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
import { TransitionControl } from "../../member-flows/portal/sections/events/detail/live/studio/StudioSwitcher";
import { LiveSpeakerCards } from "../../member-flows/portal/sections/events/detail/live/LiveSpeakerCards";
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
        text: "Which algorithms should we pilot first in a private CA, and how do we keep the relying parties that cannot verify them yet working while the pilot runs alongside our current hierarchy?",
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
/** A busy chat: short greetings between messages longer than the board's three lines. */
const CHAT_MIXED: LiveStage["chatFeed"] = {
  config: { count: 6, delaySeconds: 10 },
  messages: [
    { id: "40000000-0000-4000-8000-000000000021", authorName: "Alex Example", text: "Good morning from Toronto!" },
    {
      id: "40000000-0000-4000-8000-000000000022",
      authorName: "Casey Demo",
      text: "We ran the inventory step last year and found almost twice the certificates we expected, most of them in internal services nobody had listed anywhere. The scan took three weeks, and keeping the list current turned out to be the harder part of the whole exercise.",
    },
    { id: "40000000-0000-4000-8000-000000000023", authorName: "Riley Sample", text: "Same here." },
    {
      id: "40000000-0000-4000-8000-000000000024",
      authorName: "Jordan Placeholder",
      text: "Does the maturity model say anything about code signing keys that live in a cloud HSM rather than on premises?",
    },
    {
      id: "40000000-0000-4000-8000-000000000025",
      authorName: "Pat Panelist",
      text: "For anyone joining late: the slides are linked on the session page, and the recording follows tomorrow afternoon.",
    },
    {
      id: "40000000-0000-4000-8000-000000000026",
      authorName: "Morgan Moderator",
      text: "Thanks everyone, we'll take two of these questions after the demo.",
    },
  ],
};

const QA_ELEMENTS = Object.fromEntries(
  LIVE_OVERLAY_ELEMENTS.map((element) => [
    element,
    { ...FULL_FRAME[element], visible: element === "topQuestions" || element === "reactions" },
  ]),
) as LiveOverlayLayoutElements;
QA_ELEMENTS.topQuestions = {
  visible: true,
  shared: false,
  ...liveOverlayPixelBox(0, 0, 1920, 1080, { horizontal: "center", vertical: "middle" }),
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
function LivestreamOverlay({ state, elements }: { state: LiveRoomState; elements?: LiveOverlayLayoutElements }) {
  return (
    <div class="pk-preview__screen pk-preview__camera">
      <LiveOverlayPresentation view="program" projection={state} elements={elements} broadcast />
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

/** A layout preset with only the named elements on. */
function presetWith(
  preset: keyof typeof LIVE_OVERLAY_PRESET_LAYOUTS,
  shown: readonly (typeof LIVE_OVERLAY_ELEMENTS)[number][],
): LiveOverlayLayoutElements {
  const elements = LIVE_OVERLAY_PRESET_LAYOUTS[preset].elements;
  return Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => [element, { ...elements[element], visible: shown.includes(element) }]),
  ) as LiveOverlayLayoutElements;
}

/** The sample session with these speakers, the moderator last as the room lists them. */
function sessionWith(count: number): LiveRoomState {
  const [first, second, moderator] = ROOM.session.credits;
  const extra = ["Avery Placeholder", "Jordan Sample", "Riley Example"].map((name, index) => ({
    ...second!,
    key: `sample:extra-${index}`,
    name,
    identity: { title: ["CISO", "Cryptography lead", "Standards editor"][index]!, organization: "Example Corp" },
  }));
  const speakers = [first!, second!, ...extra].slice(0, count - 1);
  return {
    ...ROOM,
    session: { ...ROOM.session, credits: count === 2 ? [first!, second!] : [...speakers, moderator!] },
  };
}

const NAMED_QUESTION = {
  ...ROOM.stage.question!,
  text: "Is hybrid signing worth the extra certificate size on constrained devices?",
  authorName: "Bea Attendee",
  addressedTo: "sample:panelist",
};
const ON_POLL: Partial<LiveStage> = { poll: ROOM.stage.poll };

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
            <div class="pk-studio-monitor" data-single="" data-tally="livestream">
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

const MULTIVIEW_PANEL: StudioPanel = {
  id: "multiview-1",
  type: "monitor",
  x: 0,
  y: 0,
  w: 8,
  h: 14,
  outputs: ["preview", "program", "projector", "stage-display"],
};

/** A multiview of Preview, Program and the room's screens, each edged in its own tally color. */
function Multiview() {
  const view = monitorPanelView(MULTIVIEW_PANEL, MONITOR_SOURCES, noCommand, { clear: noCommand, disabled: false });
  return (
    <div class="pk-studio-grid-frame" data-density="compact">
      <div class="pk-studio-grid">
        <StudioPanelFrame
          panel={MULTIVIEW_PANEL}
          panels={[MULTIVIEW_PANEL]}
          title={view.title}
          heading={view.heading}
          actions={view.actions}
          change={noCommand}
          defaultSize={{ w: 8, h: 14 }}
          cell={noCommand}
          dragHandle={noHandlers}
          resizeHandle={() => noHandlers}
        >
          {view.body}
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
    note: "The screen shows the event's Projector Q&A layout: Top questions fill the screen, with the reactions rising over them.",
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
    id: "onscreen-chat-long",
    title: "Chat with long messages",
    note: "Each message shows up to three lines and is clamped at the end of a line; when they no longer fit, the oldest fade off the top.",
    render: () => <ProjectorScreen state={roomWith({ chatFeed: CHAT_MIXED })} />,
  },
  {
    id: "onscreen-lists-overlay",
    title: "Top questions beside the camera",
    note: "Graphics on the left: the list fills a full-height column and the camera fills the rest. Each question shows up to three lines, clamped at the end of a line.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, LISTS)}
        elements={presetWith("side-by-side", ["topQuestions", "lowerThird"])}
      />
    ),
  },
  {
    id: "onscreen-chat-side-right",
    title: "Chat beside the camera, on the right",
    note: "Graphics on the right: the same column on the other side of the frame.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, { chatFeed: CHAT_MIXED })}
        elements={presetWith("side-by-side-right", ["chat"])}
      />
    ),
  },
  {
    id: "onscreen-lower-third-identities",
    title: "Lower third for a speaker with two identities",
    note: "The title line rolls up to each identity in turn; the conference stripe underlines the name bar.",
    render: () => <LivestreamOverlay state={roomWith({}, { lowerThird: ROOM.session.credits[0]! })} />,
  },
  {
    id: "onscreen-panelists-identities",
    title: "Panelists with a speaker's two identities",
    note: "A panelist with more than one identity rolls through them, as the lower third does.",
    render: () => <LivestreamOverlay state={roomWith({}, { panelists: { layout: "panel" } })} />,
  },
  {
    id: "onscreen-panelists-two",
    title: "Two speakers on the board",
    note: "Two people sit large side by side; the same board fills the projector and the stream.",
    render: () => (
      <LivestreamOverlay
        state={{ ...sessionWith(2), stage: { ...EMPTY_LIVE_AUX_COMPOSITION, panelists: { layout: "panel" } } }}
        elements={presetWith("full-frame", ["panelists"])}
      />
    ),
  },
  {
    id: "onscreen-panelists-six",
    title: "A full panel of six, moderator set apart",
    note: "Five speakers and the moderator in one row; the moderator sits last, after a rule.",
    render: () => (
      <LivestreamOverlay
        state={{ ...sessionWith(6), stage: { ...EMPTY_LIVE_AUX_COMPOSITION, panelists: { layout: "panel" } } }}
        elements={presetWith("full-frame", ["panelists"])}
      />
    ),
  },
  {
    id: "onscreen-panelists-side-by-side",
    title: "Panelists beside the camera",
    note: "In the Graphics on the left column the board turns tall and lists the people one under the other.",
    render: () => (
      <LivestreamOverlay
        state={{ ...sessionWith(6), stage: { ...EMPTY_LIVE_AUX_COMPOSITION, panelists: { layout: "panel" } } }}
        elements={presetWith("side-by-side", ["panelists", "lowerThird"])}
      />
    ),
  },
  {
    id: "onscreen-question-poll-board",
    title: "Question on the board",
    note: "In Full frame a board covers the whole frame; one board shows at a time.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, { question: NAMED_QUESTION })}
        elements={presetWith("full-frame", ["question"])}
      />
    ),
  },
  {
    id: "onscreen-poll-side-by-side",
    title: "Poll beside the camera",
    note: "The same poll board, scaled into the Graphics on the left column.",
    render: () => <LivestreamOverlay state={roomWith({}, ON_POLL)} elements={presetWith("side-by-side", ["poll"])} />,
  },
  {
    id: "onscreen-panel-question",
    title: "A question over the panel",
    note: "The Panel layout: the question in the upper half, the panelists in the lower half, edge to edge.",
    render: () => (
      <LivestreamOverlay
        state={{
          ...sessionWith(4),
          stage: { ...EMPTY_LIVE_AUX_COMPOSITION, panelists: { layout: "panel" }, question: NAMED_QUESTION },
        }}
        elements={presetWith("panel", ["panelists", "question"])}
      />
    ),
  },
  {
    id: "studio-speakers-identities",
    title: "Speakers in the studio, one with two identities",
    note: "The row stays still: it shows the first identity and counts the rest.",
    render: () => (
      <LiveSpeakerCards targets={{ state: ROOM, programActive: true, disabled: false, sendProgram: () => true }} />
    ),
  },
  {
    id: "studio-speakers-added",
    title: "Speakers in a narrow studio panel, one added for this session",
    note: "Two columns: the outputs and the remove move under the name together.",
    render: () => (
      <div style={{ inlineSize: "42rem" }}>
        <LiveSpeakerCards
          targets={{
            state: {
              ...ROOM,
              addedCredits: [{ ...ROOM.session.credits[0]!, key: "added:chris", name: "Chris Bailey" }],
            },
            programActive: true,
            disabled: false,
            sendProgram: () => true,
          }}
        />
      </div>
    ),
  },
  {
    id: "studio-multiview",
    title: "Multiview with each output in its own color",
    note: "Program red, Preview green, the projector blue and the stage display amber, on the border and the dot.",
    render: () => <Multiview />,
  },
  {
    id: "studio-transition",
    title: "Transition to Program or to a screen",
    note: "Red to Program by default; the menu beside it sends Preview to a screen instead, in that screen's color.",
    render: () => (
      <div class="pk-cluster">
        <TransitionControl
          disabled={false}
          transitioning={false}
          target="program"
          onTarget={() => undefined}
          onTransition={() => undefined}
        />
        <TransitionControl
          disabled={false}
          transitioning={false}
          target="projector"
          onTarget={() => undefined}
          onTransition={() => undefined}
        />
        <TransitionControl
          disabled={false}
          transitioning={false}
          target="stage-display"
          onTarget={() => undefined}
          onTransition={() => undefined}
        />
      </div>
    ),
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
