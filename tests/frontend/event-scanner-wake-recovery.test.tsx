import { host, mocks, mount } from "./event-scanner-fixture";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";

it("keeps the scanner open and restarts its camera after the phone wakes", async () => {
  await mount(true);
  const start = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Start scanning",
  )!;
  await act(async () => start.click());
  await vi.waitFor(() => expect(mocks.cameraStarted).toHaveBeenCalled());
  const started = mocks.cameraStarted.mock.calls.length;
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(host.querySelector(".pk-fast-scanner")).not.toBeNull();
  expect(mocks.cameraDestroyed).toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await vi.waitFor(() => expect(mocks.cameraStarted.mock.calls.length).toBeGreaterThan(started));
  expect(host.querySelector(".pk-fast-scanner")).not.toBeNull();
  visibility.mockRestore();
});

it("keeps the camera paused when the phone wakes with operator controls open", async () => {
  await mount(true);
  const start = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Start scanning",
  )!;
  await act(async () => start.click());
  await vi.waitFor(() => expect(mocks.cameraStarted).toHaveBeenCalled());
  const controls = host.querySelector<HTMLButtonElement>('button[aria-label="Operator controls"]')!;
  await act(async () => controls.click());
  expect(host.querySelector('[role="dialog"][aria-label="Scanner operator controls"]')).not.toBeNull();
  const started = mocks.cameraStarted.mock.calls.length;
  const visibility = vi.spyOn(document, "visibilityState", "get");
  try {
    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.cameraStarted).toHaveBeenCalledTimes(started);
  } finally {
    visibility.mockRestore();
  }
});
