// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { PDFDocument } from "pdf-lib";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { toCanvas } from "html-to-image";
import { badgePrintPdf } from "../../assets/ts/components/event-badges/badge-print-pdf";

vi.mock("html-to-image", () => ({ toCanvas: vi.fn() }));
const png = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=="),
  (character) => character.charCodeAt(0),
);
let frame: HTMLIFrameElement;
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  frame = document.createElement("iframe");
  document.body.append(frame);
  const content = frame.contentDocument!;
  Object.defineProperty(content, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve(), forEach: () => {} },
  });
  content.body.innerHTML = '<section class="badge-print-sheet"></section><section class="badge-print-sheet"></section>';
  vi.mocked(toCanvas)
    .mockReset()
    .mockImplementation(
      async () =>
        ({ width: 100, height: 100, toBlob: (done: BlobCallback) => done(new Blob([png])) }) as HTMLCanvasElement,
    );
});
afterEach(() => {
  frame.remove();
  vi.unstubAllGlobals();
});

it("downloads a real PDF with one correctly sized page per front/back print sheet", async () => {
  const file = await badgePrintPdf(frame.contentDocument!, { widthMm: 105, heightMm: 148 }, () => true);
  expect(file.type).toBe("application/pdf");
  const pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPages()[0].getWidth()).toBeCloseTo((105 * 72) / 25.4);
  expect(pdf.getPages()[1].getHeight()).toBeCloseTo((148 * 72) / 25.4);
});

it("does not return a file when its print context becomes invalid while a sheet renders", async () => {
  let current = true;
  vi.mocked(toCanvas).mockImplementationOnce(async () => {
    current = false;
    return { width: 100, height: 100, toBlob: (done: BlobCallback) => done(new Blob([png])) } as HTMLCanvasElement;
  });
  await expect(badgePrintPdf(frame.contentDocument!, { widthMm: 100, heightMm: 50 }, () => current)).rejects.toThrow(
    "no longer available",
  );
  expect(toCanvas).toHaveBeenCalledTimes(1);
});

it("refuses an empty document instead of releasing a blank PDF", async () => {
  frame.contentDocument!.body.replaceChildren();
  await expect(badgePrintPdf(frame.contentDocument!, { widthMm: 100, heightMm: 50 }, () => true)).rejects.toThrow(
    "No print pages",
  );
  expect(toCanvas).not.toHaveBeenCalled();
});

it("rejects oversized PDF selections before capturing any sheet", async () => {
  frame.contentDocument!.body.innerHTML = '<section class="badge-print-sheet"></section>'.repeat(201);
  await expect(badgePrintPdf(frame.contentDocument!, { widthMm: 105, heightMm: 148 }, () => true)).rejects.toThrow(
    "HTML print file",
  );
  expect(toCanvas).not.toHaveBeenCalled();
});
