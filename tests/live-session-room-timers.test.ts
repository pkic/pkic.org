import { runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { liveCompositionInput } from "../assets/shared/live-room-preview";
import { LIVE_SESSION_TIMER_ID } from "../assets/shared/live-timer-policy";
import { EMPTY_LIVE_STAGE } from "../assets/shared/schemas/live-session-room";
import { defaultLiveTimerGraphic } from "../assets/shared/schemas/live-session-timer";
import { LiveRoomSql } from "../functions/_lib/services/live-session/room-sql";
import { LiveRoomStore } from "../functions/_lib/services/live-session/room-store";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();

describe("live room timers", () => {
  beforeEach(() => f.setup());

  it("starts every room with a session timer that follows the agenda's end", async () => {
    const operator = await f.connect({ person: "operator" });
    const { timers, session } = await operator.next("room.snapshot");
    expect(timers).toEqual([
      expect.objectContaining({ id: LIVE_SESSION_TIMER_ID, kind: "session", running: true, anchorAt: session.endAt }),
    ]);
  });

  it("keeps several named timers that every operator starts, pauses, nudges and resets", async () => {
    const operator = await f.connect({ person: "operator" });
    const second = await f.connect({ person: "secondOperator" });
    operator.send({
      type: "timer.add",
      timer: { name: "Sponsor pitch", kind: "duration", targetAt: null, durationSeconds: 90 },
    });
    const added = (await second.next("timers.changed", (message) => message.timers.length === 2)).timers[1]!;
    expect(added).toMatchObject({ name: "Sponsor pitch", kind: "duration", running: false, heldMs: 90_000 });
    expect(added.change?.operatorName).toBeTruthy();

    operator.send({ type: "timer.control", timerId: added.id, action: "start" });
    const started = (await second.next("timers.changed", (message) => message.timers[1]!.running)).timers[1]!;
    expect(Date.parse(started.anchorAt!) - Date.parse(started.change!.at)).toBeGreaterThan(89_000);
    operator.send({ type: "timer.adjust", timerId: added.id, deltaSeconds: 60 });
    operator.send({ type: "timer.control", timerId: added.id, action: "pause" });
    const paused = (
      await second.next(
        "timers.changed",
        (message) => !message.timers[1]!.running && message.timers[1]!.heldMs > 90_000,
      )
    ).timers[1]!;
    expect(paused.heldMs).toBeGreaterThan(149_000);
    expect(paused.heldMs).toBeLessThanOrEqual(150_000);
    operator.send({ type: "timer.control", timerId: added.id, action: "reset" });
    expect(
      (await second.next("timers.changed", (message) => message.timers[1]!.heldMs === 90_000)).timers[1],
    ).toMatchObject({ running: false, anchorAt: null });

    // A stopwatch counts up from zero; a countdown to a time runs to it at once.
    const target = new Date(Date.now() + 30 * 60_000).toISOString();
    operator.send({
      type: "timer.add",
      timer: { name: "Doors", kind: "until", targetAt: target, durationSeconds: null },
    });
    operator.send({
      type: "timer.add",
      timer: { name: "Break", kind: "stopwatch", targetAt: null, durationSeconds: null },
    });
    const { timers } = await second.next("timers.changed", (message) => message.timers.length === 4);
    expect(timers.slice(2)).toEqual([
      expect.objectContaining({ name: "Doors", kind: "until", running: true, anchorAt: target }),
      expect.objectContaining({ name: "Break", kind: "stopwatch", running: false, heldMs: 0 }),
    ]);
    const restored = await f.connect({ person: "operator" });
    expect((await restored.next("room.snapshot")).timers.map((timer) => timer.name)).toEqual([
      "Session",
      "Sponsor pitch",
      "Doors",
      "Break",
    ]);
  });

  it("shows a timer graphic per output and takes it off everywhere when its timer is removed", async () => {
    const operator = await f.connect({ person: "operator" });
    operator.send({
      type: "timer.add",
      timer: { name: "Pitch", kind: "duration", targetAt: null, durationSeconds: 60 },
    });
    const pitch = (await operator.next("timers.changed", (message) => message.timers.length === 2)).timers[1]!;
    const graphic = { ...defaultLiveTimerGraphic(pitch.id), label: "Pitch time", format: "hh:mm:ss" as const };
    operator.send({ type: "stage.timer", timer: graphic, visible: true });
    operator.send({ type: "stage.timer", timer: defaultLiveTimerGraphic(LIVE_SESSION_TIMER_ID), visible: true });
    operator.send({
      type: "aux.set",
      output: "stage-display",
      composition: {
        ...liveCompositionInput(EMPTY_LIVE_STAGE),
        timerGraphics: [graphic, defaultLiveTimerGraphic(LIVE_SESSION_TIMER_ID)],
      },
    });
    operator.send({
      type: "preview.set",
      composition: { timerGraphics: [defaultLiveTimerGraphic(LIVE_SESSION_TIMER_ID)] },
    });
    expect(
      (await operator.next("stage.changed", (message) => message.stage.timerGraphics.length === 2)).stage.timerGraphics,
    ).toEqual([graphic, defaultLiveTimerGraphic(LIVE_SESSION_TIMER_ID)]);
    await operator.next("aux.changed", (message) => message.composition.timerGraphics[0]?.timerId === pitch.id);
    await operator.next("preview.changed", (message) => message.composition.timerGraphics.length > 0);

    operator.send({ type: "timer.remove", timerId: pitch.id });
    expect(
      (
        await operator.next(
          "stage.changed",
          (message) =>
            message.stage.timerGraphics.length === 1 &&
            message.stage.timerGraphics[0]?.timerId === LIVE_SESSION_TIMER_ID,
        )
      ).stage.timerGraphics[0].timerId,
    ).toBe(LIVE_SESSION_TIMER_ID);
    await operator.next(
      "aux.changed",
      (message) => message.output === "stage-display" && message.composition.timerGraphics.length === 1,
    );
    expect((await operator.next("timers.changed", (message) => message.timers.length === 1)).timers[0]!.id).toBe(
      LIVE_SESSION_TIMER_ID,
    );
    operator.send({ type: "stage.timer", timer: graphic, visible: true });
    expect((await operator.next("room.refused")).code).toBe("LIVE_TIMER_NOT_FOUND");
  });

  it("converts stored singular timer compositions once without losing other graphics or undo", async () => {
    await f.connect({ person: "operator" });
    await runInDurableObject(f.room(), (_room, state) => {
      const { timerGraphics: _timers, ...stage } = EMPTY_LIVE_STAGE;
      const prior = {
        ...stage,
        lowerThirdMotion: "cut",
        timer: { ...defaultLiveTimerGraphic("session"), format: "h:mm:ss" },
      };
      for (const [name, value] of [
        ["stage", prior],
        ["preview", prior],
        ["aux:projector", { ...prior, timer: null }],
        ["programUndo", { id: "saved", stage: prior }],
      ] as const)
        state.storage.sql.exec(
          "INSERT INTO room_controls(name,value_json) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value_json=excluded.value_json",
          name,
          JSON.stringify(value),
        );
      const store = new LiveRoomStore(new LiveRoomSql(state.storage.sql));
      expect(store.stage()).toMatchObject({
        lowerThirdMotion: "cut",
        timerGraphics: [{ timerId: "session", format: "hh:mm:ss" }],
      });
      expect(store.preview().timerGraphics).toHaveLength(1);
      expect(store.aux("projector").timerGraphics).toEqual([]);
      expect(store.programUndo()).toMatchObject({ id: "saved", stage: { timerGraphics: [{ timerId: "session" }] } });
      const saved = state.storage.sql
        .exec("SELECT value_json FROM room_controls WHERE name='stage'")
        .toArray()[0]!.value_json;
      expect(JSON.parse(String(saved))).not.toHaveProperty("timer");
      new LiveRoomStore(new LiveRoomSql(state.storage.sql)).stage();
      expect(
        state.storage.sql.exec("SELECT value_json FROM room_controls WHERE name='stage'").toArray()[0]!.value_json,
      ).toBe(saved);
    });
  });

  it("refuses a countdown to a time already gone and any timer command from an attendee", async () => {
    const operator = await f.connect({ person: "operator" });
    operator.send({
      type: "timer.add",
      timer: {
        name: "Late",
        kind: "until",
        targetAt: new Date(Date.now() - 60_000).toISOString(),
        durationSeconds: null,
      },
    });
    expect((await operator.next("room.refused")).code).toBe("LIVE_TIMER_TARGET_PAST");
    const attendee = await f.connect({ person: "attendee" });
    attendee.send({ type: "timer.control", timerId: LIVE_SESSION_TIMER_ID, action: "pause" });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
  });

  it("upgrades a stored stage timer output and the switcher overlay mode once, on read", async () => {
    await f.connect({ person: "operator" });
    await runInDurableObject(f.room(), (_room, state) => {
      const upsert = (name: string, value: unknown) =>
        state.storage.sql.exec(
          "INSERT INTO room_controls(name,value_json) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value_json=excluded.value_json",
          name,
          JSON.stringify(value),
        );
      state.storage.sql.exec("DELETE FROM room_controls WHERE name='aux:stage-display'");
      upsert("aux:stage-timer", {
        ...EMPTY_LIVE_STAGE,
        question: null,
        timerGraphics: [],
        panelists: { layout: "list" },
      });
      upsert("overlayMode", "obs");
      const store = new LiveRoomStore(new LiveRoomSql(state.storage.sql));
      expect(store.overlayMode()).toBe("switcher");
      expect(store.aux("stage-display").panelists).toEqual({ layout: "list" });
      expect(state.storage.sql.exec("SELECT 1 FROM room_controls WHERE name='aux:stage-timer'").toArray()).toEqual([]);
    });
  });
});
