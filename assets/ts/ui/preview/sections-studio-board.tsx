/**
 * The boards on the livestream and the projector: the lower third, the
 * panelists at any size, and the question and poll boards, alone or over
 * the panel, each on its scene's background, and one in a scene without a
 * background. Synthetic room, fixed clock.
 */
import type { PreviewSection } from "./PreviewShell";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  type LivePanelists,
  type LiveStage,
} from "../../../shared/schemas/live-session-room";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { LivestreamOverlay, presetWith, ROOM, roomWith } from "./studio-on-screen-fixtures";

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

const ABSTRACT =
  "Most organizations know they must move to post-quantum cryptography, but few know where to start. This session walks through building a cryptographic inventory, choosing between hybrid and pure post-quantum certificates, and planning a migration that keeps existing clients working.";
/** The sample session with an abstract and one speaker, or a full panel, showing the session graphic as the operator set it. */
function sessionGraphic(panelists: LivePanelists, people: 1 | 6 = 1): LiveRoomState {
  const { session } = people === 1 ? ROOM : sessionWith(people);
  return {
    ...ROOM,
    session: { ...session, credits: session.credits.slice(0, people), abstract: ABSTRACT },
    stage: { ...EMPTY_LIVE_AUX_COMPOSITION, panelists },
  };
}

export const studioBoardSections: PreviewSection[] = [
  {
    id: "onscreen-lower-third-identities",
    title: "Lower third for a speaker with two identities",
    note: "The title line rolls up to each identity in turn; the conference stripe underlines the name bar.",
    render: () => <LivestreamOverlay state={roomWith({}, { lowerThird: ROOM.session.credits[0]! })} />,
  },
  {
    id: "onscreen-lower-third-name-only",
    title: "Lower third for a speaker with no title",
    note: "With no title or organization, the name bar shows alone; no empty field sits under it.",
    render: () => (
      <LivestreamOverlay
        state={roomWith(
          {},
          {
            lowerThird: {
              ...ROOM.session.credits[0]!,
              identity: { title: null, organization: null },
              additionalIdentities: [],
            },
          },
        )}
      />
    ),
  },
  {
    id: "onscreen-panelists-identities",
    title: "Panelists with a speaker's two identities",
    note: "A panelist with more than one identity rolls through them, as the lower third does.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, { panelists: { layout: "panel" } })}
        elements={presetWith("full-board", ["background", "panelists"])}
      />
    ),
  },
  {
    id: "onscreen-panelists-two",
    title: "Two speakers on the board",
    note: "Two people sit large side by side; the same board fills the projector and the stream.",
    render: () => (
      <LivestreamOverlay
        state={{ ...sessionWith(2), stage: { ...EMPTY_LIVE_AUX_COMPOSITION, panelists: { layout: "panel" } } }}
        elements={presetWith("full-board", ["background", "panelists"])}
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
        elements={presetWith("full-board", ["background", "panelists"])}
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
        elements={presetWith("check-in", ["background", "panelists", "lowerThird"])}
      />
    ),
  },
  {
    id: "onscreen-session-title-abstract",
    title: "Session title with its abstract",
    note: "Title only, with the abstract: the session's title large and centered, the abstract under it.",
    render: () => (
      <LivestreamOverlay
        state={sessionGraphic({ layout: "title", abstract: true })}
        elements={presetWith("full-board", ["background", "panelists"])}
      />
    ),
  },
  {
    id: "onscreen-session-speaker-abstract",
    title: "One speaker with the abstract",
    note: "The session graphic for a talk: the title, the abstract and its one speaker.",
    render: () => (
      <LivestreamOverlay
        state={sessionGraphic({ layout: "panel", abstract: true })}
        elements={presetWith("full-board", ["background", "panelists"])}
      />
    ),
  },
  {
    id: "onscreen-session-column",
    title: "Session beside the camera",
    note: "In a column the session graphic lists the title, the abstract and the panel one under the other.",
    render: () => (
      <LivestreamOverlay
        state={sessionGraphic({ layout: "panel", abstract: true }, 6)}
        elements={presetWith("check-in", ["background", "panelists", "lowerThird"])}
      />
    ),
  },
  {
    id: "onscreen-question-poll-board",
    title: "Question on the board",
    note: "In Full board the background covers the whole frame and a board draws on it; one board shows at a time.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, { question: NAMED_QUESTION })}
        elements={presetWith("full-board", ["background", "question"])}
      />
    ),
  },
  {
    id: "onscreen-question-qa-column",
    title: "Question in the Q&A column",
    note: "The Q&A scene: the question in the column on the right, beside the camera, as the projector shows it.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, { question: NAMED_QUESTION })}
        elements={presetWith("questions", ["background", "question"])}
      />
    ),
  },
  {
    id: "onscreen-board-no-background",
    title: "A board in a scene without a background",
    note: "Every built-in scene that places a board places it on a background. A scene of the event's own that places one without a background draws the board's eyebrow and content alone over the picture: only the background graphic draws the conference field and the logo.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, { question: NAMED_QUESTION })}
        elements={presetWith("default", ["question"])}
      />
    ),
  },
  {
    id: "onscreen-up-next-on-background",
    title: "Up next on the Full board background",
    note: "Inside the scene's background Up next reads on it, with no plate or stripe of its own; over the picture, outside a background, it keeps its card.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, { schedule: ROOM.stage.schedule })}
        elements={presetWith("full-board", ["background", "schedule"])}
      />
    ),
  },
  {
    id: "onscreen-poll-side-by-side",
    title: "Poll beside the camera",
    note: "The same poll board, scaled into the Graphics on the left column.",
    render: () => (
      <LivestreamOverlay state={roomWith({}, ON_POLL)} elements={presetWith("check-in", ["background", "poll"])} />
    ),
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
        elements={presetWith("panel", ["background", "panelists", "question"])}
      />
    ),
  },
];
