// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
} from "../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_DEFAULT_LAYOUT,
  LIVE_OVERLAY_ELEMENT_LABELS,
  LIVE_OVERLAY_ELEMENT_SWITCHES,
  LIVE_OVERLAY_PRESETS,
  eventLiveOverlayLayoutPutSchema,
  eventLiveOverlayLayoutsResponseSchema,
  eventLiveOverlayPositionsPutSchema,
  type EventLiveOverlayLayoutPut,
  type EventLiveOverlayPositionsPut,
  type LiveOverlayElement,
} from "../../assets/shared/schemas/live-overlay-layout";
import { EventLiveSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/EventLiveSettings";
import { describeGraphicSwitch } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-copy";
import { controlFor, typeInto } from "./helpers/labeled-control";

const confirmations = vi.hoisted(() => ({ asked: [] as Array<{ title: string; confirmLabel?: string }> }));
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({
  confirmAction: async (options: { title: string; confirmLabel?: string }) => {
    confirmations.asked.push(options);
    return true;
  },
}));

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
const LOWER_THIRD = LIVE_OVERLAY_PRESET_LAYOUTS.default.elements.lowerThird;

let root: HTMLElement | null = null;
let written: Array<{ url: string; body: EventLiveOverlayLayoutPut }> = [];
let positioned: EventLiveOverlayPositionsPut[] = [];
let deleted: string[] = [];
let stored = LAYOUTS;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  written = [];
  positioned = [];
  deleted = [];
  confirmations.asked = [];
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
      if (init?.method === "DELETE") {
        deleted.push(url);
        stored = { ...stored, layouts: stored.layouts.filter((layout) => !url.endsWith(`/${layout.slug}`)) };
      } else if (init?.method === "PUT" && url === POSITIONS_URL) {
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

async function mount(canEdit = true) {
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<EventLiveSettings slug="conference" canEdit={canEdit} />, root!));
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

/** A menu item's label, without its check mark or second line. */
const itemLabel = (item: Element) =>
  (item.querySelector(".pk-menu__text > span:first-child") ?? item).textContent!.replace(/^✓/, "");
