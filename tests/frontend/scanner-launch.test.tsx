import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { useScannerAutoStart } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerAutoStart";

const host = document.createElement("div");
document.body.append(host);
type Options = Parameters<typeof useScannerAutoStart>[0];
function Harness(props: Options) {
  const launch = useScannerAutoStart(props);
  return (
    <>
      <button onClick={launch.request}>Choose destination</button>
      <button onClick={launch.cancel}>Cancel</button>
      <output>{String(launch.pending)}</output>
    </>
  );
}
afterEach(async () => {
  await act(() => render(null, host));
});
it("waits for the chosen room's preparation rather than using a previous room's ready flag", async () => {
  const onStart = vi.fn();
  const manifest: Options["manifest"] = { current: { occurrenceId: "old-session", roomId: "old-room" } };
  const props = {
    ready: true,
    preparing: false,
    manifestReady: true,
    manifest,
    targetId: "new-session",
    roomId: "new-room",
    onStart,
  };
  await act(() => render(<Harness {...props} />, host));
  await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(onStart).not.toHaveBeenCalled();
  await act(() => render(<Harness {...props} preparing manifestReady={false} />, host));
  manifest.current = { occurrenceId: "new-session", roomId: "new-room" };
  await act(() => render(<Harness {...props} />, host));
  expect(onStart).toHaveBeenCalledOnce();
  expect(host.querySelector("output")?.textContent).toBe("false");
});
it("can start with unverified feedback after preparation fails, while Cancel prevents a delayed launch", async () => {
  const onStart = vi.fn();
  const props: Options = {
    ready: true,
    preparing: true,
    manifestReady: false,
    manifest: { current: null },
    targetId: null,
    roomId: null,
    onStart,
  };
  await act(() => render(<Harness {...props} />, host));
  await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  await act(() => host.querySelectorAll<HTMLButtonElement>("button")[1]!.click());
  await act(() => render(<Harness {...props} preparing={false} error="Offline" />, host));
  expect(onStart).not.toHaveBeenCalled();
  await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(onStart).toHaveBeenCalledOnce();
});
