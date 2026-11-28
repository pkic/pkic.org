import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { liveOverlayDrawn } from "../assets/shared/live-overlay-cover";
import { LIVE_PROGRAM_LAYER_ORDER } from "../assets/shared/live-overlay-stacking";
import { liveCompositionInput } from "../assets/shared/live-room-preview";
import { personalAgendaProgramResponseSchema } from "../assets/shared/schemas/event-personal-agenda";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../assets/shared/schemas/live-session-room";
import { applyLiveRoomMessage, type LiveRoomState } from "../assets/ts/live-session/live-room-state";
import { liveSceneThumbnail } from "../assets/ts/live-session/live-scene-thumbnail";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { callApi } from "./helpers/app";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;

/** A ticker whose words do not change with the clock. */
const TICKER = {
  theme: "navy-glass" as const,
  messages: [{ id: "note", prefix: "Note", template: "Raise your questions", condition: "always" as const }],
};

/**
 * The approved agenda with a second speaker on the session, so it has a
 * panel, and a later session in this room and in another one, so Up next has
 * something to list.
 */
async function approvePanelAndLaterSessions() {
  await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers (occurrence_id,user_id) VALUES (?,?)")
    .bind(f.occurrenceId, f.users.outsider)
    .run();
  const blue = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name) VALUES (?,?,'Blue room')")
    .bind(blue, f.eventId)
    .run();
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  for (const [title, room, start, end] of [
    ["Later in this room", f.roomId, 65, 95],
    ["Later in the blue room", blue, 70, 100],
  ] as const)
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences (id,event_id,title,room_id,start_at,end_at) VALUES (?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), f.eventId, title, room, later(start), later(end))
      .run();
  const snapshot = await getAgenda(env.DB, f.eventId, f.eventSlug);
  snapshot.revision = 1;
  snapshot.publishedRevision = 1;
  const json = JSON.stringify(snapshot);
  await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=1")
    .bind(json, f.eventId)
    .run();
  await env.DB.prepare("DELETE FROM event_agenda_published_occurrences WHERE event_id=?").bind(f.eventId).run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_published_occurrences(event_id,revision,occurrence_id,payload_json) SELECT ?,1,json_extract(occurrence.value,'$.id'),occurrence.value FROM json_each(?,'$.occurrences') occurrence",
  )
    .bind(f.eventId, json)
    .run();
}

/** The approved agenda as the studio reads it. */
async function studioAgenda() {
  const response = await callApi(env, `/api/v1/events/${f.eventSlug}/agenda/participation/program`, {
    headers: { authorization: `Bearer ${f.tokens.operator}`, origin: "https://app.test" },
  });
  return personalAgendaProgramResponseSchema.parse(await response.json()).agenda;
}

/** Two approved questions, the second with a vote, so the top questions have an order to keep. */
async function askQuestions(operator: Client) {
  const attendee = await f.connect({ person: "attendee" });
  const voter = await f.connect({ person: "secondAttendee" });
  const ids: string[] = [];
  for (const [text, anonymous] of [
    ["Which algorithms come first?", true],
    ["How do we find every certificate?", false],
  ] as const) {
    const before = operator.received.length;
    attendee.send({ type: "question.ask", text, anonymous });
    const asked = await operator.next("question.changed", (m) => m.question.text === text, { after: before });
    operator.send({ type: "question.moderate", questionId: asked.question.id, status: "approved" });
    await operator.next(
      "question.changed",
      (m) => m.question.id === asked.question.id && m.question.status === "approved",
    );
    ids.push(asked.question.id);
  }
  voter.send({ type: "question.vote", questionId: ids[1]!, voted: true });
  await operator.next("question.changed", (m) => m.question.id === ids[1] && m.question.votes === 1);
}

/** The studio's copy of the room: every message the operator received, applied in order. */
function studioState(operator: Client): LiveRoomState {
  return operator.received.reduce<LiveRoomState | null>(applyLiveRoomMessage, null)!;
}

/** What a composition shows, without the moment it was resolved and who last changed a layer. */
function picture(stage: LiveStage) {
  return {
    ...stage,
    questionChange: null,
    lowerThirdChange: null,
    pollChange: null,
    schedule: stage.schedule && { ...stage.schedule, resolvedAt: null },
  };
}

const drawn = (stage: LiveStage) => LIVE_PROGRAM_LAYER_ORDER.filter((layer) => liveOverlayDrawn(stage, layer));

describe("scene thumbnails against the room", () => {
  beforeEach(() => f.setup());

  it.each([
    ["an empty Preview", {}],
    ["a Preview with a lower third and the ticker on", { ticker: TICKER, lowerThird: true }],
  ] as const)("draw what Preview shows once the scene is loaded, from %s", async (_name, start) => {
    await approvePanelAndLaterSessions();
    const operator = await f.connect({ person: "operator" });
    await askQuestions(operator);
    const agenda = await studioAgenda();
    const filled: Record<string, string[]> = {};
    for (const scene of ["default", "questions", "full-board", "break"]) {
      // Each scene loads on the same starting Preview, in the Default scene.
      const reset = operator.received.length;
      operator.send({
        type: "preview.set",
        composition: {
          ...liveCompositionInput(EMPTY_LIVE_STAGE),
          ticker: "ticker" in start ? start.ticker : null,
          creditKey: "lowerThird" in start ? `user:${f.users.speaker}` : null,
        },
      });
      const before = (await operator.next("preview.changed", () => true, { after: reset })).composition;
      const state = studioState(operator);
      expect(state.preview).toEqual(before);
      const thumbnail = liveSceneThumbnail(
        { preview: { ...state, stage: state.preview }, program: state.stage, agenda },
        scene,
        Date.now(),
      );
      const load = operator.received.length;
      operator.send({ type: "preview.set", composition: { scene } });
      const loaded = (await operator.next("preview.changed", () => true, { after: load })).composition;
      expect(thumbnail.unfilled, scene).toEqual([]);
      expect(drawn(thumbnail.state.stage), scene).toEqual(drawn(loaded));
      expect(picture(thumbnail.state.stage), scene).toEqual(picture(loaded));
      filled[scene] = drawn(loaded).filter((layer) => !drawn(before).includes(layer));
      // Up next lists the later sessions of both rooms, from the agenda the studio holds.
      if (scene === "break") expect(thumbnail.state.stage.schedule?.rooms.map((room) => room.title)).toHaveLength(2);
    }
    // The scenes differ by what comes on with them, filled with the room's own content.
    expect(filled).toEqual({ default: [], questions: ["topQuestions"], "full-board": [], break: ["schedule"] });
  });
});
