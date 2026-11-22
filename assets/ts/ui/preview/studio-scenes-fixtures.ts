/**
 * The studio as the scene thumbnails read it: questions with votes in the
 * room, a panel of three, later sessions on the approved agenda, Program on
 * Q&A, the projector on Panel and a lower third waiting in Preview.
 * Synthetic room; the later sessions are far ahead, so Up next always lists them.
 */
import { agendaSnapshotSchema } from "../../../shared/schemas/event-agenda";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  liveQuestionSchema,
  type LiveQuestion,
} from "../../../shared/schemas/live-session-room";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { SCREEN_FIXTURE } from "./event-screens-fixtures";
import { ROOM } from "./studio-on-screen-fixtures";

const id = (last: number) => `40000000-0000-4000-8000-0000000000${last}`;

/** An approved question as the room lists it; the contract fills everything a new question starts with. */
function asked(last: number, text: string, votes: number, authorName: string | null): LiveQuestion {
  return liveQuestionSchema.parse({
    id: id(last),
    text,
    status: "approved",
    votes,
    anonymous: authorName === null,
    authorName,
    mine: false,
    votedByMe: false,
    askedAt: ROOM.session.startAt,
    answeredAt: null,
    moderated: null,
    originalText: null,
    rewritten: null,
  });
}

const QUESTIONS = [
  asked(11, "How do we find every certificate we depend on before the migration starts?", 24, "Riley Sample"),
  asked(12, "Which algorithms should we pilot first in a private CA?", 17, null),
  asked(13, "Can hybrid certificates work with clients that cannot verify them yet?", 9, "Jo Example"),
];

const OTHER_ROOM = "30000000-0000-4000-8000-000000000002";
const AGENDA = agendaSnapshotSchema.parse({
  eventSlug: SCREEN_FIXTURE.eventSlug,
  timeZone: "UTC",
  revision: 1,
  publishedRevision: 1,
  rooms: [
    { id: SCREEN_FIXTURE.roomId, name: "Main hall", capacity: null },
    { id: OTHER_ROOM, name: "Room B", capacity: null },
  ],
  occurrences: [
    {
      id: id(21),
      title: "Hybrid certificates in practice",
      startAt: "2099-12-01T14:30:00.000Z",
      endAt: "2099-12-01T15:15:00.000Z",
      roomId: SCREEN_FIXTURE.roomId,
      speakers: [],
    },
    {
      id: id(22),
      title: "Certificate automation at scale",
      startAt: "2099-12-01T14:45:00.000Z",
      endAt: "2099-12-01T15:30:00.000Z",
      roomId: OTHER_ROOM,
      speakers: [],
    },
  ],
  shifts: [],
  assignments: [],
  roleMembers: [],
});

const lowerThird = ROOM.session.credits[0]!;
const room: LiveRoomState = { ...ROOM, questions: QUESTIONS, outputs: {} };

/** Program on Q&A with its top questions, and the projector on Panel. */
const ON_AIR: LiveRoomState = {
  ...room,
  stage: {
    ...EMPTY_LIVE_AUX_COMPOSITION,
    scene: "questions",
    lowerThird,
    topQuestions: {
      config: { count: 3 },
      questions: QUESTIONS.map(({ id, text, authorName, votes }) => ({ id, text, authorName, votes })),
    },
  },
  outputs: { projector: { ...EMPTY_LIVE_AUX_COMPOSITION, scene: "panel", panelists: { layout: "panel" } } },
};

/** What the monitors and the scene thumbnails draw from: a lower third in Preview, in the Default scene. */
export const SCENE_SOURCES = {
  preview: { ...room, stage: { ...EMPTY_LIVE_AUX_COMPOSITION, lowerThird } },
  program: ON_AIR,
  agenda: AGENDA,
  connected: true,
  slug: SCREEN_FIXTURE.eventSlug,
  roomId: SCREEN_FIXTURE.roomId,
  startAt: ROOM.session.startAt,
};
