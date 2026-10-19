import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeadshotDialogTemplates } from "../../assets/ts/site/HeadshotDialogTemplates";
import { cropHeadshot } from "../../assets/ts/shared/headshot/crop";

const drawImage = vi.fn();
let dimensions = { width: 1600, height: 800 };

beforeEach(() => {
  document.body.innerHTML = "<button>Upload photo</button><main></main>";
  render(<HeadshotDialogTemplates />, document.querySelector("main")!);
  document.querySelector("button")!.focus();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
    callback(new Blob(["jpeg"], { type: "image/jpeg" }));
  });
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = dimensions.width;
      naturalHeight = dimensions.height;
      onload?: () => void;
      set src(_value: string) {
        this.onload?.();
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  drawImage.mockClear();
  dimensions = { width: 1600, height: 800 };
  render(null, document.querySelector("main")!);
  document.body.innerHTML = "";
});

async function openCrop() {
  const result = cropHeadshot(new File(["image"], "portrait.jpg", { type: "image/jpeg" }));
  await vi.waitFor(() => expect(document.querySelector("dialog[open]")).not.toBeNull());
  const viewport = document.querySelector<HTMLElement>(".crop-headshot-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 294 },
    clientHeight: { configurable: true, value: 294 },
  });
  viewport.setPointerCapture = vi.fn();
  return { result, viewport, slider: document.querySelector<HTMLInputElement>(".crop-headshot-slider")! };
}

function sourceCrop() {
  return drawImage.mock.lastCall!.slice(1, 5).map((value: number) => value + 0);
}
function zoom(slider: HTMLInputElement, value: string) {
  slider.value = value;
  slider.dispatchEvent(new Event("input"));
}
function pointer(viewport: HTMLElement, type: string, x: number, y: number) {
  const event = new Event(type);
  Object.assign(event, { clientX: x, clientY: y, isPrimary: true, button: 0, pointerId: 1 });
  viewport.dispatchEvent(event);
}
function cancel() {
  document.querySelector<HTMLButtonElement>(".crop-headshot-cancel")!.click();
}

describe("headshot cropping", () => {
  it.each([
    { width: 1600, height: 800, source: [400, 0, 800, 800] },
    { width: 800, height: 1600, source: [0, 400, 800, 800] },
    { width: 800, height: 800, source: [0, 0, 800, 800] },
  ])("starts with a centered square for $width × $height images", async ({ width, height, source }) => {
    dimensions = { width, height };
    const { result } = await openCrop();
    expect(sourceCrop()).toEqual(source);
    cancel();
    expect(await result).toBeNull();
  });

  it("zooms around the center and never exposes empty image space", async () => {
    const { result, viewport, slider } = await openCrop();
    zoom(slider, "100");
    expect(sourceCrop()).toEqual([700, 300, 200, 200]);
    zoom(slider, "0");
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    expect(sourceCrop()).toEqual([400, 0, 800, 800]);
    cancel();
    await result;
  });

  it("drags in content coordinates, clamps to the image, and stops on pointer cancellation", async () => {
    const { result, viewport } = await openCrop();
    pointer(viewport, "pointerdown", 0, 0);
    pointer(viewport, "pointermove", 147, 0);
    expect(sourceCrop()).toEqual([0, 0, 800, 800]);
    pointer(viewport, "pointermove", -10000, -10000);
    expect(sourceCrop()).toEqual([800, 0, 800, 800]);
    viewport.dispatchEvent(new Event("pointercancel"));
    pointer(viewport, "pointermove", 0, 0);
    expect(sourceCrop()).toEqual([800, 0, 800, 800]);
    cancel();
    await result;
  });

  it("positions with arrow keys and scales pointer movement after resizing", async () => {
    const { result, viewport } = await openCrop();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true }));
    expect(sourceCrop()[0]).toBeCloseTo(480);
    Object.defineProperty(viewport, "clientWidth", { value: 200 });
    pointer(viewport, "pointerdown", 0, 0);
    pointer(viewport, "pointermove", 100, 0);
    expect(sourceCrop()[0]).toBeCloseTo(80);
    cancel();
    await result;
  });

  it("encodes the exact visible preview canvas and restores focus", async () => {
    const { result, slider } = await openCrop();
    zoom(slider, "100");
    const preview = document.querySelector("canvas")!;
    document.querySelector<HTMLButtonElement>(".crop-headshot-confirm")!.click();
    expect((await result)?.type).toBe("image/jpeg");
    expect(vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.instances[0]).toBe(preview);
    expect([preview.width, preview.height]).toEqual([1024, 1024]);
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("button"));
  });

  it("returns no image on Escape", async () => {
    const { result } = await openCrop();
    document.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(await result).toBeNull();
  });
});
