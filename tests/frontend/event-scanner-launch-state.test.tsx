import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { host, mocks, mount } from "./event-scanner-fixture";

it("keeps background badge refresh errors out of the task chooser and clears stale preparation copy on exit", async () => {
  mocks.manifestReady = false;
  mocks.manifestError = "Badge data changed during refresh. Try again shortly.";
  await mount(true, ["attendance"]);
  const launch = host.querySelector("#scanner-scan-panel")!;
  expect(launch.textContent).not.toContain(mocks.manifestError);
  expect(launch.textContent).not.toContain("Preparing scanner for this session");
  const start = Array.from(launch.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Start scanning",
  )!;
  await act(async () => start.click());
  const scanner = host.querySelector(".pk-fast-scanner")!;
  expect(scanner.textContent).toContain(mocks.manifestError);
  await act(async () =>
    Array.from(scanner.querySelectorAll("button"))
      .find((button) => button.getAttribute("aria-label") === "Close scanner")!
      .click(),
  );
  expect(host.querySelector(".pk-fast-scanner")).toBeNull();
  expect(launch.textContent).not.toContain("Preparing badge checks");
});
