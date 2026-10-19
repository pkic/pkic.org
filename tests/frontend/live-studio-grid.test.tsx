// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioGrid } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/StudioGrid";
import { StudioToolbar } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/StudioToolbar";
import {
  STUDIO_LAYOUT_STORAGE_KEY,
  STUDIO_PANEL_LABELS,
  defaultStudioLayouts,
  studioLayoutsSchema,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/studio-layout";
import { useStudioLayout } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/useStudioLayout";

function Harness() {
  const layout = useStudioLayout();
  return (
    <>
      <StudioToolbar
        workspace={layout.workspace}
        selectWorkspace={layout.selectWorkspace}
        panels={layout.panels}
        change={layout.change}
        reset={layout.reset}
        expanded={false}
        toggleExpanded={() => {}}
      />
      <StudioGrid
        workspace={layout.workspace}
        panels={layout.panels}
        change={layout.change}
        render={(panel) => ({ title: `${STUDIO_PANEL_LABELS[panel.type]} ${panel.id}`, body: <p>{panel.id}</p> })}
      />
    </>
  );
}

/** A 1200px grid of 32px rows with 12px gaps, as StudioGrid.css lays it out. */
const GAP = 12;
const COLUMN = (1200 + GAP) / 12;
const ROW = 32 + GAP;

let host: HTMLElement | undefined;
const stored = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
  clear: () => stored.clear(),
};
function mount() {
  const node = document.createElement("div");
  document.body.append(node);
  host = node;
  void act(() => render(<Harness />, node));
}
const cell = (id: string) =>
  host!.querySelector(`section[aria-label$=" ${id}"]`)!.closest<HTMLElement>(".pk-studio-cell")!;
/** A cell's grid rectangle as the stylesheet reads it. */
const rect = (node: HTMLElement) => ({
  x: Number(node.style.getPropertyValue("--studio-col")) - 1,
  y: Number(node.style.getPropertyValue("--studio-row")) - 1,
  w: Number(node.style.getPropertyValue("--studio-w")),
  h: Number(node.style.getPropertyValue("--studio-h")),
});
const savedShow = () => studioLayoutsSchema.parse(JSON.parse(stored.get(STUDIO_LAYOUT_STORAGE_KEY)!)).show;
function menuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!item) throw new Error(`No menu item ${label}`);
  return item;
}
function openPanelMenu(id: string, title: string) {
  void act(() => cell(id).querySelector<HTMLButtonElement>(`button[aria-label="${title} ${id} panel"]`)!.click());
}
function pointer(target: Element, type: string, x: number, y: number) {
  void act(
    () =>
      void target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
      ),
  );
}
function unmount() {
  if (!host) return;
  void act(() => render(null, host!));
  host.remove();
  host = undefined;
}

beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", memoryStorage);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // jsdom has no layout: boxes follow each cell's grid rectangle on a 1200px grid.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("pk-studio-grid")) return new DOMRect(0, 0, 1200, 2000);
    const { x, y, w, h } = rect(this);
    return new DOMRect(x * COLUMN, y * ROW, w * COLUMN - GAP, h * ROW - GAP);
  });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) =>
    (element as Element).classList?.contains("pk-studio-grid")
      ? ({ columnGap: `${GAP}px`, rowGap: `${GAP}px`, gridAutoRows: "32px" } as CSSStyleDeclaration)
      : computed(element, pseudo),
  );
  history.replaceState(null, "", "/#/live");
});
afterEach(() => {
  unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("studio grid", () => {
  const [preview, , multiview] = defaultStudioLayouts().show;

  it("drops a panel into another's row, which makes room and shares its columns, and saves on release", () => {
    mount();
    const header = cell(multiview!.id).querySelector(".pk-studio-panel__header")!;
    pointer(header, "pointerdown", 600, 10);
    pointer(header, "pointermove", 600 - 5 * COLUMN, 12);
    const grid = host!.querySelector<HTMLElement>(".pk-studio-grid")!;
    expect(grid.dataset.gesture).toBe("move");
    // Dropped on Preview, it goes before it in that row; the placeholder shows the share it takes.
    expect(rect(host!.querySelector<HTMLElement>(".pk-studio-grid__placeholder")!)).toEqual({
      x: 0,
      y: 0,
      w: 4,
      h: 12,
    });
    expect(rect(cell(preview!.id))).toEqual({ x: 4, y: 0, w: 4, h: 12 });
    expect(stored.has(STUDIO_LAYOUT_STORAGE_KEY)).toBe(false);
    pointer(header, "pointerup", 600 - 5 * COLUMN, 12);
    expect(grid.hasAttribute("data-gesture")).toBe(false);
    expect(cell(multiview!.id).style.transform).toBe("");
    const show = savedShow();
    expect(show.find((panel) => panel.id === multiview!.id)).toMatchObject({ x: 0, y: 0, w: 4 });
    expect(show.find((panel) => panel.id === preview!.id)).toMatchObject({ x: 4, y: 0, w: 4 });
  });

  it("resizes from the corner grip on whole columns and rows", () => {
    mount();
    const grip = cell(preview!.id).querySelector(".pk-studio-cell__resize")!;
    pointer(grip, "pointerdown", 500, 380);
    pointer(grip, "pointermove", 500 + COLUMN, 380 + 2 * ROW);
    // The panel snaps to the cells it will take while the grip moves.
    expect(rect(cell(preview!.id))).toMatchObject({ w: 6, h: 14 });
    pointer(grip, "pointerup", 500 + COLUMN, 380 + 2 * ROW);
    expect(savedShow().find((panel) => panel.id === preview!.id)).toMatchObject({ w: 6, h: 14 });
  });

  it("keeps a quick resize released before its animation frame ran", () => {
    // The browser has not drawn a frame since the last move when the pointer comes up.
    vi.stubGlobal("requestAnimationFrame", () => 7);
    mount();
    const grip = cell(preview!.id).querySelector(".pk-studio-cell__resize")!;
    pointer(grip, "pointerdown", 500, 380);
    pointer(grip, "pointermove", 500 + COLUMN, 380 + 2 * ROW);
    pointer(grip, "pointerup", 500 + COLUMN, 380 + 2 * ROW);
    expect(savedShow().find((panel) => panel.id === preview!.id)).toMatchObject({ w: 6, h: 14 });
    expect(rect(cell(preview!.id))).toMatchObject({ w: 6, h: 14 });
  });

  it("resizes from any edge or corner, so a panel shrinks from the side being dragged", () => {
    mount();
    const edge = (name: string) => cell(multiview!.id).querySelector(`.pk-studio-cell__edge[data-edge="${name}"]`)!;
    // The multiview starts at column 7, 5 wide: its left edge dragged two columns right leaves it 3 wide.
    pointer(edge("w"), "pointerdown", 7 * COLUMN, 100);
    pointer(edge("w"), "pointermove", 9 * COLUMN, 100);
    pointer(edge("w"), "pointerup", 9 * COLUMN, 100);
    expect(savedShow().find((panel) => panel.id === multiview!.id)).toMatchObject({ x: 9, w: 3 });
    pointer(edge("nw"), "pointerdown", 9 * COLUMN, 0);
    pointer(edge("nw"), "pointermove", 8 * COLUMN, 3 * ROW);
    pointer(edge("nw"), "pointerup", 8 * COLUMN, 3 * ROW);
    expect(savedShow().find((panel) => panel.id === multiview!.id)).toMatchObject({ x: 8, w: 4, h: 9 });
  });

  it("puts everything back when Escape cancels a drag", () => {
    mount();
    const header = cell(multiview!.id).querySelector(".pk-studio-panel__header")!;
    pointer(header, "pointerdown", 600, 10);
    pointer(header, "pointermove", 600 - 5 * COLUMN, 12);
    void act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(rect(cell(preview!.id))).toEqual({ x: 0, y: 0, w: 5, h: 12 });
    expect(stored.has(STUDIO_LAYOUT_STORAGE_KEY)).toBe(false);
  });

  it("leaves a click on a header's own controls alone", () => {
    mount();
    const close = cell(multiview!.id).querySelector<HTMLButtonElement>("button[aria-label^='Close']")!;
    pointer(close, "pointerdown", 600, 10);
    pointer(close, "pointermove", 100, 300);
    expect(host!.querySelector(".pk-studio-grid")!.hasAttribute("data-gesture")).toBe(false);
  });

  it("moves and resizes from the keyboard, and keeps the arrangement for the next visit", () => {
    mount();
    const speakers = defaultStudioLayouts().show.find((panel) => panel.type === "speakers")!;
    openPanelMenu(preview!.id, "Monitor");
    expect(menuItem("Move up").disabled).toBe(true);
    expect(menuItem("Move left").disabled).toBe(true);
    void act(() => menuItem("Move down").click());
    expect(rect(cell(speakers.id))).toMatchObject({ x: 0, y: 0 });
    expect(rect(cell(preview!.id))).toMatchObject({ x: 0, y: speakers.h });
    const grip = cell(speakers.id).querySelector<HTMLButtonElement>(".pk-studio-cell__resize")!;
    void act(() => void grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    void act(() => void grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(rect(cell(speakers.id))).toMatchObject({ w: speakers.w + 1, h: speakers.h + 1 });
    // Two quick resizes in a row read as a double click; that must never undo the size just set.
    void act(() => void grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(rect(cell(speakers.id))).toMatchObject({ w: speakers.w + 1, h: speakers.h + 1 });
    void act(() => void grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    void act(() => void grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(rect(cell(speakers.id))).toMatchObject({ w: speakers.w, h: speakers.h });
    unmount();
    mount();
    expect(rect(cell(speakers.id))).toMatchObject({ x: 0, y: 0 });
  });

  it("closes a panel, adds it back from the menu, and resets the workspace", () => {
    mount();
    const speakers = defaultStudioLayouts().show.find((panel) => panel.type === "speakers")!;
    void act(() =>
      cell(speakers.id).querySelector<HTMLButtonElement>(`button[aria-label="Close Speakers ${speakers.id}"]`)!.click(),
    );
    expect(host!.querySelector(`section[aria-label$=" ${speakers.id}"]`)).toBeNull();
    void act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Add panel"]')!.click());
    expect(menuItem("Questions").disabled).toBe(true);
    void act(() => menuItem("Speakers").click());
    expect(
      [...host!.querySelectorAll("section")].some((section) =>
        section.getAttribute("aria-label")?.startsWith("Speakers"),
      ),
    ).toBe(true);
    void act(() =>
      [...host!.querySelectorAll("button")].find((button) => button.textContent === "Reset layout")!.click(),
    );
    expect(savedShow()).toEqual(defaultStudioLayouts().show);
  });

  it("switches workspace through the address and renders its panels in reading order", () => {
    mount();
    void act(() => host!.querySelector<HTMLButtonElement>('button[role="tab"]#studio-layout-stage')!.click());
    expect(location.hash).toContain("studio=stage");
    const order = [...host!.querySelectorAll(".pk-studio-cell p")].map((node) => node.textContent);
    expect(order).toEqual(defaultStudioLayouts().stage.map((panel) => panel.id));
  });
});