/** The open menu's items by their labels. */
const menuItems = () => [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")].map(itemLabel);
/** Opens a menu by its trigger and chooses one of its items. */
async function choose(trigger: HTMLButtonElement, item: string) {
  await act(() => trigger.click());
  const entry = [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")].find(
    (candidate) => itemLabel(candidate) === item,
  );
  if (!entry) throw new Error(`no menu item reads "${item}"`);
  await act(() => entry.click());
}
const button = (label: string) => root!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
/** The graphics list, front first, by the boxes' element names. */
const rows = () =>
  [...root!.querySelectorAll<HTMLElement>(".pk-scenes__graphics .pk-scenes__row")].map((row) => row.dataset.element);
/** What a graphic's row says puts it on, and the control that changes it, if it has one. */
const switchOf = (element: string) =>
  root!.querySelector<HTMLElement>(`.pk-scenes__row[data-element="${element}"] .pk-scenes__switch`)!;
/** The words of a graphic's switch icon: the first line of its hint. */
function switchWords(element: string) {
  const icon = switchOf(element).querySelector<HTMLElement>("button") ?? switchOf(element);
  return (icon.getAttribute("title") ?? icon.dataset.tooltip ?? "").split("\n")[0];
}
const QA_URL = "/portal/#/events/conference/settings/live?layout=questions";
/** The canvas's boxes in drawing order, back first. */
const drawnOrder = () =>
  [...root!.querySelectorAll<HTMLElement>(".pk-layout-canvas__boxes > button[data-element]")].map(
    (box) => box.dataset.element,
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
    ).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
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
    // Camera leaves the QR code out; its background waits for a board.
    expect(drawn()).not.toContain("qrCode");
    expect(drawn()).toContain("background");
    expect(switchWords("background")).toBe("Under the board on air");
    expect(drawn()).not.toContain("stageDisplay");
    expect(drawn().sort()).toEqual([...rows()].sort());
    void act(() => box("ticker").click());
    expect(box("ticker").textContent).toBe("News ticker · Bottom bar");
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
    // Only the Program graphic Camera leaves out, the QR code; never the speaker's screen.
    expect(menuItems()).toEqual(["QR code"]);
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

  it("says on every row what puts the graphic on, and offers the choice only where the scene has one", async () => {
    history.replaceState(null, "", QA_URL);
    await mount();
    const scene = LIVE_OVERLAY_PRESET_LAYOUTS.questions.elements;
    const shown = rows() as LiveOverlayElement[];
    // Board right holds all three kinds: picked, filled from the room, and without a switch.
    expect(new Set(shown.map((element) => LIVE_OVERLAY_ELEMENT_SWITCHES[element])).size).toBe(3);
    for (const element of shown) {
      expect(switchWords(element)).toBe(describeGraphicSwitch(element, scene[element]));
      expect(switchOf(element).querySelector("button") !== null).toBe(
        LIVE_OVERLAY_ELEMENT_SWITCHES[element] === "room",
      );
    }
    // A graphic that needs a pick has no choice on its row or in its menu.
    await act(() => button("Actions for Lower third").click());
    expect(menuItems()).toContain("Remove from scene");
    expect(document.querySelector("[role=menuitemradio], [role=menuitemcheckbox]")).toBeNull();
  });

  it("changes whether a graphic comes on with the scene as part of the draft, and saves it", async () => {
    history.replaceState(null, "", QA_URL);
    await mount();
    const submit = () => root!.querySelector<HTMLButtonElement>('form.pk-scenes__editor button[type="submit"]')!;
    expect(submit().disabled).toBe(true);
    // The switch is a toggle: pressed, the graphic comes on with the scene, and its hint says what that does.
    const topQuestions = button("Top questions: Comes on with the scene");
    expect(topQuestions.getAttribute("aria-pressed")).toBe("true");
    expect(topQuestions.getAttribute("title") ?? topQuestions.dataset.tooltip).toContain("Loading this");
    await act(() => topQuestions.click());
    await act(() => button("News ticker: Comes on with the scene").click());
    expect(switchWords("topQuestions")).toBe("Switched in the studio");
    expect(button("Top questions: Comes on with the scene").getAttribute("aria-pressed")).toBe("false");
    expect(submit().disabled).toBe(false);
    expect(root!.textContent).toContain("Discard changes");
    await save();
    expect(positioned).toHaveLength(0);
    expect(written[0]!.body.elements.topQuestions.comesOn).toBe(false);
    expect(written[0]!.body.elements.ticker.comesOn).toBe(true);
    expect(written[0]!.body.elements.lowerThird.comesOn).toBeUndefined();
    expect(switchWords("ticker")).toBe("Comes on with the scene");
    expect(submit().disabled).toBe(true);
  });

  it("resets a built-in scene to its default, saving its name and graphics at once", async () => {
    // The scene the editor opens on: the event's default one.
    const base = LIVE_OVERLAY_PRESET_LAYOUTS[LIVE_OVERLAY_DEFAULT_LAYOUT];
    await mount();
    await choose(button(`Actions for ${base.name}`), "Rename");
    await typeInto(controlFor(document.body, "Name"), "Keynote");
    await act(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Rename")!.click();
    });
    const second = rows()[1] as "ticker";
    await act(() => button(`Move ${LIVE_OVERLAY_ELEMENT_LABELS[second]} up`).click());
    await act(() => button("Reactions: Comes on with the scene").click());
    await act(() => button(`Actions for ${base.name}`).click());
    // A built-in scene is reset, never deleted.
    expect(menuItems()).toContain("Reset scene");
    expect(menuItems()).not.toContain("Delete scene");
    await act(() =>
      [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
        .find((item) => itemLabel(item) === "Reset scene")!
        .click(),
    );
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(confirmations.asked[0]).toMatchObject({ title: "Reset Keynote?", confirmLabel: "Reset scene" });
    expect(written[0]!.body).toMatchObject({ name: base.name, preset: LIVE_OVERLAY_DEFAULT_LAYOUT });
    expect(written[0]!.body.elements[second].layer).toBe(base.elements[second].layer);
    // Nothing comes on with the built-in Camera, so the reset takes the choice back.
    expect(written[0]!.body.elements.reactions.comesOn).toBeUndefined();
  });

  it("deletes one of the event's own scenes after asking, and offers no reset for it", async () => {
    stored = eventLiveOverlayLayoutsResponseSchema.parse({
      ...LAYOUTS,
      layouts: [
        ...LAYOUTS.layouts,
        {
          ...LAYOUTS.layouts[0]!,
          slug: "keynote",
          name: "Keynote",
          preset: null,
          builtIn: false,
          saved: true,
          updatedAt: "2026-11-18T10:00:00.000Z",
        },
      ],
    });
    history.replaceState(null, "", "/portal/#/events/conference/settings/live?layout=keynote");
    await mount();
    await act(() => button("Actions for Keynote").click());
    expect(menuItems()).not.toContain("Reset scene");
    await act(() => button("Actions for Keynote").click());
    await choose(button("Actions for Keynote"), "Delete scene");
    await vi.waitFor(() => expect(deleted).toEqual(["/api/v1/events/conference/settings/live/layouts/keynote"]));
    expect(confirmations.asked[0]).toMatchObject({ title: "Delete Keynote?", confirmLabel: "Delete scene" });
  });

  it("draws the scene with sample content under the boxes", async () => {
    await mount();
    const canvas = root!.querySelector(".pk-layout-canvas")!;
    expect(canvas.querySelector(".pk-live-overlay__frame")).not.toBeNull();
    // Camera includes every graphic with a switch, boards too: the sample has them on, the front board covers the
    // ones behind it, and the poll over the whole frame brings the background with it.
    const drawn = [...canvas.querySelectorAll<HTMLElement>("[data-overlay-element]")].map(
      (element) => element.dataset.overlayElement,
    );
    expect(drawn).toEqual(expect.arrayContaining(["poll", "timer", "ticker", "reactions", "background"]));
    expect(drawn).not.toContain("question");
  });

  it("lists the scene's graphics front first and saves one moved up the stack as the scene's order", async () => {
    await mount();
    expect(rows().slice(0, 3)).toEqual(["reactions", "ticker", "timer"]);
    expect(rows()).not.toContain("qrCode");
    expect(button("Move Reactions up").disabled).toBe(true);
    await act(() => button("Move Reactions down").click());
    expect(rows().slice(0, 2)).toEqual(["ticker", "reactions"]);
    const above = rows()[rows().indexOf("lowerThird") - 1]!;
    await act(() => button("Move Lower third up").click());
    expect(rows().indexOf("lowerThird")).toBe(rows().indexOf(above) - 1);
    // The canvas stacks its boxes as the list does, so the one in front covers the ones behind it.
    expect(drawnOrder()).toEqual([...rows()].reverse());
    await save();
    const { elements } = written[0]!.body;
    expect(elements.lowerThird.layer!).toBeGreaterThan(elements[above as "poll"].layer!);
    expect(elements.ticker.layer!).toBeGreaterThan(elements.reactions.layer!);
  });

  it("adds a removed graphic back at its shared position, wherever this scene had placed it", async () => {
    await mount();
    await choose(button("Actions for Lower third"), "Place differently on this scene");
    pointer(box("lowerThird"), "pointerdown", 100, 200);
    pointer(box("lowerThird"), "pointermove", 340, 200, { altKey: true });
    pointer(box("lowerThird"), "pointerup", 340, 200, { altKey: true });
    await choose(button("Actions for Lower third"), "Remove from scene");
    await choose(button("Add graphic"), "Lower third");
    expect(Number(controlFor(root!, "From left").value)).toBeCloseTo(LOWER_THIRD.x * 100, 1);
    // Back where the scene started: shared and shown, so there is nothing to save.
    const submit = root!.querySelector<HTMLButtonElement>('form.pk-scenes__editor button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
  });

  it("adds the background as its own graphic at the back, and moves it in front of a board", async () => {
    history.replaceState(null, "", "/portal/#/events/conference/settings/live?layout=break");
    await mount();
    await choose(button("Add graphic"), "Background");
    // It starts behind everything, at the full frame, and is placed like any other graphic.
    expect(rows().at(-1)).toBe("background");
    expect(drawnOrder()[0]).toBe("background");
    expect(box("background").getAttribute("aria-pressed")).toBe("true");
    expect(root!.querySelector('.pk-scenes__row[data-element="background"]')!.textContent).toContain("Full frame");
    expect(button("Move Background down").disabled).toBe(true);
    // It has no switch: its row says so, with nothing to choose.
    expect(switchWords("background")).toBe("On whenever this scene is on");
    expect(switchOf("background").querySelector("button")).toBeNull();
    const behind = rows().at(-2)!;
    await act(() => button("Move Background up").click());
    expect(rows().slice(-2)).toEqual(["background", behind]);
    expect(drawnOrder().slice(0, 2)).toEqual([behind, "background"]);
    await save();
    const { elements } = written[0]!.body;
    expect(elements.background.visible).toBe(true);
    expect(elements.background.layer!).toBeGreaterThan(elements[behind as "panelists"].layer!);
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
    void act(() => box("lowerThird").click());
    const width = controlFor(root!, "Width");
    await typeInto(width, "120");
    await save();
    expect(written).toHaveLength(0);
    expect(width.getAttribute("aria-invalid")).toBe("true");
    expect(root!.querySelector("details")!.open).toBe(true);
  });

  it("renames the scene as part of its draft, under the same source name", async () => {
    await mount();
    await choose(button("Actions for Camera"), "Rename");
    const name = controlFor(document.body, "Name");
    await typeInto(name, "Keynote");
    await act(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Rename")!.click();
    });
    expect(root!.querySelector(".pk-scenes__editor > .pk-panel:first-child .pk-panel__title")!.textContent).toBe(
      "Keynote",
    );
    await save();
    expect(written[0]!.url).toBe("/api/v1/events/conference/settings/live/layouts/default");
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
    expect(written[0]!.body).toMatchObject({ expectedUpdatedAt: null, name: "Keynote scene", preset: "default" });
  });
});

