import { DEFAULT_LIVE_CHECK_IN_TEXT } from "../assets/shared/schemas/live-session-graphic-settings";
import { LIVE_GRAPHIC_THEME_DEFAULTS } from "../assets/shared/live-graphic-theme";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeAttendancePointResource } from "../assets/shared/attendance-points";
import { liveOverlayAccessResponseSchema } from "../assets/shared/schemas/live-overlay-access";
import { defaultLiveTimerGraphic } from "../assets/shared/schemas/live-session-timer";
import { DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS } from "../assets/shared/schemas/live-stage-display-settings";
import { DEFAULT_LIVE_SCREEN_SYNC } from "../assets/shared/schemas/live-screen-sync";
import { EMPTY_LIVE_STAGE, liveRoomRefusalCloseCode } from "../assets/shared/schemas/live-session-room";
import { liveCompositionInput } from "../assets/shared/live-room-preview";
import { LIVE_OVERLAY_STANDARD_ELEMENTS } from "../assets/shared/live-overlay-layout-presets";
import { DEFAULT_LIVE_TOP_QUESTIONS_CONFIG } from "../assets/shared/schemas/live-session-on-screen";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "../assets/shared/schemas/live-session-schedule";
import { DEFAULT_LIVE_TICKER_CONFIG } from "../assets/shared/schemas/live-session-ticker";
import { LIVE_OVERLAY_PRESETS } from "../assets/shared/schemas/live-overlay-layout";
import { parseCapabilityToken } from "../functions/_lib/auth/capability-token";
import { LiveRoomGraphicBasis } from "../functions/_lib/services/live-session/room-graphic-basis";
import { LiveRoomSql } from "../functions/_lib/services/live-session/room-sql";
import { callApi } from "./helpers/app";
import { installLiveRoomD1Profile, liveRoomD1Profile } from "./helpers/live-room-d1-profile";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();

const EMPTY_COMPOSITION = {
  questionId: null,
  creditKey: null,
  pollId: null,
  pollPresentation: { chart: "bar" as const },
  ticker: null,
  panelists: null,
  schedule: null,
  checkIn: null,
  timerGraphics: [],
};
const GRAPHIC = defaultLiveTimerGraphic("session");

async function overlayToken() {
  const headers = { authorization: `Bearer ${f.tokens.operator}`, origin: "https://app.test" };
  await callApi(env, f.programPath("/program"), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ occurrenceId: f.occurrenceId, expectedRevision: 0 }),
  });
  const issued = await callApi(env, f.programPath("/overlays"), { method: "POST", headers });
  return liveOverlayAccessResponseSchema.parse(await issued.json()).token;
}

type Client = Awaited<ReturnType<typeof f.connect>>;
type ScreenCommand = Extract<Parameters<Client["send"]>[0], { type: "aux.set" | "aux.scene" }>;
/** What a screen holds once the room answered this command: its next change, never an earlier one. */
async function screenAfter(client: Client, message: ScreenCommand) {
  const after = client.received.length;
  client.send(message);
  return (await client.next("aux.changed", (changed) => changed.output === message.output, { after })).composition;
}

