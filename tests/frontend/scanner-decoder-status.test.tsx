import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const prepare = vi.hoisted(() => vi.fn());
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/prepareScannerDecoder", () => ({
  prepareScannerDecoder: prepare,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-service-worker?worker&url", () => ({
  default: "/js/built/assets/scanner-worker.js",
}));
import { useScannerDecoderPreparation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerDecoderPreparation";
let host: HTMLDivElement;
function Harness({ scope = "event:operator" }: { scope?: string }) {
  return <p role="status">{useScannerDecoderPreparation(scope)}</p>;
}
beforeEach(() => {
  prepare.mockReset();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("reports failed decoder preparation without claiming offline camera readiness", async () => {
  vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn(async () => ({})) } });
  prepare.mockResolvedValue(false);
  await act(async () => render(<Harness />, host));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(host.textContent).toContain("Offline camera files are not prepared");
  expect(host.textContent).toContain("manual entry or a hardware scanner");
});
it("reports success only after the controlled decoder preparation completes", async () => {
  vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn(async () => ({})) } });
  let resolve!: (value: boolean) => void;
  prepare.mockImplementation(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  await act(async () => render(<Harness />, host));
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  expect(host.textContent).toBe("Preparing offline camera files…");
  expect(prepare.mock.calls[0]![0].aborted).toBe(false);
  await act(async () => resolve(true));
  expect(host.textContent).toBe("Offline camera files prepared.");
});
it("bounds a stalled worker registration and removes its deadline on unmount", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn(() => new Promise(() => {})) } });
  await act(async () => render(<Harness />, host));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(host.textContent).toContain("Offline camera files are not prepared");
  expect(prepare).not.toHaveBeenCalled();
  await act(() => render(null, host));
  expect(vi.getTimerCount()).toBe(0);
});
it("ignores a preparation response from the previous operator scope", async () => {
  vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn(async () => ({})) } });
  const resolvers: Array<(value: boolean) => void> = [];
  prepare.mockImplementation(() => new Promise<boolean>((resolve) => resolvers.push(resolve)));
  await act(async () => render(<Harness />, host));
  await vi.waitFor(() => expect(resolvers).toHaveLength(1));
  await act(async () => render(<Harness scope="event:next-operator" />, host));
  await vi.waitFor(() => expect(resolvers).toHaveLength(2));
  expect(prepare.mock.calls[0]![0].aborted).toBe(true);
  expect(prepare.mock.calls[1]![0].aborted).toBe(false);
  await act(async () => resolvers[0]!(true));
  expect(host.textContent).toBe("Preparing offline camera files…");
  await act(async () => resolvers[1]!(false));
  expect(host.textContent).toContain("Offline camera files are not prepared");
});
