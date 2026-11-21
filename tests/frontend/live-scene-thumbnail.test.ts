import { describe, expect, it } from "vitest";
import {
  LIVE_OVERLAY_PRESET_LAYOUTS,
  LIVE_OVERLAY_STANDARD_ELEMENTS,
} from "../../assets/shared/live-overlay-layout-presets";
import { resolveLiveSceneElements } from "../../assets/shared/live-scene-elements";
import { DEFAULT_LIVE_CHAT_FEED_CONFIG } from "../../assets/shared/schemas/live-session-on-screen";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "../../assets/shared/schemas/live-session-schedule";
import { DEFAULT_LIVE_TICKER_CONFIG } from "../../assets/shared/schemas/live-session-ticker";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../../assets/shared/schemas/live-session-stage";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import {
  liveSceneOutline,
  liveSceneThumbnail,
  liveSceneThumbnailEmpty,
  liveSceneThumbnails,
  sameLiveSceneThumbnailRoom,
  type LiveSceneThumbnailRoom,
} from "../../assets/ts/live-session/live-scene-thumbnail";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";
import { LIVE_OCCURRENCE, liveQuestion, liveSnapshot } from "./helpers/live-room-socket";

const NOW = Date.parse("2026-12-01T09:10:00.000Z");
const id = (last: number) => `20000000-0000-4000-8000-0000000000${last}`;
const SPEAKER = liveSnapshot().session.credits[0]!;
const SECOND = { ...SPEAKER, key: "user:second", name: "Paula Panelist" };

/** The session running now in the main hall, then one later there and one in another room. */
const AGENDA = {
  ...approvedAgendaSnapshot,
  rooms: [
    { ...approvedAgendaSnapshot.rooms[0]!, id: "hall", name: "Main hall" },
    { ...approvedAgendaSnapshot.rooms[0]!, id: "blue", name: "Blue room" },
  ],
  occurrences: [
    { ...approvedAgendaSnapshot.occurrences[0]!, id: LIVE_OCCURRENCE, roomId: "hall" },
    {
      ...approvedAgendaSnapshot.occurrences[0]!,
      id: "later-hall",
      roomId: "hall",
      title: "Certificate automation",
      startAt: "2026-12-01T10:15:00.000Z",
      endAt: "2026-12-01T11:00:00.000Z",
    },
    {
      ...approvedAgendaSnapshot.occurrences[0]!,
      id: "later-blue",
      roomId: "blue",
      title: "Hybrid deployment",
      startAt: "2026-12-01T10:30:00.000Z",
      endAt: "2026-12-01T11:00:00.000Z",
    },
  ],
};

const QUESTIONS = [
  liveQuestion({
    id: id(31),
    text: "Most votes, asked anonymously",
    votes: 9,
    anonymous: true,
    authorName: "Mo Moderated",
  }),
  liveQuestion({ id: id(32), text: "Second by votes", votes: 4 }),
  liveQuestion({ id: id(33), text: "Still waiting for approval", votes: 20, status: "pending" }),
  liveQuestion({ id: id(34), text: "Withdrawn by its author", votes: 15, withdrawn: true }),
  liveQuestion({ id: id(35), text: "Third by votes", votes: 2 }),
  liveQuestion({ id: id(36), text: "Fourth by votes", votes: 1 }),
];

/** The studio's Preview: the room with Preview's composition as its stage. */
function studio(
  preview: Partial<LiveStage> = {},
  room: Parameters<typeof liveSnapshot>[0] = {},
  rest: Partial<Omit<LiveSceneThumbnailRoom, "preview">> = {},
): LiveSceneThumbnailRoom {
  const snapshot = liveSnapshot({
    viewer: { role: "operator", name: "Olga Operator" },
    session: { ...liveSnapshot().session, credits: [SPEAKER, SECOND] },
    questions: QUESTIONS,
    ...room,
  });
  const state = applyLiveRoomMessage(null, { ...snapshot, preview: { ...EMPTY_LIVE_STAGE, ...preview } })!;
  return { preview: { ...state, stage: state.preview }, program: state.stage, agenda: AGENDA, ...rest };
}

