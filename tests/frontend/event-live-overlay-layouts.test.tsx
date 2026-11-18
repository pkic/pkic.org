// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
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
import { describeGraphicPosition } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-graphics";
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
const LOWER_THIRD = LIVE_OVERLAY_PRESET_LAYOUTS.talk.elements.lowerThird;

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
      .querySelector("form.pk-scenes__editor")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // Shared positions and the layout save sequentially; wait for the visible
  // saving state rather than assuming a fixed number of promise completions.
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    const submit = root!.querySelector('form.pk-scenes__editor button[type="submit"]');
    expect(submit).not.toBeNull();
    expect(submit?.getAttribute("aria-busy")).not.toBe("true");
  });
}

/** Opens a menu by its trigger and chooses one of its items. */
async function choose(trigger: HTMLButtonElement, item: string) {
  await act(() => trigger.click());
  const entry = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
    (candidate) => candidate.textContent === item,
  );
  if (!entry) throw new Error(`no menu item reads "${item}"`);
  await act(() => entry.click());
}
const button = (label: string) => root!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
/** The graphics list, front first, by the boxes' element names. */
const rows = () =>
  [...root!.querySelectorAll(".pk-scenes__graphics .pk-scenes__row")].map(
    (row) => row.querySelector<HTMLInputElement>("input[role=switch]")!.name.split(".")[1],
  );