describe("live room auxiliary outputs", () => {
  beforeEach(() => f.setup());

  it("composes an output for operators, speakers and overlays, never attendees, and keeps it for the next snapshot", async () => {
    const operator = await f.connect({ person: "operator" });
    const speaker = await f.connect({ person: "speaker" });
    const attendee = await f.connect({ person: "attendee" });
    const overlay = await f.connect({ overlay: await overlayToken() });
    operator.send({
      type: "aux.set",
      output: "projector",
      composition: { ...EMPTY_COMPOSITION, creditKey: `user:${f.users.speaker}`, timerGraphics: [GRAPHIC] },
    });
    for (const viewer of [operator, speaker, overlay]) {
      const changed = await viewer.next("aux.changed");
      expect(changed.output).toBe("projector");
      expect(changed.composition).toMatchObject({ timerGraphics: [GRAPHIC], lowerThird: { name: "Sam Speaker" } });
      expect(changed.composition.lowerThirdChange?.operatorName).toBe("Olga Operator");
    }
    // Program is a separate composition and stays as it was.
    expect(operator.received.some((message) => message.type === "stage.changed")).toBe(false);
    operator.send({ type: "speaker.message", text: "Please wrap up", tone: "warning", flash: true });
    expect((await speaker.next("speaker.message.changed")).speakerMessage).toMatchObject({
      text: "Please wrap up",
      tone: "warning",
      flash: true,
    });
    await overlay.next("speaker.message.changed");
    expect(attendee.received.some((m) => m.type === "aux.changed" || m.type === "speaker.message.changed")).toBe(false);

    const rejoined = await f.connect({ person: "operator" });
    const snapshot = await rejoined.next("room.snapshot");
    expect(snapshot.outputs.projector.lowerThird?.name).toBe("Sam Speaker");
    expect(snapshot.outputs["stage-display"].lowerThird).toBeNull();
    // The flash is room state: a stage display that reconnects keeps flashing until an operator stops it.
    expect(snapshot.speakerMessage).toMatchObject({ text: "Please wrap up", flash: true });
    const late = await f.connect({ person: "secondAttendee" });
    const attendeeSnapshot = await late.next("room.snapshot");
    // An attendee's snapshot holds no screen's composition.
    expect(attendeeSnapshot.outputs.projector?.lowerThird ?? null).toBeNull();
    expect(attendeeSnapshot.speakerMessage).toBeNull();

    operator.send({ type: "speaker.message", text: null, tone: "neutral", flash: false });
    expect((await speaker.next("speaker.message.changed", (m) => m.speakerMessage === null)).speakerMessage).toBeNull();
  });

  it("keeps the stage display's settings for the session, for its outputs only and set by operators only", async () => {
    const operator = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "attendee" });
    const overlay = await f.connect({ overlay: await overlayToken() });
    expect((await overlay.next("room.snapshot")).stageDisplaySettings).toEqual(DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS);
    const settings = { reactions: false, nearEndSeconds: 120, endsWithQuestions: false };
    operator.send({ type: "stage.display.settings", settings });
    expect((await overlay.next("stage.display.settings.changed")).settings).toEqual(settings);
    attendee.send({ type: "stage.display.settings", settings: DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
    expect(attendee.received.some((m) => m.type === "stage.display.settings.changed")).toBe(false);
    const rejoined = await f.connect({ person: "operator" });
    expect((await rejoined.next("room.snapshot")).stageDisplaySettings).toEqual(settings);
  });

  it("keeps each screen's sync with Program for the session, on by default and set by operators only", async () => {
    const operator = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "attendee" });
    const overlay = await f.connect({ overlay: await overlayToken() });
    expect((await overlay.next("room.snapshot")).screenSync).toEqual(DEFAULT_LIVE_SCREEN_SYNC);
    operator.send({ type: "screen.sync", output: "projector", sync: false });
    // Only the screens an operator set apart are listed; every other one follows Program.
    const changed = { projector: false };
    expect((await overlay.next("screen.sync.changed")).screenSync).toEqual(changed);
    attendee.send({ type: "screen.sync", output: "stage-display", sync: false });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
    expect(attendee.received.some((m) => m.type === "screen.sync.changed")).toBe(false);
    const rejoined = await f.connect({ person: "operator" });
    expect((await rejoined.next("room.snapshot")).screenSync).toEqual(changed);
  });

  it("merges each stage display change into the room's copy, so quick changes never undo each other", async () => {
    const operator = await f.connect({ person: "operator" });
    const overlay = await f.connect({ overlay: await overlayToken() });
    await overlay.next("room.snapshot");
    operator.send({ type: "stage.display.settings", settings: { reactions: false } });
    operator.send({ type: "stage.display.settings", settings: { endsWithQuestions: false } });
    const merged = { ...DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS, reactions: false, endsWithQuestions: false };
    expect(
      (await overlay.next("stage.display.settings.changed", (m) => !m.settings.endsWithQuestions)).settings,
    ).toEqual(merged);
  });

  it("refuses an invalid composition whole and leaves the output unchanged", async () => {
    const operator = await f.connect({ person: "operator" });
    operator.send({
      type: "aux.set",
      output: "stage-display",
      composition: { ...EMPTY_COMPOSITION, questionId: crypto.randomUUID(), timerGraphics: [GRAPHIC] },
    });
    expect((await operator.next("room.refused")).code).toBe("LIVE_QUESTION_NOT_FOUND");
    const attendee = await f.connect({ person: "attendee" });
    attendee.send({ type: "aux.set", output: "projector", composition: EMPTY_COMPOSITION });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
    const rejoined = await f.connect({ person: "operator" });
    expect((await rejoined.next("room.snapshot")).outputs["stage-display"]).toMatchObject({
      timerGraphics: [],
      question: null,
    });
  });

  it("takes a hidden question off every output it was on, the shared Preview included", async () => {
    const author = await f.connect({ person: "attendee" });
    const operator = await f.connect({ person: "operator" });
    author.send({ type: "question.ask", text: "When does RSA retire?", anonymous: false });
    const asked = await operator.next("question.changed");
    operator.send({ type: "question.moderate", questionId: asked.question.id, status: "approved" });
    await operator.next("question.changed", (m) => m.question.status === "approved");
    operator.send({
      type: "aux.set",
      output: "stage-display",
      composition: { ...EMPTY_COMPOSITION, questionId: asked.question.id },
    });
    await operator.next("aux.changed", (m) => m.composition.question?.id === asked.question.id);
    operator.send({ type: "preview.set", composition: { questionId: asked.question.id } });
    await operator.next("preview.changed", (m) => m.composition.question?.id === asked.question.id);
    operator.send({ type: "question.rewrite", questionId: asked.question.id, text: "When will RSA be retired?" });
    expect(
      (await operator.next("aux.changed", (m) => m.composition.question?.text === "When will RSA be retired?")).output,
    ).toBe("stage-display");
    await operator.next("preview.changed", (m) => m.composition.question?.text === "When will RSA be retired?");
    operator.send({ type: "question.moderate", questionId: asked.question.id, status: "hidden", reason: "spam" });
    const cleared = await operator.next("aux.changed", (m) => m.composition.question === null);
    expect(cleared.output).toBe("stage-display");
    await operator.next("preview.changed", (m) => m.composition.question === null);
  });

  it("signs the session's check-in code onto Program and any output, and refuses a code that does not exist", async () => {
    const operator = await f.connect({ person: "operator" });
    const checkIn = { kind: "session" as const, occurrenceId: f.occurrenceId };
    operator.send({
      type: "aux.set",
      output: "projector",
      composition: { ...EMPTY_COMPOSITION, checkIn, checkInTheme: "white-on-black" },
    });
    const projector = await operator.next("aux.changed", (m) => m.composition.checkIn !== null);
    // Each output keeps the theme it was given; Program, given none, shows the default white card.
    expect(projector.composition.checkIn).toMatchObject({
      selection: checkIn,
      label: "Post-quantum migration",
      theme: "white-on-black",
    });
    expect(projector.composition.checkIn?.path).toMatch(/^\/portal\/#\/events\/[^/]+\/check-in\/pkc1_/);
    operator.send({ type: "stage.set", ...EMPTY_COMPOSITION, checkIn });
    const stage = await operator.next("stage.changed", (m) => m.stage.checkIn !== null);
    expect(stage.stage.checkIn?.theme).toBe(LIVE_GRAPHIC_THEME_DEFAULTS.checkIn);
    expect(stage.stage.checkIn?.text).toEqual(DEFAULT_LIVE_CHECK_IN_TEXT);
    // Every output shows the session's own fixed code.
    expect(stage.stage.checkIn!.path).toBe(projector.composition.checkIn!.path);
    const parsed = parseCapabilityToken(stage.stage.checkIn!.path.split("/check-in/")[1]!, "attendance_point");
    expect(decodeAttendancePointResource(parsed!.resourceId)).toEqual({
      eventId: expect.any(String),
      selection: checkIn,
    });
    operator.send({
      type: "aux.set",
      output: "stage-display",
      composition: { ...EMPTY_COMPOSITION, checkIn: { kind: "session", occurrenceId: crypto.randomUUID() } },
    });
    expect((await operator.next("room.refused")).code).toBe("LIVE_CHECK_IN_UNAVAILABLE");
  });

  it("preserves check-in text and visibility independently on Preview, Program and AUX through a refresh and reconnect", async () => {
    const operator = await f.connect({ person: "operator" });
    const selection = { kind: "session" as const, occurrenceId: f.occurrenceId };
    const text = { visible: true, template: "{{#checkIn.label}}**{{checkIn.label}}**{{/checkIn.label}}" };
    operator.send({ type: "preview.set", composition: { checkIn: selection, checkInText: text } });
    expect(
      (await operator.next("preview.changed", (m) => m.composition.checkIn !== null)).composition.checkIn,
    ).toMatchObject({ selection, text });
    const hidden = { ...text, visible: false };
    operator.send({ type: "preview.set", composition: { checkInText: hidden } });
    await operator.next("preview.changed", (m) => m.composition.checkIn?.text.visible === false);
    operator.send({ type: "preview.take" });
    expect((await operator.next("stage.changed", (m) => m.stage.checkIn !== null)).stage.checkIn).toMatchObject({
      selection,
      text: hidden,
    });
    operator.send({
      type: "aux.set",
      output: "projector",
      composition: { ...EMPTY_COMPOSITION, checkIn: selection, checkInText: text },
    });
    await operator.next("aux.changed", (m) => m.output === "projector" && m.composition.checkIn !== null);
    // A refresh resolves the signed point again; it must retain each output's own text settings.
    await runDurableObjectAlarm(f.room());
    const rejoined = await f.connect({ person: "operator" });
    const snapshot = await rejoined.next("room.snapshot");
    expect(snapshot.stage.checkIn?.text).toEqual(hidden);
    expect(snapshot.preview.checkIn?.text).toEqual(hidden);
    expect(snapshot.outputs.projector.checkIn?.text).toEqual(text);
  });

  it("refuses invalid check-in templates atomically and keeps text changes operator-only", async () => {
    const operator = await f.connect({ person: "operator" });
    const checkIn = { kind: "session" as const, occurrenceId: f.occurrenceId };
    operator.send({ type: "preview.set", composition: { checkIn } });
    await operator.next("preview.changed", (m) => m.composition.checkIn !== null);
    operator.socket.send(
      JSON.stringify({
        type: "preview.set",
        composition: {
          checkInText: { visible: true, template: "{{#unclosed}}" },
          creditKey: `user:${f.users.speaker}`,
        },
      }),
    );
    expect((await operator.next("room.refused")).code).toBe("LIVE_ROOM_INVALID_MESSAGE");
    const attendee = await f.connect({ person: "attendee" });
    attendee.send({ type: "preview.set", composition: { checkInText: { visible: false, template: "Hidden" } } });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
    const rejoined = await f.connect({ person: "operator" });
    expect((await rejoined.next("room.snapshot")).preview).toMatchObject({
      lowerThird: null,
      checkIn: { text: DEFAULT_LIVE_CHECK_IN_TEXT },
    });
  });

  it("clears Program at once and lets any operator undo that clear, once", async () => {
    const operator = await f.connect({ person: "operator" });
    const remote = await f.connect({ person: "secondOperator" });
    const attendee = await f.connect({ person: "attendee" });
    operator.send({ type: "stage.lowerThird", creditKey: `user:${f.users.speaker}` });
    await attendee.next("stage.changed", (m) => m.stage.lowerThird !== null);
    operator.send({ type: "program.clear" });
    const cleared = await remote.next("program.cleared");
    expect(cleared.change.operatorName).toBe("Olga Operator");
    const empty = await attendee.next("stage.changed", (m) => m.stage.lowerThird === null);
    expect(empty.stage.lowerThirdChange?.operatorName).toBe("Olga Operator");
    expect(attendee.received.some((m) => m.type === "program.cleared")).toBe(false);

    remote.send({ type: "program.restore", snapshotId: cleared.snapshotId });
    const restored = await attendee.next(
      "stage.changed",
      (m) => m.stage.lowerThirdChange?.operatorName === "Remote Rita",
    );
    expect(restored.stage.lowerThird?.name).toBe("Sam Speaker");
    remote.send({ type: "program.restore", snapshotId: cleared.snapshotId });
    expect((await remote.next("room.refused")).code).toBe("LIVE_PROGRAM_UNDO_GONE");
    await runInDurableObject(f.room(), (_room, state) => {
      const actions = state.storage.sql
        .exec("SELECT action FROM staff_actions WHERE action LIKE 'live_session.program.%' ORDER BY seq")
        .toArray()
        .map((row) => row.action);
      expect(actions).toEqual(["live_session.program.cleared", "live_session.program.restored"]);
    });
  });

  it("shows the stage display the next question from Preview, and no audience output ever receives it", async () => {
    const access = await overlayToken();
    const operator = await f.connect({ person: "operator" });
    const author = await f.connect({ person: "attendee" });
    const speaker = await f.connect({ person: "speaker" });
    const stageDisplay = await f.connect({ overlay: access, output: "stage-display" });
    const program = await f.connect({ overlay: access, output: "program" });
    const projector = await f.connect({ overlay: access, output: "projector" });
    const approved = async (text: string) => {
      author.send({ type: "question.ask", text, anonymous: false });
      const asked = await operator.next("question.changed", (m) => m.question.text === text);
      operator.send({ type: "question.moderate", questionId: asked.question.id, status: "approved" });
      await operator.next(
        "question.changed",
        (m) => m.question.id === asked.question.id && m.question.status === "approved",
      );
      return asked.question.id;
    };
    const now = await approved("When does RSA retire?");
    const next = await approved("Which hybrid certificates work today?");
    operator.send({ type: "stage.question", questionId: now });
    await stageDisplay.next("stage.changed", (m) => m.stage.question?.id === now);
    operator.send({ type: "preview.set", composition: { questionId: next } });
    const cue = await stageDisplay.next("stage.display.next.changed", (m) => m.question?.id === next);
    expect(cue.question).toMatchObject({ text: "Which hybrid certificates work today?", authorName: "Ada Attendee" });
    await operator.next("preview.changed", (m) => m.composition.question?.id === next);
    for (const audience of [author, speaker, program, projector])
      expect(
        audience.received.some(
          (m) => m.type === "stage.display.next.changed" || (m.type === "room.snapshot" && m.stageDisplayNext),
        ),
      ).toBe(false);

    // The speaker sees the next question's votes as they come in.
    expect(cue.votes).toBe(0);
    author.send({ type: "question.vote", questionId: next, voted: true });
    expect((await stageDisplay.next("stage.display.next.changed", (m) => m.votes === 1)).question?.id).toBe(next);

    // Joining later, only the stage display and the operators learn what Preview lines up next.
    const late = await f.connect({ overlay: access, output: "stage-display" });
    const joined = await late.next("room.snapshot");
    expect([joined.stageDisplayNext?.id, joined.stageDisplayNextVotes]).toEqual([next, 1]);
    expect((await (await f.connect({ overlay: access })).next("room.snapshot")).stageDisplayNext).toBeNull();
    expect((await (await f.connect({ person: "speaker" })).next("room.snapshot")).stageDisplayNext).toBeNull();
    expect((await (await f.connect({ person: "operator" })).next("room.snapshot")).stageDisplayNext?.id).toBe(next);

    operator.send({ type: "preview.set", composition: { questionId: null } });
    expect((await stageDisplay.next("stage.display.next.changed", (m) => m.question === null)).question).toBeNull();
  });

  it("keeps how each composition's lower third moves, set on Preview and taken to Program", async () => {
    const operator = await f.connect({ person: "operator" });
    operator.send({
      type: "preview.set",
      composition: { lowerThirdMotion: "cut", creditKey: `user:${f.users.speaker}` },
    });
    expect(
      (await operator.next("preview.changed", (m) => m.composition.lowerThird !== null)).composition,
    ).toMatchObject({
      lowerThirdMotion: "cut",
    });
    operator.send({ type: "preview.take" });
    expect((await operator.next("stage.changed", (m) => m.stage.lowerThird !== null)).stage.lowerThirdMotion).toBe(
      "cut",
    );
    operator.send({ type: "stage.lowerThird", creditKey: null, motion: "animated" });
    const off = await operator.next("stage.changed", (m) => m.stage.lowerThird === null);
    expect(off.stage.lowerThirdMotion).toBe("animated");
    // Another output keeps its own.
    expect(
      (await (await f.connect({ person: "operator" })).next("room.snapshot")).outputs.projector.lowerThirdMotion,
    ).toBe("animated");
  });

  it("takes Preview to Program exactly, scene and comes-on graphics included, and a graphic put on Program leaves its scene alone", async () => {
    const operator = await f.connect({ person: "operator" });
    operator.send({ type: "preview.set", composition: { scene: "questions", creditKey: `user:${f.users.speaker}` } });
    const preview = (await operator.next("preview.changed", (m) => m.composition.scene !== null)).composition;
    expect(preview.scene).toBe("questions");
    operator.send({ type: "preview.take" });
    const taken = (await operator.next("stage.changed", (m) => m.stage.scene !== null)).stage;
    expect(taken).toMatchObject({
      scene: "questions",
      lowerThird: { name: "Sam Speaker" },
      topQuestions: preview.topQuestions,
    });
    expect(liveCompositionInput(taken)).toEqual(liveCompositionInput(preview));
    operator.send({ type: "stage.lowerThird", creditKey: null });
    expect((await operator.next("stage.changed", (m) => m.stage.lowerThird === null)).stage.scene).toBe("questions");
  });

  it("clears Program to a blank frame in the Default scene, and an undo brings the scene back with the graphics", async () => {
    const operator = await f.connect({ person: "operator" });
    operator.send({ type: "preview.set", composition: { scene: "questions", creditKey: `user:${f.users.speaker}` } });
    await operator.next("preview.changed", (m) => m.composition.scene === "questions");
    operator.send({ type: "preview.take" });
    await operator.next("stage.changed", (m) => m.stage.scene === "questions");
    operator.send({ type: "program.clear" });
    const cleared = await operator.next("program.cleared");
    const blank = (await operator.next("stage.changed", (m) => m.stage.scene === null)).stage;
    expect(liveCompositionInput(blank)).toEqual(liveCompositionInput(EMPTY_LIVE_STAGE));
    // The clear is Program's alone: Preview keeps its shot, and a screen nobody composed has no scene.
    const rejoined = await (await f.connect({ person: "operator" })).next("room.snapshot");
    expect(rejoined.stage.scene).toBeNull();
    expect(rejoined.preview).toMatchObject({ scene: "questions", lowerThird: { name: "Sam Speaker" } });
    expect(rejoined.outputs.projector.scene).toBeNull();
    operator.send({ type: "program.restore", snapshotId: cleared.snapshotId });
    const restored = (await operator.next("stage.changed", (m) => m.stage.scene === "questions")).stage;
    expect(restored.lowerThird?.name).toBe("Sam Speaker");
    expect(restored.topQuestions).not.toBeNull();
  });

  it("switches on only a scene's comes-on graphics when it loads on Preview, and leaves every pick and studio switch as it was", async () => {
    const operator = await f.connect({ person: "operator" });
    operator.send({
      type: "preview.set",
      composition: { creditKey: `user:${f.users.speaker}`, timerGraphics: [GRAPHIC], reactions: true },
    });
    const set = (await operator.next("preview.changed", (m) => m.composition.lowerThird !== null)).composition;

    // Q&A brings its top questions on, filled by the room; the lower third, the timer and reactions stay as set.
    operator.send({ type: "preview.set", composition: { scene: "questions" } });
    const questions = (await operator.next("preview.changed", (m) => m.composition.scene === "questions")).composition;
    expect(questions).toEqual({
      ...set,
      scene: "questions",
      topQuestions: { config: DEFAULT_LIVE_TOP_QUESTIONS_CONFIG, questions: [] },
    });

    // Break brings Up next on and switches nothing off: the top questions stay on for a scene that draws them.
    operator.send({ type: "preview.set", composition: { scene: "break" } });
    const pause = (await operator.next("preview.changed", (m) => m.composition.scene === "break")).composition;
    expect(pause.schedule?.config).toEqual({ ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "all-rooms" });
    expect({ ...pause, schedule: null, scene: "questions" }).toEqual(questions);

    // A panel needs more than one speaker, so Panel brings nothing on for this session.
    operator.send({ type: "preview.set", composition: { scene: "panel" } });
    const panel = (await operator.next("preview.changed", (m) => m.composition.scene === "panel")).composition;
    expect(panel.panelists).toBeNull();

    // What the operator switched off stays off in every scene that only places it; a retired scene reads as Default.
    operator.send({ type: "preview.set", composition: { schedule: null, topQuestions: null, timerGraphics: [] } });
    await operator.next("preview.changed", (m) => m.composition.schedule === null);
    for (const scene of ["check-in", "full-board", "default", "talk"]) {
      operator.send({ type: "preview.set", composition: { scene } });
      const loaded = (await operator.next("preview.changed", (m) => m.composition.scene === scene)).composition;
      expect(liveCompositionInput(loaded), scene).toEqual({
        ...liveCompositionInput(EMPTY_LIVE_STAGE),
        creditKey: `user:${f.users.speaker}`,
        reactions: true,
        scene,
      });
    }

    // Loading its scene again brings a comes-on graphic back, with the timer the operator took off still off.
    const before = operator.received.length;
    operator.send({ type: "preview.set", composition: { scene: "questions" } });
    const again = (
      await operator.next("preview.changed", (m) => m.composition.scene === "questions", { after: before })
    ).composition;
    expect(again.topQuestions).not.toBeNull();
    expect(again.timerGraphics).toEqual([]);
    // Program is untouched until a Take.
    expect(operator.received.some((message) => message.type === "stage.changed")).toBe(false);
  });

  it("brings on an event's own scene's comes-on graphics the same way, from the scene's own setting", async () => {
    const elements = {
      ...LIVE_OVERLAY_STANDARD_ELEMENTS,
      ticker: { ...LIVE_OVERLAY_STANDARD_ELEMENTS.ticker, comesOn: true },
      reactions: { ...LIVE_OVERLAY_STANDARD_ELEMENTS.reactions, comesOn: true },
    };
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO event_live_overlay_layouts(event_id,slug,name,preset,elements_json,created_at,updated_at) VALUES(?,?,?,NULL,?,?,?)",
    )
      .bind(f.eventId, "keynote", "Keynote", JSON.stringify(elements), now, now)
      .run();
    const operator = await f.connect({ person: "operator" });
    operator.send({ type: "preview.set", composition: { creditKey: `user:${f.users.speaker}` } });
    await operator.next("preview.changed", (m) => m.composition.lowerThird !== null);
    operator.send({ type: "preview.set", composition: { scene: "keynote" } });
    const keynote = (await operator.next("preview.changed", (m) => m.composition.scene === "keynote")).composition;
    expect(keynote.ticker).toMatchObject(DEFAULT_LIVE_TICKER_CONFIG);
    expect(keynote.reactions).toBe(true);
    expect(liveCompositionInput(keynote)).toEqual({
      ...liveCompositionInput(EMPTY_LIVE_STAGE),
      creditKey: `user:${f.users.speaker}`,
      ticker: DEFAULT_LIVE_TICKER_CONFIG,
      reactions: true,
      scene: "keynote",
    });
  });

  it("reads a room's saved scenes again from the event when they still hold a built-in scene retired since", async () => {
    const operator = await f.connect({ person: "operator" });
    await operator.next("room.snapshot");
    await runInDurableObject(f.room(), (_room, state) => {
      const sql = new LiveRoomSql(state.storage.sql);
      const current = new LiveRoomGraphicBasis(sql).read();
      expect(current.layouts.map((layout) => layout.slug)).toEqual([...LIVE_OVERLAY_PRESETS]);
      // A room that hibernated before Talk was retired, and a board's own field flag with it.
      const talk = {
        slug: "talk",
        name: "Talk",
        preset: "talk",
        elements: {
          ...LIVE_OVERLAY_STANDARD_ELEMENTS,
          question: { ...LIVE_OVERLAY_STANDARD_ELEMENTS.question, background: true },
        },
      };
      state.storage.sql.exec(
        "UPDATE room_controls SET value_json=? WHERE name='graphicBasis'",
        JSON.stringify({ ...current, layouts: [...current.layouts, talk] }),
      );
      const stale = new LiveRoomGraphicBasis(sql);
      expect(stale.read().layouts).toEqual([]);
      // Not ready, so the room reads the event's scenes again on its next join.
      expect(stale.ready).toBe(false);
    });
  });

  it("clears Preview to a blank frame in the Default scene, and a room screen to empty in its own scene", async () => {
    const operator = await f.connect({ person: "operator" });
    const full = { creditKey: `user:${f.users.speaker}`, timerGraphics: [GRAPHIC] };
    // The studio's Clear of Preview: the empty composition, which names no scene, so the Default one.
    const cleared = liveCompositionInput(EMPTY_LIVE_STAGE);

    // Q&A's top questions came on with the scene; the clear takes them off and loads nothing back.
    operator.send({ type: "preview.set", composition: { ...full, scene: "questions" } });
    const loaded = (await operator.next("preview.changed", (m) => m.composition.lowerThird !== null)).composition;
    expect(loaded.topQuestions).not.toBeNull();
    operator.send({ type: "preview.set", composition: cleared });
    const preview = (await operator.next("preview.changed", (m) => m.composition.lowerThird === null)).composition;
    expect(liveCompositionInput(preview)).toEqual(cleared);
    expect(preview.scene).toBeNull();

    // A room screen's clear is the studio's empty composition naming the screen's scene, which it keeps.
    const screenCleared = { ...cleared, scene: "panel" };
    operator.send({ type: "aux.set", output: "projector", composition: { ...screenCleared, ...full } });
    await operator.next("aux.changed", (m) => m.composition.lowerThird !== null);
    operator.send({ type: "aux.set", output: "projector", composition: screenCleared });
    const screen = (await operator.next("aux.changed", (m) => m.composition.lowerThird === null)).composition;
    expect(liveCompositionInput(screen)).toEqual(screenCleared);
  });

  it("shows Preview exactly on a screen that follows Program, then carries each change of Program to it", async () => {
    const operator = await f.connect({ person: "operator" });
    /** The projector once the room answered a command that changes it. */
    const projectorAfter = async (message: Parameters<Client["send"]>[0]) => {
      const after = operator.received.length;
      operator.send(message);
      return (await operator.next("aux.changed", (changed) => changed.output === "projector", { after })).composition;
    };
    // Program shows the speaker's lower third, and the projector with it.
    const followed = await projectorAfter({ type: "stage.lowerThird", creditKey: `user:${f.users.speaker}` });
    expect(followed.lowerThird).toMatchObject({ name: "Sam Speaker" });

    // A take puts Preview on the projector exactly: its scene and its timer, and no lower third though Program has one.
    const taken = await projectorAfter({
      type: "aux.set",
      output: "projector",
      composition: { ...EMPTY_COMPOSITION, timerGraphics: [GRAPHIC], scene: "break" },
    });
    expect(liveCompositionInput(taken)).toEqual({
      ...liveCompositionInput(EMPTY_LIVE_STAGE),
      timerGraphics: [GRAPHIC],
      scene: "break",
    });

    // A ticker goes on Program and on the projector, which keeps everything Program did not touch.
    const withTicker = await projectorAfter({ type: "stage.ticker", ticker: DEFAULT_LIVE_TICKER_CONFIG });
    expect(withTicker.ticker).not.toBeNull();
    expect(withTicker).toMatchObject({ lowerThird: null, timerGraphics: [GRAPHIC], scene: "break" });
    // It comes off Program, and off the projector.
    expect((await projectorAfter({ type: "stage.ticker", ticker: null })).ticker).toBeNull();

    // With sync off the projector stays as it is, whatever changes on Program.
    operator.send({ type: "screen.sync", output: "projector", sync: false });
    await operator.next("screen.sync.changed");
    const frozen = operator.received.length;
    operator.send({ type: "stage.panelists", panelists: { layout: "panel" } });
    await operator.next("stage.changed", (changed) => changed.stage.panelists !== null);
    expect(operator.received.slice(frozen).some((m) => m.type === "aux.changed")).toBe(false);

    // Following again, it catches up with everything on Program, in its own scene.
    const caughtUp = await projectorAfter({ type: "screen.sync", output: "projector", sync: true });
    expect(caughtUp).toMatchObject({
      lowerThird: { name: "Sam Speaker" },
      panelists: { layout: "panel" },
      timerGraphics: [],
      scene: "break",
    });
  });

  it("changes the scene a screen draws and keeps what it holds, with what comes on with the scene", async () => {
    const operator = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "attendee" });
    const held = await screenAfter(operator, {
      type: "aux.set",
      output: "projector",
      composition: { ...EMPTY_COMPOSITION, timerGraphics: [GRAPHIC] },
    });
    expect(held.scene).toBeNull();
    // Q&A's top questions come on, as when the scene loads on Preview; the timer the screen held stays.
    const changed = await screenAfter(operator, { type: "aux.scene", output: "projector", scene: "questions" });
    expect(liveCompositionInput(changed)).toEqual({
      ...liveCompositionInput(EMPTY_LIVE_STAGE),
      timerGraphics: [GRAPHIC],
      topQuestions: DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
      scene: "questions",
    });
    // Program and Preview are never touched, and only an operator changes a screen's scene.
    expect(operator.received.some((m) => m.type === "stage.changed" || m.type === "preview.changed")).toBe(false);
    attendee.send({ type: "aux.scene", output: "projector", scene: "break" });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
  });

  it("loads the scene a room locked a screen that follows Program to before anyone takes to it, once, and keeps it", async () => {
    const now = new Date().toISOString();
    const screens = [
      ["projector", "Projector", "PRJ", "follow", "questions"],
      ["stage-display", "Stage display", "DSP", "speaker", null],
      ["foy", "Foyer", "FOY", "exact", "break"],
    ] as const;
    for (const [position, [key, name, code, role, scene]] of screens.entries())
      await env.DB.prepare(
        "INSERT INTO event_agenda_room_outputs(event_id,room_id,output_key,name,code,role,scene_slug,scene_locked,position,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(f.eventId, f.roomId, key, name, code, role, scene, scene ? 1 : 0, position, now)
        .run();

    // Nobody took anything to the projector: it is in its Q&A scene with the top questions that come on with it.
    const operator = await f.connect({ person: "operator" });
    const first = await operator.next("room.snapshot");
    expect(liveCompositionInput(first.outputs.projector)).toEqual({
      ...liveCompositionInput(EMPTY_LIVE_STAGE),
      topQuestions: DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
      scene: "questions",
    });
    // A screen that shows what you take to it is in its scene, and nothing comes on by itself there.
    expect(liveCompositionInput(first.outputs.foy)).toEqual({
      ...liveCompositionInput(EMPTY_LIVE_STAGE),
      scene: "break",
    });

    // An operator switches the top questions off and puts a timer there: the next join loads nothing back.
    const held = { ...EMPTY_COMPOSITION, timerGraphics: [GRAPHIC] };
    const off = await screenAfter(operator, {
      type: "aux.set",
      output: "projector",
      composition: { ...held, scene: "questions" },
    });
    expect(off).toMatchObject({ topQuestions: null, timerGraphics: [GRAPHIC] });
    await f.connect({ person: "attendee" });
    const rejoined = await (await f.connect({ person: "operator" })).next("room.snapshot");
    expect(rejoined.outputs.projector).toEqual(off);

    // A take names Preview's scene, yet the screen shows the shot in the scene its room locked it to; so does
    // any locked screen.
    const shot = await screenAfter(operator, {
      type: "aux.set",
      output: "projector",
      composition: { ...held, scene: "break" },
    });
    expect(shot).toMatchObject({ scene: "questions", topQuestions: null, schedule: null, timerGraphics: [GRAPHIC] });
    const foyer = await screenAfter(operator, {
      type: "aux.set",
      output: "foy",
      composition: { ...EMPTY_COMPOSITION, scene: "panel" },
    });
    expect(foyer.scene).toBe("break");
    expect(foyer.schedule).toBeNull();
    // A scene change sent to a locked screen leaves it in its scene too.
    expect((await screenAfter(operator, { type: "aux.scene", output: "foy", scene: "panel" })).scene).toBe("break");

    // The room's settings give the projector another scene: the next join loads it on what the screen holds,
    // from the room's own storage.
    await env.DB.prepare("UPDATE event_agenda_room_outputs SET scene_slug='break' WHERE room_id=? AND output_key=?")
      .bind(f.roomId, "projector")
      .run();
    await installLiveRoomD1Profile(f.room(), 1000);
    const after = operator.received.length;
    await f.connect({ person: "attendee" });
    const changed = (await operator.next("aux.changed", (m) => m.output === "projector", { after })).composition;
    // The join reads the session, with the room's screens, in its one round trip; loading the scene adds none.
    const profile = await liveRoomD1Profile(f.room());
    expect(profile.queries.map(({ sql }) => sql)).toEqual([expect.stringContaining("event_agenda_room_outputs")]);
    expect(profile.roundTrips).toBe(1);
    expect(liveCompositionInput(changed)).toEqual({
      ...liveCompositionInput(EMPTY_LIVE_STAGE),
      timerGraphics: [GRAPHIC],
      schedule: { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "all-rooms" },
      scene: "break",
    });
  });

  it("starts a screen in the scene its room set up for it, and keeps the scene a take brings after that", async () => {
    await env.DB.prepare(
      "INSERT INTO event_agenda_room_outputs(event_id,room_id,output_key,name,code,role,scene_slug,scene_locked,position,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(f.eventId, f.roomId, "projector", "Projector", "PRJ", "follow", "questions", 0, 0, new Date().toISOString())
      .run();
    const operator = await f.connect({ person: "operator" });
    const first = await operator.next("room.snapshot");
    expect(liveCompositionInput(first.outputs.projector)).toMatchObject({
      scene: "questions",
      topQuestions: DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
    });

    // A take changes its scene, and the next join leaves it there.
    const taken = await screenAfter(operator, {
      type: "aux.set",
      output: "projector",
      composition: { ...EMPTY_COMPOSITION, scene: "break" },
    });
    expect(taken.scene).toBe("break");
    const rejoined = await (await f.connect({ person: "operator" })).next("room.snapshot");
    expect(rejoined.outputs.projector.scene).toBe("break");
  });

  it("refuses a source that names an output the room does not draw", async () => {
    const response = await f.upgrade({ overlay: await overlayToken(), output: "Lobby!" });
    expect(response.status).toBe(400);
    // A screen the room does not set up, such as one since removed, is refused by the room.
    expect(await f.refusal({ overlay: await overlayToken(), output: "lobby" })).toMatchObject({
      code: liveRoomRefusalCloseCode(400),
      reason: "LIVE_ROOM_INVALID_OUTPUT",
    });
  });
});
