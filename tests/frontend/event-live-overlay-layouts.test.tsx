// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
  liveOverlayBoxOf,
} from "../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_PRESETS,
  eventLiveOverlayLayoutPutSchema,
  eventLiveOverlayLayoutsResponseSchema,
  eventLiveOverlayPositionsPutSchema,
  type EventLiveOverlayLayoutPut,
  type EventLiveOverlayPositionsPut,
} from "../../assets/shared/schemas/live-overlay-layout";
import { EventLiveSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/EventLiveSettings";
import { controlFor, typeInto } from "./helpers/labeled-control";

const LAYOUTS = eventLiveOverlayLayoutsResponseSchema.parse({
  layouts: LIVE_OVERLAY_PRESETS.map((preset) => ({
    slug: preset,
    ...LIVE_OVERLAY_PRESET_LAYOUTS[preset],
    preset,
    builtIn: true,
    saved: false,
    updatedAt: null,
  })),
  positions: { elements: LIVE_OVERLAY_DEFAULT_POSITIONS, saved: false, updatedAt: null },
});
const POSITIONS_URL = "/api/v1/events/conference/settings/live/positions";
const QUESTION = LIVE_OVERLAY_PRESET_LAYOUTS["full-frame"].elements.question;

let root: HTMLElement | null = null;
let written: Array<{ url: string; body: EventLiveOverlayLayoutPut }> = [];
let positioned: EventLiveOverlayPositionsPut[] = [];
let stored = LAYOUTS;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  written = [];
  positioned = [];
  stored = LAYOUTS;
  history.replaceState(null, "", "/portal/#/events/conference/settings/live");
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // jsdom has no layout: the canvas is 960 × 540, half the broadcast frame.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("pk-layout-canvas") ? new DOMRect(0, 0, 960, 540) : new DOMRect(0, 0, 0, 0);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/participation/program")) return json({ agenda: null, marks: [], availability: [] });
      // The server's answer: every layout and the shared positions, as saved so far.
      const updatedAt = new Date(Date.now() + written.length + positioned.length).toISOString();
      if (init?.method === "PUT" && url === POSITIONS_URL) {
        const body = eventLiveOverlayPositionsPutSchema.parse(JSON.parse(String(init.body)));
        positioned.push(body);
        stored = { ...stored, positions: { elements: body.elements, saved: true, updatedAt } };
      } else if (init?.method === "PUT") {
        const body = eventLiveOverlayLayoutPutSchema.parse(JSON.parse(String(init.body)));
        written.push({ url, body });
        const slug = url.split("/").pop();
        stored = {
          ...stored,
          layouts: stored.layouts.map((layout) =>
            layout.slug === slug ? { ...layout, elements: body.elements, saved: true, updatedAt } : layout,
          ),
        };
      }
      return json(stored);
    }),
  );
});
afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
    root = null;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<EventLiveSettings slug="conference" />, root!));
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    expect(root!.querySelector(".pk-layout-canvas")).not.toBeNull();
  });
  return root;
}
const box = (element: string) => root!.querySelector<HTMLButtonElement>(`button[data-element="${element}"]`)!;
function pointer(target: Element, type: string, x: number, y: number, extra: MouseEventInit = {}) {
  void act(
    () =>
      void target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...extra }),
      ),
  );
}
async function save() {
  await act(async () => {
    root!
      .querySelector("form.pk-layout-editor")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // The shared positions and the layout save one after the other.
  for (let step = 0; step < 6; step++)
    await act(async () => {
      await Promise.resolve();
    });
}

describe("overlay layout editor", () => {
  it("moves a shared box by dragging it and saves the shared position through its contract", async () => {
    await mount();
    const question = box("question");
    pointer(question, "pointerdown", 100, 200);
    pointer(question, "pointermove", 160, 200);
    pointer(question, "pointermove", 340, 200, { altKey: true });
    // While dragging, the box and the graphic drawn for it move by a transform; nothing is committed yet.
    expect(Number(/translate\(([\d.]+)px, 0px\)/.exec(question.style.transform)?.[1])).toBeCloseTo(240, 6);
    pointer(question, "pointerup", 340, 200);
    expect(question.style.transform).toBe("");
    expect(controlFor(root!, "From left").value).toBe(String(Math.round((QUESTION.x + 0.25) * 10_000) / 100));
    await save();
    // The question shares its position, so the move is the event's shared position; the layout itself is unchanged.
    expect(written).toHaveLength(0);
    expect(positioned).toHaveLength(1);
    const saved = positioned[0]!;
    expect(saved.expectedUpdatedAt).toBeNull();
    expect(saved.elements.question.x).toBeCloseTo(QUESTION.x + 0.25, 4);
    expect(saved.elements.question.y).toBeCloseTo(QUESTION.y, 4);
    expect(saved.elements.lowerThird).toEqual(LIVE_OVERLAY_DEFAULT_POSITIONS.lowerThird);
  });

  it("places an element for this layout only, then applies it to all layouts or uses the shared one again", async () => {
    await mount();
    const link = (state: string) =>
      root!.querySelector<HTMLButtonElement>(`button[aria-label="Question position: ${state}"]`)!;
    const choose = async (trigger: HTMLButtonElement, item: string) => {
      await act(() => trigger.click());
      await act(() =>
        [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
          .find((entry) => entry.textContent === item)!
          .click(),
      );
    };
    await choose(link("Shared position"), "Place differently on this layout");
    const question = box("question");
    pointer(question, "pointerdown", 100, 200);
    pointer(question, "pointermove", 340, 200, { altKey: true });
    pointer(question, "pointerup", 340, 200, { altKey: true });
    await save();
    // Unlinked, the move is this layout's own: only the layout is saved.
    expect(positioned).toHaveLength(0);
    expect(written[0]!.body.elements.question).toMatchObject({ shared: false });
    expect(written[0]!.body.elements.question.x).toBeCloseTo(QUESTION.x + 0.25, 4);

    await choose(link("This layout only"), "Apply this position to all layouts");
    await save();
    expect(positioned[0]!.elements.question.x).toBeCloseTo(QUESTION.x + 0.25, 4);
    expect(written[1]!.body.elements.question.shared).toBe(true);

    // Placed elsewhere again, "Use shared position" brings it back to the shared one.
    await choose(link("Shared position"), "Place differently on this layout");
    pointer(box("question"), "pointerdown", 100, 200);
    pointer(box("question"), "pointermove", 200, 260, { altKey: true });
    pointer(box("question"), "pointerup", 200, 260, { altKey: true });
    await choose(link("This layout only"), "Use shared position");
    expect(Number(controlFor(root!, "From left").value)).toBeCloseTo((QUESTION.x + 0.25) * 100, 1);
    expect(Number(controlFor(root!, "From top").value)).toBeCloseTo(QUESTION.y * 100, 1);
  });

  it("resizes from a handle, snapping its edge to the title-safe line", async () => {
    await mount();
    void act(() => box("question").click());
    const handle = box("question").querySelector('[data-handle="e"]')!;
    // The right edge starts at 888 px of the frame; dropped at 1816, it lands on the 1824 px safe line.
    pointer(handle, "pointerdown", 444, 270);
    pointer(handle, "pointermove", 908, 270);
    pointer(handle, "pointerup", 908, 270);
    expect(Number(controlFor(root!, "Width").value)).toBeCloseTo((0.95 - QUESTION.x) * 100, 1);
    expect(Number(controlFor(root!, "From left").value)).toBeCloseTo(QUESTION.x * 100, 1);
  });

  it("scales and moves the drawn graphic with its box, while resizing and once the box is set", async () => {
    await mount();
    void act(() => box("poll").click());
    const surface = () =>
      root!.querySelector<HTMLElement>('[data-overlay-element="poll"] > .pk-live-overlay__surface')!.style.cssText;
    const before = surface();
    const handle = box("poll").querySelector('[data-handle="sw"]')!;
    pointer(handle, "pointerdown", 516, 400);
    pointer(handle, "pointermove", 700, 300, { altKey: true });
    // The graphic follows the handle at once…
    expect(root!.querySelector<HTMLElement>('[data-overlay-element="poll"]')!.style.transform).toMatch(
      /scale\(0\.\d+\)/,
    );
    pointer(handle, "pointerup", 700, 300, { altKey: true });
    // …and is placed for the new box once it is dropped.
    expect(surface()).not.toBe(before);
  });

  it("draws the selected element's sample in full, the others faintly unless all samples are asked for", async () => {
    await mount();
    void act(() => box("poll").click());
    const dimmed = () =>
      [...root!.querySelectorAll<HTMLElement>("[data-overlay-element][data-dimmed]")].map(
        (layer) => layer.dataset.overlayElement,
      );
    expect(dimmed()).not.toContain("poll");
    expect(dimmed()).toContain("lowerThird");
    const all = [...root!.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((input) =>
      input.closest("label")?.textContent?.includes("Show all samples"),
    )!;
    await act(() => all.click());
    expect(dimmed()).toEqual([]);
  });

  it("shows the safe areas until the viewer turns them off, and remembers that", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    });
    await mount();
    expect(root!.querySelectorAll(".pk-layout-canvas__safe")).toHaveLength(2);
    const toggle = [...root!.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((input) =>
      input.closest("label")?.textContent?.includes("Safe areas"),
    )!;
    await act(() => toggle.click());
    expect(root!.querySelectorAll(".pk-layout-canvas__safe")).toHaveLength(0);
    expect([...stored.values()]).toEqual(["off"]);
  });

  it("nudges with the arrow keys and edits the exact box, alignment and visibility", async () => {
    await mount();
    const question = box("question");
    void act(() => question.focus());
    void act(() => void question.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    void act(
      () =>
        void question.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true })),
    );
    expect(Number(controlFor(root!, "From left").value)).toBeCloseTo((QUESTION.x + 1 / 1920) * 100, 2);
    expect(Number(controlFor(root!, "From top").value)).toBeCloseTo((QUESTION.y + 24 / 1080) * 100, 2);
    await act(() => controlFor(root!, "Pixels (1920 × 1080)").click());
    await typeInto(controlFor(root!, "Width"), "600");
    const visible = root!.querySelector<HTMLInputElement>('input[name="elements.question.visible"]')!;
    await act(() => visible.click());
    const horizontal = controlFor<HTMLSelectElement>(root!, "Horizontal alignment");
    await act(() => {
      horizontal.value = "right";
      horizontal.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await save();
    // Showing it is the layout's; where it sits is the shared position's.
    expect(written[0]!.body.elements.question.visible).toBe(false);
    const shared = positioned[0]!.elements.question;
    expect(shared.w).toBeCloseTo(600 / 1920, 4);
    expect(shared.horizontal).toBe("right");
    expect(shared.x).toBeCloseTo(QUESTION.x + 1 / 1920, 4);
    expect(liveOverlayBoxOf(written[0]!.body.elements.question)).toEqual(shared);
  });

  it("refuses a box that leaves the frame without sending it", async () => {
    await mount();
    void act(() => box("question").click());
    const width = controlFor(root!, "Width");
    await typeInto(width, "120");
    await save();
    expect(written).toHaveLength(0);
    expect(width.getAttribute("aria-invalid")).toBe("true");
  });

  it("creates a layout from the selected one under a source name taken from its name", async () => {
    await mount();
    await act(() => [...root!.querySelectorAll("button")].find((b) => b.textContent === "New layout")!.click());
    const name = controlFor(document.body, "Name");
    await typeInto(name, "Keynote scene");
    await act(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Create layout")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(written[0]!.url).toBe("/api/v1/events/conference/settings/live/layouts/keynote-scene");
    expect(written[0]!.body).toMatchObject({ expectedUpdatedAt: null, name: "Keynote scene", preset: "full-frame" });
  });
});
