// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveRoomClientMessageSchema } from "../../assets/shared/schemas/live-session-room";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { liveSnapshot } from "./helpers/live-room-socket";
import {
  OPERATOR,
  button,
  commands,
  labeled,
  mountDesk,
  panel,
  resetDeskStorage,
  type,
  unmountDesks,
} from "./helpers/live-desk";

beforeEach(resetDeskStorage);
afterEach(unmountDesks);

describe("studio timers", () => {
  it("runs several named timers from the Time panel", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR }), "stage");
    const time = panel(host, "Time");
    expect(time.querySelector("output")?.textContent).toBe("50:00");
    void act(() => labeled(time, "Start Session").click());
    void act(() => labeled(time, "Add a minute to Session").click());
    void act(() => labeled(time, "Take a minute from Session").click());
    // The create action sits in the panel header and opens the form.
    void act(() => labeled(time, "Add timer").click());
    type(time.querySelector<HTMLInputElement>("input[name=name]")!, "Questions");
    // The length is set as hours, minutes and seconds.
    type(time.querySelector<HTMLInputElement>('input[name="durationSeconds.minutes"]')!, "10");
    type(time.querySelector<HTMLInputElement>('input[name="durationSeconds.seconds"]')!, "30");
    void act(() => button(time, "Add timer").click());
    expect(commands(live).map((sent) => liveRoomClientMessageSchema.parse(sent))).toEqual([
      { type: "timer.control", timerId: "session", action: "start" },
      { type: "timer.adjust", timerId: "session", deltaSeconds: 60 },
      { type: "timer.adjust", timerId: "session", deltaSeconds: -60 },
      { type: "timer.add", timer: { name: "Questions", kind: "duration", targetAt: null, durationSeconds: 630 } },
    ]);
    expect(time.querySelector("input[name=durationSeconds]")).toBeNull();
    const [session] = liveSnapshot().timers;
    const questions = {
      ...session!,
      id: "qa",
      name: "Questions",
      kind: "duration" as const,
      durationSeconds: 600,
      heldMs: 600_000,
    };
    void act(() => live.latest().deliver({ type: "timers.changed", timers: [session!, questions] }));
    expect([...time.querySelectorAll("output")].map((value) => value.textContent)).toEqual(["50:00", "10:00"]);
    void act(() => labeled(time, "Start Questions").click());
    expect(commands(live).at(-1)).toEqual({ type: "timer.control", timerId: "qa", action: "start" });
  });

  it("resets a timer from its row, sets what it does at zero, and hands a session timer back to the agenda", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR }), "stage");
    const time = panel(host, "Time");
    void act(() => labeled(time, "Reset Session").click());
    void act(() => labeled(time, "Session timer").click());
    void act(() => button(document.body, "Timer settings").click());
    const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
    const action = dialog.querySelector<HTMLSelectElement>("select[name='settings.atZero.action']")!;
    // A session has no length of its own to reset to, so the reset choice is not offered.
    expect([...action.options].map((option) => option.value)).toEqual(["overtime", "stop"]);
    void act(() => {
      action.value = "stop";
      action.dispatchEvent(new Event("change", { bubbles: true }));
    });
    void act(() => dialog.querySelector<HTMLInputElement>("input[name='settings.sound.chime']")!.click());
    void act(() => button(dialog, "Save").click());
    void act(() => labeled(time, "Session timer").click());
    void act(() => button(document.body, "Follow the agenda").click());
    expect(commands(live).map((sent) => liveRoomClientMessageSchema.parse(sent))).toEqual([
      { type: "timer.control", timerId: "session", action: "reset" },
      {
        type: "timer.configure",
        timerId: "session",
        settings: {
          atZero: { action: "stop", resetAfterSeconds: 10, restart: false },
          // One warning value: the chime sounds on the feeds when the time turns amber.
          sound: { warningSeconds: 120, zero: false },
        },
      },
      { type: "timer.control", timerId: "session", action: "follow" },
    ]);
  });

  it("renames a timer and changes its length from the same dialog", () => {
    const snapshot = liveSnapshot({ viewer: OPERATOR });
    const pitch = {
      ...snapshot.timers[0]!,
      id: "pitch",
      name: "Pitch",
      kind: "duration" as const,
      followsAgenda: false,
      durationSeconds: 180,
      heldMs: 180_000,
    };
    const { host, live } = mountDesk({ ...snapshot, timers: [snapshot.timers[0]!, pitch] }, "stage");
    void act(() => labeled(host, "Pitch timer").click());
    void act(() => button(document.body, "Timer settings").click());
    const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
    type(dialog.querySelector<HTMLInputElement>('input[name="edit.name"]')!, "Startup pitch");
    type(dialog.querySelector<HTMLInputElement>('input[name="edit.durationSeconds.minutes"]')!, "4");
    void act(() => button(dialog, "Save").click());
    expect(commands(live).map((sent) => liveRoomClientMessageSchema.parse(sent))).toEqual([
      { type: "timer.edit", timerId: "pitch", edit: { name: "Startup pitch", durationSeconds: 240 } },
    ]);
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("sends the timer graphic with its own settings", () => {
    const { host, live } = mountDesk(undefined, "stage");
    void act(() => labeled(host, "Session timer").click());
    void act(() => button(document.body, "Timer settings").click());
    const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
    type(dialog.querySelector<HTMLInputElement>('input[name="graphic.label"]')!, "Time left");
    for (const [name, value] of [
      ["format", "ss"],
      ["direction", "elapsed"],
      ["placement", "bottom-right"],
      ["size", "small"],
    ] as const) {
      const select = dialog.querySelector<HTMLSelectElement>(`select[name="graphic.${name}"]`)!;
      void act(() => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    type(dialog.querySelector<HTMLInputElement>('input[name="graphic.warningSeconds"]')!, "60");
    void act(() => button(dialog, "Save").click());
    void act(() => labeled(host, "Show Session timer on air").click());
    expect(commands(live).map((sent) => liveRoomClientMessageSchema.parse(sent))).toEqual([
      {
        type: "stage.timer",
        visible: true,
        timer: {
          ...defaultLiveTimerGraphic("session"),
          label: "Time left",
          format: "ss",
          direction: "elapsed",
          placement: "bottom-right",
          size: "small",
          warningSeconds: 60,
        },
      },
    ]);
  });

  it("saves a timer graphic onto the outputs that show it, and switches outputs from the row's menu", () => {
    const shown = defaultLiveTimerGraphic("session");
    const snapshot = liveSnapshot({ viewer: OPERATOR });
    const { host, live } = mountDesk(
      {
        ...snapshot,
        stage: { ...snapshot.stage, timerGraphics: [shown] },
        outputs: {
          ...snapshot.outputs,
          "stage-display": { ...snapshot.outputs["stage-display"], timerGraphics: [shown] },
        },
      },
      "stage",
    );
    void act(() => labeled(host, "Session timer").click());
    void act(() => button(document.body, "Timer settings").click());
    const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
    type(dialog.querySelector<HTMLInputElement>('input[name="graphic.label"]')!, "Time left");
    void act(() => button(dialog, "Save").click());
    const saved = { ...shown, label: "Time left" };
    const [onProgram, onStage] = commands(live).map((sent) => liveRoomClientMessageSchema.parse(sent));
    expect(onProgram).toEqual({ type: "stage.timer", timer: saved, visible: true });
    expect(onStage).toMatchObject({
      type: "aux.set",
      output: "stage-display",
      composition: { timerGraphics: [saved] },
    });
    // The menu switches each output with one tap and stays open for the next.
    void act(() => labeled(host, "Session timer").click());
    void act(() => button(document.body, "Projector").click());
    expect(liveRoomClientMessageSchema.parse(commands(live).at(-1))).toMatchObject({
      type: "aux.set",
      output: "projector",
      composition: { timerGraphics: [saved] },
    });
    // The stage display shows the session timer, so its switch is on.
    expect(button(document.body, "✓Stage display")).toBeTruthy();
  });

  it("saves a timer graphic onto Program and a screen as one broadcast, so neither is refused", async () => {
    const shown = defaultLiveTimerGraphic("session");
    const snapshot = liveSnapshot({ viewer: OPERATOR });
    const broadcasts: string[] = [];
    const broadcast = async (message: { type: string }, send: () => boolean) => {
      broadcasts.push(message.type);
      await Promise.resolve();
      return send();
    };
    const { host, live } = mountDesk(
      {
        ...snapshot,
        stage: { ...snapshot.stage, timerGraphics: [shown] },
        outputs: {
          ...snapshot.outputs,
          "stage-display": { ...snapshot.outputs["stage-display"], timerGraphics: [{ ...shown, size: "small" }] },
        },
      },
      "stage",
      broadcast,
    );
    void act(() => labeled(host, "Session timer").click());
    void act(() => button(document.body, "Timer settings").click());
    const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
    type(dialog.querySelector<HTMLInputElement>('input[name="graphic.label"]')!, "Time left");
    await act(async () => button(dialog, "Save").click());
    expect(broadcasts).toEqual(["stage.timer"]);
    // The screen showed the timer with other settings; it still takes the save.
    expect(commands(live).map((sent) => sent.type)).toEqual(["stage.timer", "aux.set"]);
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("keeps the graphic dialog open when the save cannot reach the room", () => {
    const shown = defaultLiveTimerGraphic("session");
    const snapshot = liveSnapshot({ viewer: OPERATOR });
    const { host, live } = mountDesk({ ...snapshot, stage: { ...snapshot.stage, timerGraphics: [shown] } }, "stage");
    void act(() => labeled(host, "Session timer").click());
    void act(() => button(document.body, "Timer settings").click());
    const dialog = document.querySelector<HTMLElement>("dialog[open]")!;
    type(dialog.querySelector<HTMLInputElement>('input[name="graphic.label"]')!, "Time left");
    // The room drops while the dialog is open.
    void act(() => live.latest().close());
    void act(() => button(dialog, "Save").click());
    expect(document.querySelector("dialog[open]")).toBe(dialog);
    expect(dialog.textContent).toContain("Try again when it is connected.");
  });

  it("refuses a countdown to a time without its time, as the contract does", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR }), "stage");
    const time = panel(host, "Time");
    void act(() => labeled(time, "Add timer").click());
    type(time.querySelector<HTMLInputElement>("input[name=name]")!, "Doors");
    const kind = time.querySelector<HTMLSelectElement>("select[name=kind]")!;
    void act(() => {
      kind.value = "until";
      kind.dispatchEvent(new Event("change", { bubbles: true }));
    });
    void act(() => button(time, "Add timer").click());
    expect(time.textContent).toContain("Enter the time it counts down to.");
    expect(commands(live)).toEqual([]);
  });
});
