import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { useScannerHardware } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerHardware";
let host: HTMLDivElement;
function Harness({ enabled, onBadge }: { enabled: boolean; onBadge: (credential: string) => void }) {
  useScannerHardware(enabled, onBadge);
  return null;
}
async function input(value: string) {
  await act(() => {
    for (const key of [...value, "Enter"])
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}
afterEach(() => {
  render(null, host);
  host.remove();
});
it("captures the first burst immediately when scanning opens or reopens", () => {
  host = document.createElement("div");
  document.body.append(host);
  const first = vi.fn(),
    next = vi.fn();
  const burst = (value: string) => {
    for (const key of [...value, "Enter"])
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };
  render(<Harness enabled onBadge={first} />, host);
  burst("badge-one");
  expect(first).toHaveBeenCalledExactlyOnceWith("badge-one");
  render(<Harness enabled={false} onBadge={first} />, host);
  burst("outside");
  expect(first).toHaveBeenCalledTimes(1);
  render(<Harness enabled onBadge={next} />, host);
  burst("badge-two");
  expect(next).toHaveBeenCalledExactlyOnceWith("badge-two");
});
it("uses the latest scanner operation handler and stops capturing keys outside immersive mode", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const first = vi.fn(),
    next = vi.fn();
  await act(() => render(<Harness enabled onBadge={first} />, host));
  await input("badge-one");
  expect(first).toHaveBeenCalledExactlyOnceWith("badge-one");
  await act(() => render(<Harness enabled onBadge={next} />, host));
  await input("badge-two");
  expect(next).toHaveBeenCalledExactlyOnceWith("badge-two");
  expect(first).toHaveBeenCalledTimes(1);
  await act(() => render(<Harness enabled={false} onBadge={next} />, host));
  await input("badge-three");
  expect(next).toHaveBeenCalledTimes(1);
});
