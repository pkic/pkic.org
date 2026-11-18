/**
 * The conference board on the livestream and the projector: the lower third,
 * the panelists at any size, and the question and poll boards, alone or
 * over the panel. Synthetic room, fixed clock.
 */
import type { PreviewSection } from "./PreviewShell";
import { EMPTY_LIVE_AUX_COMPOSITION, type LiveStage } from "../../../shared/schemas/live-session-room";
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
    render: () => <LivestreamOverlay state={roomWith({}, { panelists: { layout: "panel" } })} />,
  },
  {
    id: "onscreen-panelists-two",
    title: "Two speakers on the board",
    note: "Two people sit large side by side; the same board fills the projector and the stream.",
    render: () => (
      <LivestreamOverlay
        state={{ ...sessionWith(2), stage: { ...EMPTY_LIVE_AUX_COMPOSITION, panelists: { layout: "panel" } } }}
        elements={presetWith("full-board", ["panelists"])}
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
        elements={presetWith("full-board", ["panelists"])}
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
        elements={presetWith("check-in", ["panelists", "lowerThird"])}
      />
    ),
  },
  {
    id: "onscreen-question-poll-board",
    title: "Question on the board",
    note: "In Full board a board covers the whole frame; one board shows at a time.",
    render: () => (
      <LivestreamOverlay
        state={roomWith({}, { question: NAMED_QUESTION })}
        elements={presetWith("full-board", ["question"])}
      />
    ),
  },
  {
    id: "onscreen-poll-side-by-side",
    title: "Poll beside the camera",
    note: "The same poll board, scaled into the Graphics on the left column.",
    render: () => <LivestreamOverlay state={roomWith({}, ON_POLL)} elements={presetWith("check-in", ["poll"])} />,
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
];
