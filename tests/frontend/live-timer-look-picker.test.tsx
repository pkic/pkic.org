// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { liveTimerLookSetupSchema } from "../../assets/shared/schemas/live-studio-setup";
import {
  LiveTimerLookFields,
  useLiveTimerGraphic,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveTimerGraphicControls";
import { LiveTimerDialog } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/LiveTimerDialog";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { pitchTimer } from "../../assets/ts/ui/preview/studio-timers-fixtures";
import { button } from "./helpers/live-desk";
import { liveSnapshot, liveTargets } from "./helpers/live-room-socket";

let host: HTMLElement | null = null;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
});

it("shows each look as it goes on air, with the timer's own label, and picks one", async () => {
  host = document.body.appendChild(document.createElement("div"));
  const update = vi.fn();
  await act(() =>
    render(
      <LiveTimerLookFields
        draft={{ ...defaultLiveTimerGraphic("talk"), showLabel: true }}
        timerName="Talk"
        counts
        of={() => ({})}
        update={update}
      />,
      host!,
    ),
  );
  const looks = [...host.querySelectorAll<HTMLInputElement>('input[name="graphic.presentation"]')];
  expect(looks.map((look) => [look.value, look.checked])).toEqual([
    ["digital", true],
    ["bare", false],
    ["tab", false],
    ["ring", false],
  ]);
  const samples = [...host.querySelectorAll(".pk-live-timer-look__frame")];
  expect(samples.map((sample) => sample.getAttribute("data-look"))).toEqual(["digital", "bare", "tab", "ring"]);
  expect(samples[1]!.querySelector(".pk-live-overlay__timer-label")?.textContent).toBe("Talk");
  expect(samples[3]!.querySelector(".pk-live-timer-mark")).not.toBeNull();
  await act(() => looks[2]!.click());
  expect(update).toHaveBeenCalledWith("presentation", "tab");
});

const lookSetup = (saveGraphic = vi.fn(async () => null as string | null)) => ({
  graphics: {
    timer: {
      ...liveTimerLookSetupSchema.strip().parse(defaultLiveTimerGraphic("any")),
      showLabel: true,
      presentation: "ring" as const,
      placement: "top-right" as const,
    },
  },
  layouts: {},
  canSave: true,
  saveGraphic,
  saveLayout: vi.fn(async () => null),
});

it("starts a timer that shows nowhere from the event's timer look, with its own id", async () => {
  host = document.body.appendChild(document.createElement("div"));
  const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" } }))!;
  let timer: ReturnType<typeof useLiveTimerGraphic> | undefined;
  function Harness() {
    timer = useLiveTimerGraphic(liveTargets(state, { setup: lookSetup() }), "talk");
    return null;
  }
  await act(() => render(<Harness />, host!));
  expect(timer!.graphic).toEqual({ ...defaultLiveTimerGraphic("talk"), ...lookSetup().graphics.timer });
  expect(timer!.saveLook).toBeDefined();
});

it("saves the look for every timer of the event only when asked, and stays open when that fails", async () => {
  host = document.body.appendChild(document.createElement("div"));
  const saveLook = vi.fn(async () => "The studio setup was not saved." as string | null);
  const onClose = vi.fn();
  const graphic = defaultLiveTimerGraphic(pitchTimer.id);
  await act(() =>
    render(
      <LiveTimerDialog
        timer={pitchTimer}
        clock="Europe/Amsterdam"
        graphic={graphic}
        send={() => true}
        saveGraphic={() => true}
        saveLook={saveLook}
        onClose={onClose}
      />,
      host!,
    ),
  );
  const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
  const forEvent = [...dialog.querySelectorAll("label")].find((label) =>
    label.textContent?.includes("Start every timer of the event with this look"),
  )!;
  await act(async () => button(dialog, "Save").click());
  expect(saveLook).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => forEvent.querySelector("input")!.click());
  await act(async () => button(dialog, "Save").click());
  expect(saveLook).toHaveBeenCalledWith(graphic);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(dialog.textContent).toContain("The studio setup was not saved.");
  saveLook.mockResolvedValueOnce(null);
  await act(async () => button(dialog, "Save").click());
  expect(onClose).toHaveBeenCalledTimes(2);
});
