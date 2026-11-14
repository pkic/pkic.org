// @vitest-environment jsdom
import { createRef, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  STUDIO_TOUR_STEPS,
  StudioTour,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/StudioTour";

let host: HTMLElement | undefined;
afterEach(() => {
  if (!host) return;
  void act(() => render(null, host!));
  host.remove();
  host = undefined;
});

it("walks through the studio's controls and leaves out the panels this layout has closed", async () => {
  host = document.body.appendChild(document.createElement("div"));
  const scope = createRef<HTMLDivElement>();
  const onClose = vi.fn();
  await act(() =>
    render(
      <div ref={scope}>
        <div data-presence-panel="monitor" />
        <div data-presence-panel="transition" />
        <div class="pk-studio-toolbar" />
        <StudioTour scope={scope} onClose={onClose} />
      </div>,
      host!,
    ),
  );
  const tour = () => host!.querySelector<HTMLElement>(".pk-guided-tour")!;
  expect(tour().textContent).toContain("Practice and live");
  expect(tour().textContent).toContain("1 of 3");
  const next = () => [...tour().querySelectorAll("button")].find((button) => button.textContent === "Next")!;
  await act(() => next().click());
  expect(tour().textContent).toContain("Go live with your practice");
  await act(() => next().click());
  expect(tour().textContent).toContain("Arrange your studio");
  expect(STUDIO_TOUR_STEPS).toHaveLength(9);
});
