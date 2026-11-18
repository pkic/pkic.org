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
import type { LiveStage } from "../../../shared/schemas/live-session-room";
import { DEFAULT_LIVE_SCREEN_SYNC } from "../../../shared/schemas/live-screen-sync";
import { LIVE_OVERLAY_DEFAULT_POSITIONS } from "../../../shared/live-overlay-layout-presets";
import { OverlayLayoutEditor } from "../../member-flows/portal/sections/events/detail/settings/live-layouts/OverlayLayoutEditor";
import { LiveReactionBar } from "../../live-session/LiveReactionBar";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { OutputTargetControl } from "../../member-flows/portal/sections/events/detail/live/OutputTargetControl";
import { TransitionControl } from "../../member-flows/portal/sections/events/detail/live/studio/StudioSwitcher";
import { LiveSpeakerCards } from "../../member-flows/portal/sections/events/detail/live/LiveSpeakerCards";
import { GraphicsPanel } from "../../member-flows/portal/sections/events/detail/live/studio/GraphicsPanel";
import { monitorPanelView } from "../../member-flows/portal/sections/events/detail/live/studio/MonitorPanel";
import { StudioPanelFrame } from "../../member-flows/portal/sections/events/detail/live/studio/StudioPanelFrame";
import type { StudioPanel } from "../../member-flows/portal/sections/events/detail/live/studio/studio-layout";
import "../../member-flows/portal/sections/events/detail/live/studio/StudioGrid.css";
import "../../member-flows/portal/sections/events/detail/settings/live-layouts/OverlayLayouts.css";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";
import { LivestreamOverlay, presetWith, ProjectorScreen, QA_LAYOUT, ROOM, roomWith } from "./studio-on-screen-fixtures";

const noCommand = () => undefined;
const noHandlers = {
  onPointerDown: noCommand,
  onPointerMove: noCommand,
  onPointerUp: noCommand,
  onPointerCancel: noCommand,
  onLostPointerCapture: noCommand,
};

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
  return children({ ...state, burst: { sequence, counts, people: counts } });
}

const LIVE_PANEL: StudioPanel = { id: "live-1", type: "monitor", x: 0, y: 0, w: 6, h: 9, outputs: ["livestream"] };
const MONITOR_SOURCES = {
  preview: ROOM,
  program: ROOM,
  connected: true,
  slug: "pqc-conference-2026",
  roomId: SCREEN_FIXTURE.roomId,
  startAt: ROOM.session.startAt,
};

/** The LIVE monitor as an operator opens it; the box stands in for the YouTube player. */
function LiveMonitor() {
  const view = monitorPanelView(LIVE_PANEL, MONITOR_SOURCES, noCommand, {
    clear: noCommand,
    screenSync: DEFAULT_LIVE_SCREEN_SYNC,
    sync: noCommand,
    previewScene: noCommand,
    disabled: false,
  });
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
  const view = monitorPanelView(MULTIVIEW_PANEL, MONITOR_SOURCES, noCommand, {
    clear: noCommand,
    screenSync: DEFAULT_LIVE_SCREEN_SYNC,
    sync: noCommand,
    previewScene: noCommand,
    disabled: false,
  });
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
    note: "Top questions, Chat and Reactions sit with the other graphics, each with PVW and PGM; the row's menu holds the room's screens, shown as dots on it, and the settings.",
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
    id: "studio-speakers-identities",
    title: "Speakers in the studio, one with two identities",
    note: "The row stays still: it shows the first identity and counts the rest.",
    render: () => (
      <LiveSpeakerCards targets={{ state: ROOM, programActive: true, disabled: false, sendProgram: () => true }} />
    ),
  },
  {
    id: "studio-speakers-added",
    title: "Speakers in a studio panel, one added for this session",
    note: "One row per person like every studio list: PVW, PGM and the menu at the end, which holds the screens and Remove for someone added.",
    render: () => (
      <div class="pk-preview__studio-panel">
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
    id: "studio-output-target-covered",
    title: "On air, but covered",
    note: "PGM stays lit while a graphic is on air; hatched when a full-screen board, such as the question, hides it. Its tooltip says which board.",
    render: () => (
      <div class="pk-cluster">
        <OutputTargetControl
          subject="Up next"
          preview={false}
          program={false}
          disabled={false}
          onToggle={() => undefined}
        />
        <OutputTargetControl subject="Up next" preview program disabled={false} onToggle={() => undefined} />
        <OutputTargetControl
          subject="Up next"
          preview={false}
          program
          coveredBy="Question"
          disabled={false}
          onToggle={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "studio-transition",
    title: "Transition to Program or to a screen",
    note: "One take button per output, stacked, each in its tally color. Program is first and runs on Space. Labeled, the buttons spell out the output.",
    render: () => (
      <div class="pk-cluster">
        <TransitionControl disabled={false} transitioning={null} onTransition={() => undefined} />
        <TransitionControl disabled={false} transitioning="projector" labeled onTransition={() => undefined} />
        <TransitionControl disabled transitioning={null} onTransition={() => undefined} />
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
