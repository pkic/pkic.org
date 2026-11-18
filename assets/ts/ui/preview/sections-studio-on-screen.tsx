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
import { LiveSpeakerCards } from "../../member-flows/portal/sections/events/detail/live/LiveSpeakerCards";
import { GraphicsPanel } from "../../member-flows/portal/sections/events/detail/live/studio/GraphicsPanel";
import { monitorPanelView } from "../../member-flows/portal/sections/events/detail/live/studio/MonitorPanel";
import { StudioPanelFrame } from "../../member-flows/portal/sections/events/detail/live/studio/StudioPanelFrame";
import type { StudioPanel } from "../../member-flows/portal/sections/events/detail/live/studio/studio-layout";
import "../../member-flows/portal/sections/events/detail/live/studio/StudioGrid.css";
import "../../member-flows/portal/sections/events/detail/settings/live-layouts/OverlayLayouts.css";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";
import { DialogSpecimen } from "./sections-event-screens-staff";
import { LiveOverlayGraphicsDialog } from "../../member-flows/portal/sections/events/detail/live/LiveOverlayGraphicsDialog";
import { liveOverlayAddress } from "../../live-session/live-overlay-address";
import {
  LivestreamOverlay,
  presetWith,
  ProjectorScreen,
  QA_LAYOUT,
  ROOM,
  ROOM_WITH_SCREENS,
  roomWith,
} from "./studio-on-screen-fixtures";

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

/** The default multiview in a room set up with its own screens: the room's screens stand in for the projector. */
const ROOM_SCREENS_PANEL: StudioPanel = {
  ...MULTIVIEW_PANEL,
  id: "multiview-2",
  outputs: ["program", "livestream", "stage-display", "projector"],
};
const ROOM_SCREENS_SOURCES = { ...MONITOR_SOURCES, preview: ROOM_WITH_SCREENS, program: ROOM_WITH_SCREENS };

/** A multiview of Preview, Program and the room's screens, each edged in its own tally color. */
function Multiview({
  panel = MULTIVIEW_PANEL,
  sources = MONITOR_SOURCES,
  width = 8,
}: {
  panel?: StudioPanel;
  sources?: typeof MONITOR_SOURCES;
  /** Columns of the studio grid the panel spans; a wide one has room for each screen's tag. */
  width?: number;
}) {
  const view = monitorPanelView(panel, sources, noCommand, {
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
          panel={panel}
          panels={[panel]}
          title={view.title}
          heading={view.heading}
          actions={view.actions}
          change={noCommand}
          defaultSize={{ w: width, h: 14 }}
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

const PREVIEW_PANEL: StudioPanel = {
  id: "preview-1",
  type: "monitor",
  x: 0,
  y: 0,
  w: 6,
  h: 12,
  outputs: ["preview"],
};

/** Preview with the event's scenes under it, each drawn with the room's real content. */
function PreviewScenes() {
  const view = monitorPanelView(PREVIEW_PANEL, MONITOR_SOURCES, noCommand, {
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
          panel={PREVIEW_PANEL}
          panels={[PREVIEW_PANEL]}
          title={view.title}
          heading={view.heading}
          actions={view.actions}
          menu={view.menu}
          change={noCommand}
          defaultSize={{ w: 6, h: 12 }}
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
    render: () => <ProjectorScreen state={roomWith({ topQuestions: LISTS.topQuestions })} layout="full-board" />,
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
        canEdit
        onSaved={noCommand}
        onDuplicate={noCommand}
        onDirty={noCommand}
      />
    ),
  },
  {
    id: "layout-editor-read-only",
    title: "A scene shown to someone who may not change it",
    note: "Room operators load the event's scenes but only the people who set up the live studio change them: the scene is drawn with sample content, with nothing to move, add, save or delete.",
    render: () => (
      <OverlayLayoutEditor
        endpoint="/api/v1/events/pqc-conference-2026/overlays/layouts/projector-qa"
        positionsEndpoint="/api/v1/events/pqc-conference-2026/overlays/positions"
        layout={QA_LAYOUT}
        layouts={[QA_LAYOUT]}
        positions={{ elements: LIVE_OVERLAY_DEFAULT_POSITIONS, saved: false, updatedAt: null }}
        canEdit={false}
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
    render: () => <ProjectorScreen state={roomWith({ chatFeed: LISTS.chatFeed })} layout="full-board" />,
  },
  {
    id: "onscreen-chat-long",
    title: "Chat with long messages",
    note: "Each message shows up to three lines and is clamped at the end of a line; when they no longer fit, the oldest fade off the top.",
    render: () => <ProjectorScreen state={roomWith({ chatFeed: CHAT_MIXED })} layout="full-board" />,
  },
  {
    id: "onscreen-lists-overlay",
    title: "Top questions beside the camera",
    note: "Graphics on the left: the list fills a full-height column and the camera fills the rest. Each question shows up to three lines, clamped at the end of a line.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, LISTS)}
        elements={presetWith("check-in", ["background", "topQuestions", "lowerThird"])}
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
        elements={presetWith("questions", ["background", "chat"])}
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
    id: "studio-multiview-room-screens",
    title: "Multiview in a room with its own screens",
    note: "Each screen the room sets up, colored by its place in the room's list. The tag says what it shows: Follows PGM, Speaker, or the scene of a screen you take to.",
    render: () => <Multiview panel={ROOM_SCREENS_PANEL} sources={ROOM_SCREENS_SOURCES} width={12} />,
  },
  {
    id: "studio-preview-scenes",
    title: "Preview with its scenes",
    note: "Shown under Preview unless hidden from its panel menu. Each scene is drawn with the room's real content: Preview's graphics, else Program's, the session's first speaker and the top questions. The scene in Preview is edged in Preview's color. The scene button beside PVW opens the same scenes, three to a row. Choosing one loads it into Preview.",
    render: () => <PreviewScenes />,
  },
  {
    id: "live-overlay-graphics-dialog",
    title: "A browser-source link with only some graphics",
    note: "From Show only some graphics… on an output's link: all graphics, only these, or all except these, and crop when one graphic is left.",
    render: () => (
      <DialogSpecimen
        label="Show only some graphics…"
        dialog={(close) => (
          <LiveOverlayGraphicsDialog
            label="Program"
            link={(graphics) =>
              liveOverlayAddress("https://pkic.org", {
                view: "program",
                layout: null,
                slug: "pqc-conference-2026",
                roomId: "33333333-3333-4333-8333-333333333333",
                token: "signed.overlay.access",
                graphics,
              })
            }
            onClose={close}
          />
        )}
      />
    ),
  },
  {
    id: "onscreen-reactions-screen",
    title: "Reactions floating on a projector screen",
    note: "Viewers' reactions float up the side while an operator has them on for this output.",
    render: () => (
      <Reacting state={roomWith({ reactions: true, topQuestions: LISTS.topQuestions })}>
        {(state) => <ProjectorScreen state={state} layout="full-board" />}
      </Reacting>
    ),
  },
];
