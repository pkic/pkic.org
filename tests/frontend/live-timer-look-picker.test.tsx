// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { LiveTimerLookFields } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveTimerGraphicControls";

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
