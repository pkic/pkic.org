// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { BadgePrintCommand } from "../../assets/ts/components/event-badges/BadgePrintCommand";
import { BADGE_LABEL_PRINTING_CONTEXT } from "../../assets/shared/badge-label-policy";
import { badgeFaceBadge } from "./helpers/badge-face-fixture";
import { downloadBadgeArtifact } from "../../assets/ts/components/event-badges/badge-print-artifacts";
import { badgePrintPdf } from "../../assets/ts/components/event-badges/badge-print-pdf";

import { printBadgeDocument } from "../../assets/ts/components/event-badges/badge-print-command";
vi.mock("../../assets/ts/components/event-badges/badge-print-command", () => ({
  printBadgeDocument: vi.fn(async () => {}),
}));
const frameGate = vi.hoisted(() => ({ ready: () => {} }));
vi.mock("../../assets/ts/components/event-badges/BadgeDocumentFrame", () => ({
  BadgeDocumentFrame: ({
    frameRef,
    onReady,
  }: {
    frameRef: preact.RefObject<HTMLIFrameElement>;
    onReady: () => void;
  }) => {
    frameGate.ready = onReady;
    return <iframe ref={frameRef} />;
  },
}));
vi.mock("../../assets/ts/components/event-badges/badge-print-pdf", () => ({ badgePrintPdf: vi.fn() }));
vi.mock("../../assets/ts/components/event-badges/badge-print-artifacts", async (load) => ({
  ...(await load<typeof import("../../assets/ts/components/event-badges/badge-print-artifacts")>()),
  downloadBadgeArtifact: vi.fn(),
}));
let host: HTMLDivElement;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host));
    host.remove();
  }
  vi.clearAllMocks();
});

async function mount(action: "labels" | "label_pdf", beforeRelease = vi.fn(async () => true)) {
  host = document.createElement("div");
  document.body.append(host);
  const onComplete = vi.fn();
  const onError = vi.fn();
  const badges = [await badgeFaceBadge()];
  await act(() =>
    render(
      <BadgePrintCommand
        badges={badges}
        action={action}
        beforeRelease={beforeRelease}
        loadPrintingContext={async () => BADGE_LABEL_PRINTING_CONTEXT}
        onProgress={vi.fn()}
        onComplete={onComplete}
        onError={onError}
      />,
      host,
    ),
  );
  await vi.waitFor(() => expect(host.querySelector("iframe")).not.toBeNull());
  const frame = host.querySelector("iframe")!;
  const print = vi.mocked(printBadgeDocument);
  return { frame, print, onComplete, onError, beforeRelease };
}

it("opens printing only after all pages are ready and access is rechecked, does not wait for mobile afterprint", async () => {
  const { frame, print, onComplete, beforeRelease } = await mount("labels");
  expect(print).not.toHaveBeenCalled();
  expect(beforeRelease).not.toHaveBeenCalled();
  await act(() => frameGate.ready());
  await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  expect(beforeRelease).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledOnce();
  await act(() => frameGate.ready());
  expect(print).toHaveBeenCalledTimes(1);
  frame.contentWindow!.dispatchEvent(new Event("afterprint"));
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain("Print layout");
});

it("does not open printing when the final access check refuses", async () => {
  const { print, onComplete } = await mount(
    "labels",
    vi.fn(async () => false),
  );
  await act(() => frameGate.ready());
  expect(print).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
  expect(downloadBadgeArtifact).not.toHaveBeenCalled();
});

it("does not open printing after cancellation during the access check", async () => {
  let allow!: (value: boolean) => void;
  const { print } = await mount(
    "labels",
    vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          allow = resolve;
        }),
    ),
  );
  await act(() => frameGate.ready());
  await act(() => render(null, host));
  allow(true);
  await act(async () => {});
  expect(print).not.toHaveBeenCalled();
});

it("does not download a PDF cancelled during rendering", async () => {
  let finish!: (file: Blob) => void;
  vi.mocked(badgePrintPdf).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { onComplete } = await mount("label_pdf");
  await act(() => frameGate.ready());
  await vi.waitFor(() => expect(badgePrintPdf).toHaveBeenCalledTimes(1));
  await act(() => render(null, host));
  finish(new Blob(["synthetic PDF"]));
  await act(async () => {});
  expect(downloadBadgeArtifact).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
});

it("discards a PDF whose attendee data was replaced while rendering", async () => {
  let finish!: (file: Blob) => void;
  vi.mocked(badgePrintPdf).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount("label_pdf");
  await act(() => frameGate.ready());
  await vi.waitFor(() => expect(badgePrintPdf).toHaveBeenCalledTimes(1));
  const badge = { ...(await badgeFaceBadge()), firstName: "Updated" };
  const completed = vi.fn();
  await act(() =>
    render(
      <BadgePrintCommand
        badges={[badge]}
        action="labels"
        beforeRelease={async () => true}
        loadPrintingContext={async () => BADGE_LABEL_PRINTING_CONTEXT}
        onProgress={vi.fn()}
        onComplete={completed}
        onError={vi.fn()}
      />,
      host,
    ),
  );
  finish(new Blob(["old attendee PDF"]));
  await act(async () => {});
  expect(downloadBadgeArtifact).not.toHaveBeenCalled();
  expect(completed).not.toHaveBeenCalled();
});