const stageOf = (room: LiveSceneThumbnailRoom, scene: string) => liveSceneThumbnail(room, scene, NOW).state.stage;

const TICKER = { ...DEFAULT_LIVE_TICKER_CONFIG, segments: [{ id: "note", prefix: "Note", markdown: "On in Preview" }] };

describe("scene thumbnails", () => {
  it.each([
    ["an empty Preview", {}],
    ["a Preview with a lower third and the ticker on", { lowerThird: SPEAKER, ticker: TICKER }],
  ] as const)("add each scene's comes-on graphics, filled from the room, to %s", (_name, held) => {
    const room = studio(held);
    const base = room.preview.stage;

    // Default brings nothing on: Preview as it is.
    expect(stageOf(room, "default")).toEqual({ ...base, scene: "default" });

    // Q&A: the open questions with the most votes, most first; an anonymous author stays anonymous.
    expect(stageOf(room, "questions")).toEqual({
      ...base,
      scene: "questions",
      topQuestions: {
        config: { count: 3 },
        questions: [
          { id: id(31), text: "Most votes, asked anonymously", authorName: null, votes: 9 },
          { id: id(32), text: "Second by votes", authorName: "Bea Attendee", votes: 4 },
          { id: id(35), text: "Third by votes", authorName: "Bea Attendee", votes: 2 },
        ],
      },
    });

    // Panel: the session's own credits, which the panel draws.
    expect(stageOf(room, "panel")).toEqual({ ...base, scene: "panel", panelists: { layout: "panel" } });

    // Break: Up next from the approved agenda, every room, as the room resolves it.
    const pause = stageOf(room, "break");
    expect(pause).toEqual({ ...base, scene: "break", schedule: pause.schedule });
    expect(pause.schedule).toMatchObject({
      config: { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "all-rooms" },
      available: true,
      rooms: [
        { roomName: "Main hall", title: "Certificate automation" },
        { roomName: "Blue room", title: "Hybrid deployment" },
      ],
    });
  });

  it("take each graphic's look from Program, and leave on what Preview already holds", () => {
    const listed = { config: { count: 1 }, questions: [] };
    // Program lists one question: the scene brings the list on with that look, filled now.
    expect(
      stageOf(studio({}, { stage: { ...EMPTY_LIVE_STAGE, topQuestions: listed } }), "questions").topQuestions,
    ).toEqual({
      config: { count: 1 },
      questions: [{ id: id(31), text: "Most votes, asked anonymously", authorName: null, votes: 9 }],
    });
    // Preview's own list stays exactly as it is.
    expect(stageOf(studio({ topQuestions: listed }), "questions").topQuestions).toBe(listed);
    // A session with one speaker has no panel to bring on.
    const solo = studio({}, { session: liveSnapshot().session });
    expect(stageOf(solo, "panel").panelists).toBeNull();
    // Another session is on air: the looks are the standard ones.
    expect(stageOf(studio({}, {}, { program: null }), "questions").topQuestions?.config).toEqual({ count: 3 });
  });

  it("stay still, without reaction bursts", () => {
    const room = studio();
    const reacting = { ...room.preview, burst: { sequence: 1, counts: { applause: 2 }, people: { applause: 2 } } };
    expect(liveSceneThumbnail({ ...room, preview: reacting }, "default", NOW).state.burst).toBeNull();
  });

  it("fill an event's own scene: the ticker from the agenda, and the chat only from a list the room already filled", () => {
    const own = {
      slug: "lounge",
      name: "Lounge",
      elements: {
        ...LIVE_OVERLAY_STANDARD_ELEMENTS,
        ticker: { ...LIVE_OVERLAY_STANDARD_ELEMENTS.ticker, comesOn: true },
        chat: { ...LIVE_OVERLAY_STANDARD_ELEMENTS.chat, comesOn: true },
      },
    };
    const room = studio({}, { overlayLayouts: [own] });
    const thumbnail = liveSceneThumbnail(room, "lounge", NOW);
    // The standard ticker, written from the agenda as the room writes it.
    expect(thumbnail.state.stage.ticker?.messages).toEqual(DEFAULT_LIVE_TICKER_CONFIG.messages);
    expect(thumbnail.state.stage.ticker?.segments.map((segment) => segment.id)).toContain("greeting");
    // The chat an output may show is the room's to decide: the thumbnail outlines its box instead of guessing.
    expect(thumbnail.state.stage.chatFeed).toBeNull();
    expect(thumbnail.unfilled).toEqual(["chat"]);
    expect(liveSceneOutline(thumbnail, "lounge")).toEqual([resolveLiveSceneElements(room.preview, "lounge").chat]);

    // Program shows the chat and a ticker: the scene brings on exactly those, already filled by the room.
    const chatFeed = {
      config: DEFAULT_LIVE_CHAT_FEED_CONFIG,
      messages: [{ id: id(41), authorName: "Ada Attendee", text: "Great session" }],
    };
    const onAir = studio({}, { overlayLayouts: [own], stage: { ...EMPTY_LIVE_STAGE, chatFeed, ticker: TICKER } });
    const filled = liveSceneThumbnail(onAir, "lounge", NOW);
    expect(filled.state.stage.chatFeed).toEqual(chatFeed);
    expect(filled.state.stage.ticker).toEqual(TICKER);
    expect(filled.unfilled).toEqual([]);
    expect(liveSceneOutline(filled, "lounge")).toEqual([]);
  });

  it("change only when their picture does", () => {
    const room = studio();
    const scenes = Object.keys(LIVE_OVERLAY_PRESET_LAYOUTS);
    // Chat, presence and the queue leave every thumbnail alone.
    const chatting = { ...room, preview: { ...room.preview, chat: [], operators: [] } };
    expect(sameLiveSceneThumbnailRoom(room, chatting)).toBe(true);
    const first = liveSceneThumbnails(room, scenes, NOW);

    // A vote that leaves the top questions as they are redraws nothing.
    const quiet = QUESTIONS.map((question) => (question.id === id(36) ? { ...question, votes: 0 } : question));
    const voted = { ...room, preview: { ...room.preview, questions: quiet } };
    expect(sameLiveSceneThumbnailRoom(room, voted)).toBe(false);
    const second = liveSceneThumbnails(voted, scenes, NOW, first);
    expect(scenes.every((scene) => second.get(scene) === first.get(scene))).toBe(true);

    // One that changes them redraws only the scene that shows them.
    const risen = QUESTIONS.map((question) => (question.id === id(36) ? { ...question, votes: 30 } : question));
    const third = liveSceneThumbnails({ ...room, preview: { ...room.preview, questions: risen } }, scenes, NOW, second);
    expect(scenes.filter((scene) => third.get(scene) !== second.get(scene))).toEqual(["questions"]);
    expect(third.get("questions")!.state.stage.topQuestions?.questions[0]?.text).toBe("Fourth by votes");

    // The agenda read again with the same sessions redraws nothing.
    const reread = liveSceneThumbnails({ ...room, agenda: structuredClone(AGENDA) }, scenes, NOW, first);
    expect(reread.get("break")).toBe(first.get("break"));
  });

  it("outline the scene's boxes only while the thumbnail holds no graphic", () => {
    const room = studio({}, { questions: [], session: liveSnapshot().session });
    // Nothing comes on in Default, and Q&A has no open question to list: both show their boxes.
    for (const scene of ["default", "questions"]) {
      const thumbnail = liveSceneThumbnail(room, scene, NOW);
      expect(liveSceneThumbnailEmpty(thumbnail.state.stage)).toBe(true);
      const outline = liveSceneOutline(thumbnail, scene);
      expect(outline.length).toBeGreaterThan(0);
      expect(outline.every((box) => box.visible)).toBe(true);
    }
    // Break draws Up next, so it needs no outline.
    expect(liveSceneOutline(liveSceneThumbnail(room, "break", NOW), "break")).toEqual([]);
  });
});