describe("scenes for someone who may not change them", () => {
  it("lists the scenes, draws the selected one and lists its graphics, with nothing to change", async () => {
    history.replaceState(null, "", QA_URL);
    await mount(false);
    const scenes = [...root!.querySelectorAll(".pk-scenes__list .pk-scenes__name")].map((name) => name.textContent);
    expect(scenes).toEqual(LAYOUTS.layouts.map((layout) => layout.name));
    expect(root!.querySelector(".pk-layout-canvas .pk-live-overlay__frame")).not.toBeNull();
    expect(root!.textContent).toContain("Show safe areas");

    const labels = [...root!.querySelectorAll(".pk-scenes button")].map(
      (control) => control.getAttribute("aria-label") ?? control.textContent!.trim(),
    );
    // Only the scene list is left to press.
    expect(labels).toEqual(LAYOUTS.layouts.map((layout) => layout.name));
    expect(root!.querySelector(".pk-scenes form")).toBeNull();
    // The scene's graphics are read, front first, each with its place and what puts it on.
    const scene = LIVE_OVERLAY_PRESET_LAYOUTS.questions.elements;
    expect(rows().slice(0, 3)).toEqual(["reactions", "ticker", "timer"]);
    for (const element of rows() as LiveOverlayElement[])
      expect(switchWords(element)).toBe(describeGraphicSwitch(element, scene[element]));
    expect(switchOf("topQuestions").parentElement!.textContent).toBe("Top questionsRight column · Behind in its spot");
    expect(root!.querySelector(".pk-scenes__graphics :is(button, [aria-haspopup], .pk-scenes__grip)")).toBeNull();
    expect(root!.querySelector(".pk-layout-inspector")).toBeNull();
    expect(root!.querySelector(".pk-layout-canvas__boxes")).toBeNull();
    expect(root!.querySelector("[role=alert], .pk-alert")).toBeNull();
    for (const copy of ["New scene", "Save scene", "Add graphic", "drag to move"])
      expect(root!.textContent).not.toContain(copy);
  });

  it("opens another scene from the list without writing anything", async () => {
    await mount(false);
    const other = LAYOUTS.layouts[1]!;
    const pick = [...root!.querySelectorAll<HTMLButtonElement>(".pk-scenes__list .pk-scenes__pick")].find(
      (candidate) => candidate.textContent === other.name,
    )!;
    await act(async () => pick.click());
    expect(root!.querySelector(".pk-scenes__editor .pk-panel__title")!.textContent).toBe(other.name);
    expect(root!.querySelector(".pk-scenes__editor")!.hasAttribute("data-read-only")).toBe(true);
    expect([written, positioned, deleted]).toEqual([[], [], []]);
  });
});
