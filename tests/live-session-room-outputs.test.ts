import { DEFAULT_LIVE_CHECK_IN_TEXT } from "../assets/shared/schemas/live-session-graphic-settings";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeAttendancePointResource } from "../assets/shared/attendance-points";
import { liveOverlayAccessResponseSchema } from "../assets/shared/schemas/live-session-room";
import { defaultLiveTimerGraphic } from "../assets/shared/schemas/live-session-timer";
import { parseCapabilityToken } from "../functions/_lib/auth/capability-token";
import { callApi } from "./helpers/app";
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
    expect(attendeeSnapshot.outputs.projector.lowerThird).toBeNull();
    expect(attendeeSnapshot.speakerMessage).toBeNull();

    operator.send({ type: "speaker.message", text: null, tone: "neutral", flash: false });
    expect((await speaker.next("speaker.message.changed", (m) => m.speakerMessage === null)).speakerMessage).toBeNull();
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
    operator.send({ type: "question.moderate", questionId: asked.question.id, status: "hidden" });
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
    expect(stage.stage.checkIn?.theme).toBe("black-on-white");
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

    // Joining later, only the stage display and the operators learn what Preview lines up next.
    const late = await f.connect({ overlay: access, output: "stage-display" });
    expect((await late.next("room.snapshot")).stageDisplayNext?.id).toBe(next);
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

  it("refuses a source that names an output the room does not draw", async () => {
    const response = await f.upgrade({ overlay: await overlayToken(), output: "lobby" });
    expect(response.status).toBe(400);
  });
});
