import { beforeEach, describe, expect, it, vi } from "vitest";
import { livePresenceKey } from "../assets/shared/live-room-presence";
import { defaultLiveTimerGraphic } from "../assets/shared/schemas/live-session-timer";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
const GRAPHIC = defaultLiveTimerGraphic("session");

const focusOn = (target: "preview" | "program" | "aux" | null) => ({
  panel: "speakers",
  item: `lowerThird:user:${f.users.speaker}`,
  target,
});

describe("live room shared Preview", () => {
  beforeEach(() => f.setup());

  it("is one composition every operator changes and sees, merged per layer, and never reaches anyone else", async () => {
    const olga = await f.connect({ person: "operator" });
    const rita = await f.connect({ person: "secondOperator" });
    const speaker = await f.connect({ person: "speaker" });
    const attendee = await f.connect({ person: "attendee" });

    olga.send({ type: "preview.set", composition: { creditKey: `user:${f.users.speaker}` } });
    const lined = await rita.next("preview.changed", (m) => m.composition.lowerThird !== null);
    expect(lined.composition.lowerThird?.name).toBe("Sam Speaker");
    expect(lined.composition.lowerThirdChange?.operatorName).toBe("Olga Operator");

    // Rita's change names only the timer; Olga's lower third and its change stay.
    rita.send({ type: "preview.set", composition: { timerGraphics: [GRAPHIC] } });
    for (const operator of [olga, rita]) {
      const merged = await operator.next("preview.changed", (m) => m.composition.timerGraphics.length > 0);
      expect(merged.composition.lowerThird?.name).toBe("Sam Speaker");
      expect(merged.composition.lowerThirdChange?.operatorName).toBe("Olga Operator");
    }
    // Preview is not Program.
    expect(olga.received.some((m) => m.type === "stage.changed")).toBe(false);
    for (const viewer of [speaker, attendee])
      expect(viewer.received.some((m) => m.type === "preview.changed")).toBe(false);

    const joined = await f.connect({ person: "operator" });
    expect((await joined.next("room.snapshot")).preview).toMatchObject({
      timerGraphics: [GRAPHIC],
      lowerThird: { name: "Sam Speaker" },
    });
    const late = await f.connect({ person: "secondAttendee" });
    expect((await late.next("room.snapshot")).preview).toMatchObject({ timerGraphics: [], lowerThird: null });
  });

  it("refuses an invalid change whole and keeps Preview as it was", async () => {
    const olga = await f.connect({ person: "operator" });
    olga.send({ type: "preview.set", composition: { creditKey: "user:nobody" } });
    expect((await olga.next("room.refused")).code).toBe("LIVE_CREDIT_NOT_FOUND");
    const attendee = await f.connect({ person: "attendee" });
    attendee.send({ type: "preview.set", composition: { timerGraphics: [GRAPHIC] } });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
    const joined = await f.connect({ person: "operator" });
    expect((await joined.next("room.snapshot")).preview).toMatchObject({ lowerThird: null, timerGraphics: [] });
  });

  it("takes Preview to Program, timer included, and keeps Preview's contents", async () => {
    const olga = await f.connect({ person: "operator" });
    const rita = await f.connect({ person: "secondOperator" });
    const attendee = await f.connect({ person: "attendee" });
    olga.send({ type: "preview.set", composition: { creditKey: `user:${f.users.speaker}`, timerGraphics: [GRAPHIC] } });
    await rita.next("preview.changed", (m) => m.composition.timerGraphics.length > 0);
    const previews = rita.received.filter((m) => m.type === "preview.changed").length;

    rita.send({ type: "preview.take" });
    for (const viewer of [olga, rita, attendee]) {
      const program = await viewer.next("stage.changed", (m) => m.stage.lowerThird !== null);
      expect(program.stage.lowerThird?.name).toBe("Sam Speaker");
      expect(program.stage.lowerThirdChange?.operatorName).toBe("Remote Rita");
      expect(program.stage.timerGraphics).toEqual([GRAPHIC]);
    }
    expect(rita.received.filter((m) => m.type === "preview.changed")).toHaveLength(previews);
    const joined = await f.connect({ person: "operator" });
    const snapshot = await joined.next("room.snapshot");
    expect(snapshot.preview).toMatchObject({ timerGraphics: [GRAPHIC], lowerThird: { name: "Sam Speaker" } });
    expect(snapshot.stage.lowerThird?.name).toBe("Sam Speaker");
  });
});

describe("live room operator presence", () => {
  beforeEach(() => f.setup());

  it("fans out to other operators only and leaves with the socket", async () => {
    const olga = await f.connect({ person: "operator" });
    const olgaElsewhere = await f.connect({ person: "operator" });
    const rita = await f.connect({ person: "secondOperator" });
    const speaker = await f.connect({ person: "speaker" });
    const attendee = await f.connect({ person: "attendee" });

    olga.send({ type: "presence.update", focus: focusOn("program"), pointer: null, changed: false });
    const seen = await rita.next("presence.changed");
    expect(seen.presence).toEqual({
      id: livePresenceKey(f.users.operator),
      name: "Olga Operator",
      focus: focusOn("program"),
      pointer: null,
      changed: false,
    });
    // A late operator sees where the others already are.
    const late = await f.connect({ person: "secondOperator" });
    expect((await late.next("presence.changed")).presence.name).toBe("Olga Operator");
    for (const viewer of [olga, olgaElsewhere, speaker, attendee])
      expect(viewer.received.some((m) => m.type.startsWith("presence."))).toBe(false);

    attendee.send({ type: "presence.update", focus: null, pointer: null, changed: false });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");

    olga.socket.close(1000, "Left");
    expect((await rita.next("presence.left")).id).toBe(livePresenceKey(f.users.operator));
  });

  it("coalesces a burst to the operator's pace and always delivers the latest position", async () => {
    const olga = await f.connect({ person: "operator" });
    const rita = await f.connect({ person: "secondOperator" });
    olga.send({ type: "presence.update", focus: null, pointer: { output: "preview", x: 0, y: 0 }, changed: false });
    await rita.next("presence.changed");
    const before = rita.received.filter((m) => m.type === "presence.changed").length;

    for (let step = 1; step <= 10; step++)
      olga.send({
        type: "presence.update",
        focus: focusOn(step === 3 ? "preview" : null),
        pointer: { output: "program", x: step / 10, y: 0.5 },
        // Only one update in the burst changes a control; the flag survives coalescing.
        changed: step === 3,
      });
    const last = await rita.next("presence.changed", (m) => m.presence.pointer?.x === 1);
    expect(last.presence.pointer).toEqual({ output: "program", x: 1, y: 0.5 });
    const burst = rita.received.filter((m) => m.type === "presence.changed").slice(before);
    expect(burst.length).toBeLessThanOrEqual(2);
    expect(burst.some((m) => m.type === "presence.changed" && m.presence.changed)).toBe(true);
    // Nothing more trails in after the room caught up.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(rita.received.filter((m) => m.type === "presence.changed").slice(before)).toHaveLength(burst.length);
    await vi.waitFor(() => expect(olga.received.some((m) => m.type === "presence.changed")).toBe(false));
  });
});
