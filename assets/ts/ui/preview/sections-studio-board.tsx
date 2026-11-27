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

/** A name long enough that the welcome sets the family name under the given name. */
const LONG_NAME = "Alexandra van Placeholder-Smith";

/** The speaker welcome on Program's Full board background, as the broadcast draws it. */
function WelcomeFrame({ speakers, longName = false }: { speakers: 1 | 2 | 6; longName?: boolean }) {
  const [first, second] = ROOM.session.credits;
  const long = { ...second!, name: LONG_NAME };
  const people = (speakers === 1 ? [second!] : speakers === 2 ? [second!, first!] : sessionWith(6).session.credits).map(
    (person, index) => (longName && index === 0 ? long : person),
  );
  const state = roomWith({}, { speakerWelcome: true });
  return (
    <LivestreamOverlay
      state={{
        ...state,
        session: {
          ...state.session,
          eventName: "Sample PQC Conference",
          title: "Migrating a national PKI to post-quantum certificates",
          credits: people,
          sessionType: speakers === 6 ? "Panel discussion" : "Keynote",
        },
      }}
      elements={presetWith("full-board", ["background", "speakerWelcome"])}
    />
  );
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

const PANEL = [
  ["Ana Ramírez Example", "Example Trust Services"],
  ["Benedikt Sampleton", "Sample Certification Authority"],
  ["Chen Placeholder-Wu", "Placeholder Labs"],
  ["Dana Demonstrova", "Demo Government PKI"],
  ["Eli Specimen-Okafor", "Specimen Systems"],
  ["Fay Moderator", "PKI Consortium"],
] as const;
/** Up next in Break across three rooms, streamed from the second. */
function breakAcrossRooms(): LiveRoomState {
  const state = breakWith(1);
  const schedule = state.stage.schedule!;
  const [room] = schedule.rooms;
  const rooms = [
    { name: "Main hall", title: "Migrating a national PKI to post-quantum certificates" },
    { name: "Exhibition theater", title: "Hybrid certificates in practice" },
    { name: "Room 104A", title: "Inventorying cryptography across a bank" },
  ].map(({ name, title }, roomIndex) => ({ ...room!, roomId: `room-${roomIndex}`, roomName: name, roomIndex, title }));
  return { ...state, stage: { ...state.stage, schedule: { ...schedule, streamRoomId: "room-1", rooms } } };
}
/** Up next in Break with this many speakers, the moderator last, and the session timer in its own top-right corner. */
function breakWith(speakers: number): LiveRoomState {
  const schedule = ROOM.stage.schedule!;
  const [room] = schedule.rooms;
  return roomWith(
    {},
    {
      schedule: {
        ...schedule,
        timeZone: "Europe/Amsterdam",
        streamRoomId: room!.roomId,
        rooms: [
          {
            ...room!,
            title: "Migrating a national PKI to post-quantum certificates",
            speakers: PANEL.slice(0, speakers).map(([name, organization], index) => ({
              name: speakers === 1 ? "Pat Panelist" : name,
              moderator: speakers > 1 && index === speakers - 1,
              photoUrl: null,
              organization,
            })),
          },
        ],
      },
      timerGraphics: ROOM.stage.timerGraphics.map((graphic) => ({ ...graphic, placement: "top-right" as const })),
    },
  );
}

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
    id: "onscreen-speaker-welcome",
    title: "Speaker welcome, one speaker",
    note: "Full frame on the Full board background: the event name, the speaker from their identity, and the session. No logo: the production places its own.",
    render: () => <WelcomeFrame speakers={1} />,
  },
  {
    id: "onscreen-speaker-welcome-two",
    title: "Speaker welcome, two speakers",
    note: "Several speakers stack, each beside their own headshot, the session under them.",
    render: () => <WelcomeFrame speakers={2} />,
  },
  {
    id: "onscreen-speaker-welcome-long-name",
    title: "Speaker welcome, a long name",
    note: "A long name sets smaller; a very long one keeps the given name large and sets the rest under it.",
    render: () => <WelcomeFrame speakers={1} longName />,
  },
  {
    id: "onscreen-speaker-welcome-panel-long-name",
    title: "Speaker welcome, a panel with a long name",
    note: "The same rule at the grid's size.",
    render: () => <WelcomeFrame speakers={6} longName />,
  },
  {
    id: "onscreen-speaker-welcome-panel",
    title: "Speaker welcome, a panel of six",
    note: "From three people they sit in a grid, three across, the moderator last.",
    render: () => <WelcomeFrame speakers={6} />,
  },
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
    note: "In the Board left column the board turns tall and lists the people one under the other.",
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
    title: "Question in the Board right column",
    note: "Board right: the question in the column on the right, beside the camera, as the projector shows it.",
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
    id: "onscreen-up-next-speaker",
    title: "Up next in Break, one speaker",
    note: "The speaker sits under the session's title: the face, then the name. The timer keeps the corner it was given.",
    render: () => <LivestreamOverlay state={breakWith(1)} elements={presetWith("break", ["schedule", "timer"])} />,
  },
  {
    id: "onscreen-up-next-three",
    title: "Up next in Break, three speakers",
    note: "From three speakers, one is named at a time with their organization, their face grown.",
    render: () => <LivestreamOverlay state={breakWith(3)} elements={presetWith("break", ["schedule", "timer"])} />,
  },
  {
    id: "onscreen-up-next-panel",
    title: "Up next in Break, a panel of six",
    note: "A larger panel names one speaker at a time, their face brought forward, with their organization.",
    render: () => <LivestreamOverlay state={breakWith(6)} elements={presetWith("break", ["schedule", "timer"])} />,
  },
  {
    id: "onscreen-up-next-rooms",
    title: "Up next in Break, across rooms",
    note: "This room leads, named in brackets; the other rooms follow under their own label, in agenda order, one brought forward at a time.",
    render: () => (
      <LivestreamOverlay state={breakAcrossRooms()} elements={presetWith("break", ["schedule", "timer"])} />
    ),
  },
  {
    id: "onscreen-poll-side-by-side",
    title: "Poll beside the camera",
    note: "The same poll board, scaled into the Board left column.",
    render: () => (
      <LivestreamOverlay state={roomWith({}, ON_POLL)} elements={presetWith("check-in", ["background", "poll"])} />
    ),
  },
  {
    id: "onscreen-panel-question",
    title: "A question over the panel",
    note: "Full board: the question and the panelists on air together draw as one board.",
    render: () => (
      <LivestreamOverlay
        state={{
          ...sessionWith(4),
          stage: { ...EMPTY_LIVE_AUX_COMPOSITION, panelists: { layout: "panel" }, question: NAMED_QUESTION },
        }}
        elements={presetWith("full-board", ["background", "panelists", "question"])}
      />
    ),
  },
];