describe("scene editor", () => {
  it("moves a shared box by dragging it and saves the shared position through its contract", async () => {
    await mount();
    const lowerThird = box("lowerThird");
    pointer(lowerThird, "pointerdown", 100, 200);
    pointer(lowerThird, "pointermove", 160, 200);
    pointer(lowerThird, "pointermove", 340, 200, { altKey: true });
    // While dragging, the box moves by a transform; nothing is committed yet.
    expect(Number(/translate\(([\d.]+)px, 0px\)/.exec(lowerThird.style.transform)?.[1])).toBeCloseTo(240, 6);
    pointer(lowerThird, "pointerup", 340, 200);
    expect(lowerThird.style.transform).toBe("");
    expect(controlFor(root!, "From left").value).toBe(String(Math.round((LOWER_THIRD.x + 0.25) * 10_000) / 100));
    await save();
    // The lower third shares its position, so the move is the event's shared position; the scene itself is unchanged.
    expect(written).toHaveLength(0);
    expect(positioned).toHaveLength(1);
    const saved = positioned[0]!;
    expect(saved.expectedUpdatedAt).toBeNull();
    expect(saved.elements.lowerThird.x).toBeCloseTo(LOWER_THIRD.x + 0.25, 4);
    expect(saved.elements.lowerThird.y).toBeCloseTo(LOWER_THIRD.y, 4);
    expect(saved.elements.question).toEqual(LIVE_OVERLAY_DEFAULT_POSITIONS.question);
  });

  it("places a graphic for this scene only, then applies it to all scenes or uses the shared one again", async () => {
    await mount();
    const actions = () => button("Actions for Lower third");
    await choose(actions(), "Place differently on this scene");
    const lowerThird = box("lowerThird");
    pointer(lowerThird, "pointerdown", 100, 200);
    pointer(lowerThird, "pointermove", 340, 200, { altKey: true });
    pointer(lowerThird, "pointerup", 340, 200, { altKey: true });
    await save();
    // Unlinked, the move is the scene's own: only the scene is saved.
    expect(positioned).toHaveLength(0);
    expect(written[0]!.body.elements.lowerThird).toMatchObject({ shared: false });
    expect(written[0]!.body.elements.lowerThird.x).toBeCloseTo(LOWER_THIRD.x + 0.25, 4);

    await choose(actions(), "Apply this position to all scenes");
    await save();
    expect(positioned[0]!.elements.lowerThird.x).toBeCloseTo(LOWER_THIRD.x + 0.25, 4);
    expect(written[1]!.body.elements.lowerThird.shared).toBe(true);

    // Placed elsewhere again, "Use shared position" brings it back to the shared one.
    await choose(actions(), "Place differently on this scene");
    pointer(box("lowerThird"), "pointerdown", 100, 200);
    pointer(box("lowerThird"), "pointermove", 200, 260, { altKey: true });
    pointer(box("lowerThird"), "pointerup", 200, 260, { altKey: true });
    await choose(actions(), "Use shared position");
    expect(Number(controlFor(root!, "From left").value)).toBeCloseTo((LOWER_THIRD.x + 0.25) * 100, 1);
    expect(Number(controlFor(root!, "From top").value)).toBeCloseTo(LOWER_THIRD.y * 100, 1);
  });

  it("resizes from a corner, snapping its edge to the title-safe line", async () => {
    await mount();
    void act(() => box("lowerThird").click());
    expect(
      [...box("lowerThird").querySelectorAll("[data-handle]")].map((handle) => handle.getAttribute("data-handle")),
    ).toEqual(["nw", "ne", "se", "sw"]);
    const handle = box("lowerThird").querySelector('[data-handle="se"]')!;
    // The right edge starts at 1296 px of the frame; dropped at 1816, it lands on the 1824 px safe line.
    pointer(handle, "pointerdown", 648, 513);
    pointer(handle, "pointermove", 908, 513);
    pointer(handle, "pointerup", 908, 513);
    expect(Number(controlFor(root!, "Width").value)).toBeCloseTo((0.95 - LOWER_THIRD.x) * 100, 1);
    expect(Number(controlFor(root!, "From left").value)).toBeCloseTo(LOWER_THIRD.x * 100, 1);
  });

  it("draws a labeled box for each graphic the scene shows and says where the selected one sits", async () => {
    await mount();
    const drawn = () => [...root!.querySelectorAll<HTMLElement>("button[data-element]")].map((b) => b.dataset.element);
    // Talk leaves the QR code out, and the scene-wide background is no graphic of its own.
    expect(drawn()).not.toContain("qrCode");
    expect(drawn()).not.toContain("background");
    expect(drawn()).not.toContain("stageDisplay");
    expect(drawn().sort()).toEqual([...rows()].sort());
    void act(() => box("ticker").click());
    expect(box("ticker").textContent).toBe("News tickerBottom bar");
    expect(box("ticker").getAttribute("aria-pressed")).toBe("true");
    const row = root!.querySelector(".pk-scenes__row[data-selected]")!;
    expect(row.textContent).toContain("News ticker");
    expect(row.textContent).toContain("Bottom bar");
  });

  it("shows the safe areas until the viewer turns them off, and remembers that", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    });
    await mount();
    expect(root!.querySelectorAll(".pk-layout-canvas__safe")).toHaveLength(2);
    await act(() => controlFor(root!, "Show safe areas").click());
    expect(root!.querySelectorAll(".pk-layout-canvas__safe")).toHaveLength(0);
    expect([...stored.values()]).toEqual(["off"]);
  });

  it("nudges with the arrow keys and edits the exact box and alignment", async () => {
    await mount();
    const lowerThird = box("lowerThird");
    void act(() => lowerThird.focus());
    void act(() => void lowerThird.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    void act(
      () =>
        void lowerThird.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }),
        ),
    );
    expect(root!.querySelector("summary")!.textContent).toBe("Exact position of Lower third");
    expect(Number(controlFor(root!, "From left").value)).toBeCloseTo((LOWER_THIRD.x + 1 / 1920) * 100, 2);
    expect(Number(controlFor(root!, "From top").value)).toBeCloseTo((LOWER_THIRD.y + 24 / 1080) * 100, 2);
    await act(() => controlFor(root!, "Pixels (1920 × 1080)").click());
    await typeInto(controlFor(root!, "Width"), "600");
    const horizontal = controlFor<HTMLSelectElement>(root!, "Horizontal alignment");
    await act(() => {
      horizontal.value = "right";
      horizontal.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await save();
    const shared = positioned[0]!.elements.lowerThird;
    expect(shared.w).toBeCloseTo(600 / 1920, 4);
    expect(shared.horizontal).toBe("right");
    expect(shared.x).toBeCloseTo(LOWER_THIRD.x + 1 / 1920, 4);
    expect(written).toHaveLength(0);
  });

  it("adds a graphic the scene does not show, removes one, and saves both as the scene's", async () => {
    await mount();
    const add = button("Add graphic");
    await act(() => add.click());
    // Only the Program graphics Talk leaves out; never the scene-wide background or the speaker's screen.
    expect([...document.querySelectorAll("[role=menuitem]")].map((item) => item.textContent)).toEqual(["QR code"]);
    await act(() => add.click());
    await choose(add, "QR code");
    expect(rows()).toContain("qrCode");
    expect(root!.querySelector(".pk-scenes__row[data-selected]")!.textContent).toContain("QR code");
    await choose(button("Actions for Lower third"), "Remove from scene");
    expect(rows()).not.toContain("lowerThird");
    expect(box("lowerThird")).toBeNull();
    await save();
    expect(written[0]!.body.elements.qrCode.visible).toBe(true);
    expect(written[0]!.body.elements.lowerThird.visible).toBe(false);
    expect(add.disabled).toBe(false);
  });

  it("switches the conference background behind one graphic and saves it with the scene", async () => {
    await mount();
    const background = root!.querySelector<HTMLInputElement>('input[aria-label="Background for Top questions"]')!;
    expect(background.getAttribute("role")).toBe("switch");
    expect(background.checked).toBe(false);
    await act(() => background.click());
    expect(background.checked).toBe(true);
    await save();
    // A shared graphic's background is the scene's own, like whether it shows.
    expect(positioned).toHaveLength(0);
    expect(written[0]!.body.elements.topQuestions).toMatchObject({ shared: true, background: true });
  });

  it("lists the scene's graphics front first and saves one moved up the stack as the scene's order", async () => {
    await mount();
    expect(rows().slice(0, 3)).toEqual(["reactions", "ticker", "timer"]);
    expect(rows()).not.toContain("qrCode");
    await choose(button("Actions for Reactions"), "Move down");
    expect(rows().slice(0, 2)).toEqual(["ticker", "reactions"]);
    const above = rows()[rows().indexOf("lowerThird") - 1]!;
    await choose(button("Actions for Lower third"), "Move up");
    expect(rows().indexOf("lowerThird")).toBe(rows().indexOf(above) - 1);
    await save();
    const { elements } = written[0]!.body;
    expect(elements.lowerThird.layer!).toBeGreaterThan(elements[above as "poll"].layer!);
    expect(elements.ticker.layer!).toBeGreaterThan(elements.reactions.layer!);
  });

  it("reorders by dragging a row's grip, keeping hidden graphics in their places", async () => {
    await mount();
    const list = [...root!.querySelectorAll<HTMLElement>(".pk-scenes__graphics .pk-scenes__row")];
    // Each row is 40 px high in this layout-free test, stacked from the top.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = list.indexOf(this);
      return new DOMRect(0, Math.max(0, index) * 40, 300, index < 0 ? 0 : 40);
    });
    const before = rows();
    const grip = list[0]!.querySelector(".pk-scenes__grip")!;
    pointer(grip, "pointerdown", 10, 20);
    pointer(grip, "pointermove", 10, 105);
    expect(list[2]!.dataset.drop).toBe("after");
    pointer(grip, "pointerup", 10, 105);
    expect(rows()).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
    await save();
    const { elements } = written[0]!.body;
    expect(elements.qrCode.layer).toBeDefined();
    expect(elements.reactions.layer!).toBeLessThan(elements.timer.layer!);
    expect(elements.reactions.layer!).toBeGreaterThan(elements.chat.layer!);
  });

  it("refuses a box that leaves the frame without sending it and opens its exact position", async () => {
    await mount();
    void act(() => box("question").click());
    const width = controlFor(root!, "Width");
    await typeInto(width, "120");
    await save();
    expect(written).toHaveLength(0);
    expect(width.getAttribute("aria-invalid")).toBe("true");
    expect(root!.querySelector("details")!.open).toBe(true);
  });

  it("renames the scene as part of its draft, under the same source name", async () => {
    await mount();
    await choose(button("Actions for Talk"), "Rename");
    const name = controlFor(document.body, "Name");
    await typeInto(name, "Keynote");
    await act(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Rename")!.click();
    });
    expect(root!.querySelector(".pk-scenes__editor > .pk-panel:first-child .pk-panel__title")!.textContent).toBe(
      "Keynote",
    );
    await save();
    expect(written[0]!.url).toBe("/api/v1/events/conference/settings/live/layouts/talk");
    expect(written[0]!.body.name).toBe("Keynote");
  });

  it("creates a scene from the selected one under a source name taken from its name", async () => {
    await mount();
    await act(() => [...root!.querySelectorAll("button")].find((b) => b.textContent === "New scene")!.click());
    const name = controlFor(document.body, "Name");
    await typeInto(name, "Keynote scene");
    await act(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Create scene")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(written[0]!.url).toBe("/api/v1/events/conference/settings/live/layouts/keynote-scene");
    expect(written[0]!.body).toMatchObject({ expectedUpdatedAt: null, name: "Keynote scene", preset: "talk" });
  });
});

describe("where a graphic sits, in words", () => {
  const at = (x: number, y: number, w: number, h: number) => describeGraphicPosition({ x, y, w, h });
  it("names bars, columns, halves and corners from the box", () => {
    expect(at(0, 0.88, 1, 0.12)).toBe("Bottom bar");
    expect(at(0, 0, 1, 0.1)).toBe("Top bar");
    expect(at(0.6, 0, 0.4, 1)).toBe("Right column");
    expect(at(0, 0, 0.4, 1)).toBe("Left column");
    expect(at(0, 0.5, 1, 0.5)).toBe("Bottom half");
    expect(at(0, 0, 1, 1)).toBe("Full frame");
    expect(at(0.025, 0.67, 0.65, 0.28)).toBe("Bottom left");
    expect(at(0.8, 0.04, 0.175, 0.11)).toBe("Top right");
    expect(at(0.725, 0.2, 0.25, 0.6)).toBe("Middle right");
    expect(at(0.4, 0.4, 0.2, 0.2)).toBe("Center");
  });
});
