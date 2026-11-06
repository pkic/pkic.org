import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { FastScannerView } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/FastScannerView";
import { BadgePdfActions } from "../../assets/ts/member-flows/portal/sections/events/detail/badges/BadgePdfActions";
import type { ScannerStatus } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerStatus";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const props = {
  purpose: "print" as const,
  context: "Labels",
  result: null,
  pending: 0,
  message: "",
  cameraActive: true,
  preview: false,
  onPreview: () => {},
  onExit: () => {},
};
const show = (status?: ScannerStatus) =>
  act(() => render(<FastScannerView {...props} status={status} statusActions={<button>Print again</button>} />, host));

it("shows print feedback centrally, resumes ready automatically, and retains the completed result without a Next button", async () => {
  vi.useFakeTimers();
  await show({ key: "job-1", tone: "eligible", title: "Print requested", detail: "Alex Morgan", transient: true });
  expect(host.querySelector(".pk-fast-scanner__feedback")?.textContent).toContain("Print requested");
  expect(host.querySelector(".pk-fast-scanner__feedback")?.textContent).toContain("Print again");
  await act(() => {
    vi.advanceTimersByTime(1800);
  });
  expect(host.querySelector(".pk-fast-scanner__label")?.textContent).toBe("Ready to scan and print");
  expect(host.querySelector('[aria-label="Recent scan results"]')?.textContent).toContain(
    "Print requested: Alex Morgan",
  );
  expect(host.textContent).not.toContain("Embedded view");
  expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Next")).toBe(false);
});

it("keeps a bounded, deduplicated result trail and leaves an error visible for recovery", async () => {
  await show({ key: "preparing", tone: "unverified", title: "Preparing", record: false });
  expect(host.querySelector('[aria-label="Recent scan results"]')).toBeNull();
  for (let i = 0; i < 7; i++) await show({ key: String(i), tone: "eligible", title: `Result ${i}` });
  await show({ key: "6", tone: "denied", title: "Could not print", detail: "Try PDF" });
  expect(host.querySelectorAll(".pk-fast-scanner__trail li")).toHaveLength(5);
  expect(host.querySelector(".pk-fast-scanner__trail")?.textContent).not.toContain("Result 0");
  expect(host.querySelector(".pk-fast-scanner__feedback")?.textContent).toContain("Could not print");
  expect(host.querySelector(".pk-fast-scanner--denied")).not.toBeNull();
});

it("shares a real PDF file from an explicit click when file sharing is supported", async () => {
  const share = vi.fn(async (_data: ShareData) => {});
  vi.stubGlobal("navigator", { canShare: () => true, share });
  await act(() =>
    render(<BadgePdfActions pdf={new Blob(["PDF"], { type: "application/pdf" })} url="blob:preview" />, host),
  );
  await act(async () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Share PDF")!.click(),
  );
  expect(share).toHaveBeenCalledOnce();
  expect(share.mock.calls[0]?.[0]?.files?.[0]).toBeInstanceOf(File);
  expect(host.querySelector("a")).toBeNull();
});

it("offers Open PDF when sharing is unavailable and after a share failure", async () => {
  vi.stubGlobal("navigator", {});
  await act(() => render(<BadgePdfActions pdf={new Blob(["PDF"])} url="blob:preview" />, host));
  expect(host.querySelector("a")?.textContent).toContain("Open PDF");
  vi.stubGlobal("navigator", {
    canShare: () => true,
    share: vi.fn(async () => {
      throw new Error("Unavailable");
    }),
  });
  await act(() => render(<BadgePdfActions pdf={new Blob(["PDF"])} url="blob:preview" />, host));
  await act(async () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Share PDF")!.click(),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not share");
  expect(host.querySelector("a")?.textContent).toContain("Open PDF");
});
