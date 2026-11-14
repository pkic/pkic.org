/**
 * The studio's Questions panel with prepared questions waiting under the
 * open ones, and the two dialogs its header opens: preparing a question and
 * setting the times prepared questions come in.
 */
import type { PreviewSection } from "./PreviewShell";
import type { LivePreparedQuestion } from "../../../shared/schemas/live-session-prepared-question";
import { useRef } from "preact/hooks";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  liveStageQuestionSchema,
  type LiveQuestion,
} from "../../../shared/schemas/live-session-room";
import { LiveRowMenu } from "../../member-flows/portal/sections/events/detail/live/LiveRowMenu";
import { StudioTour } from "../../member-flows/portal/sections/events/detail/live/studio/StudioTour";
import type { LiveRoomState } from "../../live-session/live-room-state";
import {
  LivePreparedQuestionDialog,
  LivePreparedQuestionWindowDialog,
} from "../../member-flows/portal/sections/events/detail/live/LivePreparedQuestionDialogs";
import {
  LiveQuestionsHeader,
  LiveQuestionsPanel,
} from "../../member-flows/portal/sections/events/detail/live/LiveQuestionsPanel";
import { StudioPanelFrame } from "../../member-flows/portal/sections/events/detail/live/studio/StudioPanelFrame";
import type { StudioPanel } from "../../member-flows/portal/sections/events/detail/live/studio/studio-layout";
import { sampleOverlayRoom } from "../../member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";
import "../../member-flows/portal/sections/events/detail/live/studio/StudioGrid.css";
import { SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";
import "./event-screens-preview.css";

const at = (minutes: number) => new Date(SCREEN_FIXTURE_NOW + minutes * 60_000).toISOString();
const send = () => true;
const noCommand = () => undefined;
const noHandlers = {
  onPointerDown: noCommand,
  onPointerMove: noCommand,
  onPointerUp: noCommand,
  onPointerCancel: noCommand,
  onLostPointerCapture: noCommand,
};

function asked(id: string, text: string, overrides: Partial<LiveQuestion> = {}): LiveQuestion {
  return {
    id,
    text,
    status: "approved",
    votes: 0,
    anonymous: false,
    authorName: "Bea Attendee",
    authorPhotoUrl: null,
    authorHandle: null,
    authorAffiliation: null,
    authorRoles: [],
    mine: false,
    revision: 0,
    withdrawn: false,
    canEdit: false,
    votedByMe: false,
    askedAt: at(-6),
    answeredAt: null,
    moderated: null,
    originalText: null,
    rewritten: null,
    addressedTo: null,
    prepared: false,
    ...overrides,
  };
}

const PREPARED: LivePreparedQuestion[] = [
  {
    id: "50000000000000000000000000000001",
    text: "Which systems should an organization inventory first?",
    addressedTo: "sample:panelist",
    releaseAt: at(4),
    revision: 0,
  },
  {
    id: "50000000000000000000000000000002",
    text: "How do we test hybrid certificates before we deploy them?",
    addressedTo: null,
    releaseAt: at(11),
    revision: 0,
  },
];

const BASE = sampleOverlayRoom(SCREEN_FIXTURE_NOW);
const ROOM: LiveRoomState = {
  ...BASE,
  questions: [
    asked("40000000-0000-4000-8000-000000000031", "Is hybrid signing worth the extra certificate size?", {
      votes: 12,
      addressedTo: "sample:speaker",
    }),
    asked("40000000-0000-4000-8000-000000000032", "What about firmware signing keys?", {
      status: "pending",
      anonymous: true,
      authorName: "Riley Sample",
    }),
  ],
  preparedQuestions: PREPARED,
  preparedQuestionWindow: { from: at(-15), until: at(20) },
};
const TARGETS = { state: ROOM, programActive: true, disabled: false, sendProgram: send };
const PANEL: StudioPanel = { id: "questions-1", type: "questions", x: 0, y: 0, w: 5, h: 14 };

/** One question on Program, which the stage display follows, and one put on the projector directly. */
const ON_AIR = "40000000-0000-4000-8000-000000000031";
const PINNED = "40000000-0000-4000-8000-000000000033";
const stageQuestion = (id: string, text: string) => liveStageQuestionSchema.parse({ id, text, authorName: null });
const SCREENS_ROOM: LiveRoomState = {
  ...ROOM,
  questions: [ROOM.questions[0]!, asked(PINNED, "Can we keep RSA for the root and go hybrid below it?", { votes: 4 })],
  preparedQuestions: [],
  stage: { ...ROOM.stage, question: stageQuestion(ON_AIR, ROOM.questions[0]!.text) },
  outputs: {
    ...ROOM.outputs,
    projector: { ...EMPTY_LIVE_AUX_COMPOSITION, question: stageQuestion(PINNED, "Pinned") },
    "stage-display": EMPTY_LIVE_AUX_COMPOSITION,
  },
};
const SCREENS_TARGETS = { ...TARGETS, state: SCREENS_ROOM };

function QuestionsPanelSpecimen({ targets = TARGETS }: { targets?: typeof TARGETS }) {
  return (
    <div class="pk-studio-grid-frame" data-density="compact">
      <div class="pk-studio-grid">
        <StudioPanelFrame
          panel={PANEL}
          panels={[PANEL]}
          title="Questions"
          actions={<LiveQuestionsHeader targets={targets} send={send} />}
          menu={[{ id: "release-times", label: "Release times", onSelect: noCommand }]}
          change={noCommand}
          defaultSize={{ w: 5, h: 14 }}
          cell={noCommand}
          dragHandle={noHandlers}
          resizeHandle={() => noHandlers}
        >
          <LiveQuestionsPanel targets={targets} clock="UTC" send={send} />
        </StudioPanelFrame>
      </div>
    </div>
  );
}

function TourSpecimen() {
  const scope = useRef<HTMLDivElement>(null);
  return (
    <div ref={scope} style={{ paddingBlockStart: "14rem" }}>
      <QuestionsPanelSpecimen targets={SCREENS_TARGETS} />
      <StudioTour scope={scope} onClose={noCommand} />
    </div>
  );
}

export const studioQuestionSections: PreviewSection[] = [
  {
    id: "studio-questions-prepared",
    title: "Studio: Questions with prepared questions",
    note: "Prepared questions wait under the open ones in the same rows: when each comes in and whom it is for, Release now, and Edit or Delete in the menu.",
    render: () => <QuestionsPanelSpecimen />,
  },
  {
    id: "studio-question-prepare",
    title: "Studio: prepare a question",
    note: "From the panel's +: the question and, optionally, whom it is for. It comes in anonymously.",
    render: () => (
      <div data-density="compact">
        <LivePreparedQuestionDialog question={null} credits={ROOM.session.credits} send={send} onClose={noCommand} />
      </div>
    ),
  },
  {
    id: "studio-question-release-times",
    title: "Studio: release times",
    note: "From the panel's menu: the span, in the event's clock, in which prepared questions come in at random times.",
    render: () => (
      <div data-density="compact">
        <LivePreparedQuestionWindowDialog
          window={ROOM.preparedQuestionWindow!}
          session={ROOM.session}
          clock="UTC"
          send={send}
          onClose={noCommand}
        />
      </div>
    ),
  },
  {
    id: "studio-screens-following",
    title: "Studio: a question the stage display follows from Program",
    note: "The first question is on Program, so the stage display shows it too: a ring under ⋯. The second was put on the projector itself: a solid dot.",
    render: () => <QuestionsPanelSpecimen targets={SCREENS_TARGETS} />,
  },
  {
    id: "studio-screens-menu-following",
    title: "Studio: the row menu while the stage display follows Program",
    note: "Stage display is not checked, since no one put the question there, and says it shows it from Program. Checking it keeps it there after Program changes.",
    render: () => (
      <div
        data-density="compact"
        data-gallery-open
        style={{ display: "flex", justifyContent: "end", minBlockSize: "18rem" }}
      >
        <LiveRowMenu
          targets={SCREENS_TARGETS}
          layer={{ kind: "question", id: ON_AIR }}
          label="Question actions"
          heading="Question"
          items={[{ id: "answered", label: "Mark answered", onSelect: noCommand }]}
        />
      </div>
    ),
  },
  {
    id: "studio-tour",
    title: "Studio tour",
    note: "From Studio tour in the layout row. Each step points at one control; steps for closed panels are left out.",
    render: () => <TourSpecimen />,
  },
];
