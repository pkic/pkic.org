import { describe, expect, it } from "vitest";
import {
  compactGrid,
  gridOverlaps,
  placeGridItem,
  type GridItem,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/studio-grid";
import {
  STUDIO_GRID_BOUNDS,
  STUDIO_LAYOUT_STORAGE_KEY,
  STUDIO_LAYOUT_V1_STORAGE_KEY,
  STUDIO_WORKSPACES,
  defaultStudioLayouts,
  loadStudioLayouts,
  moveStudioPanel,
  resizeStudioPanel,
  saveStudioWorkspace,
  studioLayoutsSchema,
  toggleStudioOutput,
  type StudioPanel,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/studio-layout";

const item = (id: string, x: number, y: number, w: number, h: number): GridItem => ({ id, x, y, w, h });
const at = (items: readonly GridItem[], id: string) => {
  const found = items.find((entry) => entry.id === id)!;
  return { x: found.x, y: found.y, w: found.w, h: found.h };
};
const noOverlaps = (items: readonly GridItem[]) =>
  items.every((a, index) => items.slice(index + 1).every((b) => !gridOverlaps(a, b)));

function memory(entries: Record<string, unknown> = {}) {
  const stored = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    stored,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  };
}

describe("studio grid geometry", () => {
  it("floats items up into the space above them without changing their columns", () => {
    const compacted = compactGrid([item("a", 0, 3, 6, 4), item("b", 6, 10, 6, 4), item("c", 0, 9, 4, 4)]);
    expect(at(compacted, "a")).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    expect(at(compacted, "b")).toEqual({ x: 6, y: 0, w: 6, h: 4 });
    expect(at(compacted, "c")).toEqual({ x: 0, y: 4, w: 4, h: 4 });
  });

  it("drops an item above another: the one it lands on moves down out of the way", () => {
    const grid = [item("preview", 0, 0, 5, 9), item("multiview", 5, 0, 7, 9), item("speakers", 0, 9, 4, 6)];
    const placed = placeGridItem(grid, "multiview", { x: 0, y: 0, w: 7, h: 9 }, STUDIO_GRID_BOUNDS);
    expect(at(placed, "multiview")).toEqual({ x: 0, y: 0, w: 7, h: 9 });
    expect(at(placed, "preview")).toEqual({ x: 0, y: 9, w: 5, h: 9 });
    expect(at(placed, "speakers")).toEqual({ x: 0, y: 18, w: 4, h: 6 });
    expect(noOverlaps(placed)).toBe(true);
  });

  it("swaps two stacked items once the dragged one reaches the other's place", () => {
    const grid = [item("a", 0, 0, 6, 4), item("b", 0, 4, 6, 5)];
    expect(at(placeGridItem(grid, "a", { x: 0, y: 1, w: 6, h: 4 }, STUDIO_GRID_BOUNDS), "a").y).toBe(0);
    const swapped = placeGridItem(grid, "a", { x: 0, y: 5, w: 6, h: 4 }, STUDIO_GRID_BOUNDS);
    expect(at(swapped, "b").y).toBe(0);
    expect(at(swapped, "a").y).toBe(5);
  });

  it("pushes a chain of items down and keeps the grid free of overlaps", () => {
    const grid = [item("a", 0, 0, 12, 4), item("b", 0, 4, 6, 4), item("c", 6, 4, 6, 4), item("d", 0, 8, 12, 4)];
    const placed = placeGridItem(grid, "d", { x: 0, y: 0, w: 12, h: 4 }, STUDIO_GRID_BOUNDS);
    expect(placed.map((entry) => entry.id)).toEqual(["d", "a", "b", "c"]);
    expect(at(placed, "b").y).toBe(8);
    expect(noOverlaps(placed)).toBe(true);
  });

  it("clamps a target to the grid's columns and size limits", () => {
    const placed = placeGridItem([item("a", 0, 0, 4, 4)], "a", { x: 11, y: -3, w: 20, h: 1 }, STUDIO_GRID_BOUNDS);
    expect(at(placed, "a")).toEqual({ x: 0, y: 0, w: 12, h: STUDIO_GRID_BOUNDS.minH });
  });
});

describe("studio keyboard arrangement", () => {
  const show = defaultStudioLayouts().show;
  const [preview, , multiview] = show;

  it("moves a panel past its neighbour above or below, and one column sideways", () => {
    const speakers = show.find((panel) => panel.type === "speakers")!;
    const up = moveStudioPanel(show, speakers.id, "up");
    expect(at(up, speakers.id).y).toBe(0);
    expect(at(up, preview!.id).y).toBe(speakers.h);
    const down = moveStudioPanel(up, speakers.id, "down");
    expect(at(down, speakers.id).y).toBe(at(down, preview!.id).y + preview!.h);
    expect(at(moveStudioPanel(show, multiview!.id, "left"), multiview!.id).x).toBe(multiview!.x - 1);
    expect(moveStudioPanel(show, preview!.id, "left")).toEqual(show);
  });

  it("resizes on whole columns and rows, growing to the left at the right edge", () => {
    const wider = resizeStudioPanel(show, multiview!.id, { w: multiview!.w + 1 });
    expect(at(wider, multiview!.id)).toMatchObject({ x: multiview!.x - 1, w: multiview!.w + 1 });
    const taller = resizeStudioPanel(show, preview!.id, { h: preview!.h + 2 });
    expect(at(taller, preview!.id).h).toBe(preview!.h + 2);
    expect(noOverlaps(taller)).toBe(true);
  });

  it("lets a monitor shrink as small as the Transition, and a list panel no smaller than its minimum", () => {
    const small = resizeStudioPanel(show, preview!.id, { w: 1, h: 1 });
    expect(at(small, preview!.id)).toMatchObject({ w: 1, h: 3 });
    expect(studioLayoutsSchema.safeParse({ ...defaultStudioLayouts(), show: small }).success).toBe(true);
    const speakers = show.find((panel) => panel.type === "speakers")!;
    expect(at(resizeStudioPanel(show, speakers.id, { w: 1, h: 1 }), speakers.id)).toMatchObject({ w: 3, h: 4 });
  });

  it("keeps a monitor's outputs in canonical order and never empty", () => {
    const added = toggleStudioOutput([preview!], preview!.id, "program");
    expect(added[0]!.outputs).toEqual(["preview", "program"]);
    expect(toggleStudioOutput([preview!], preview!.id, "preview")[0]!.outputs).toEqual(["preview"]);
  });

  it("starts every workspace from a valid, overlap-free default", () => {
    const defaults = defaultStudioLayouts();
    expect(studioLayoutsSchema.safeParse(defaults).success).toBe(true);
    for (const workspace of STUDIO_WORKSPACES) expect(noOverlaps(defaults[workspace])).toBe(true);
  });
});

describe("saved studio layouts", () => {
  it("moves a first-shape arrangement onto the grid once, in its own order, and drops the old entry", () => {
    const storage = memory({
      [STUDIO_LAYOUT_V1_STORAGE_KEY]: {
        show: [
          { id: "a", type: "monitor", span: 8, height: 320, outputs: ["program"] },
          { id: "b", type: "chat", span: 4, height: null },
          { id: "c", type: "speakers", span: 6, height: null },
        ],
        livestream: [{ id: "x" }],
        stage: [],
      },
    });
    const layouts = loadStudioLayouts(storage);
    expect(layouts.show.map(({ id, x, y, w }) => ({ id, x, y, w }))).toEqual([
      { id: "a", x: 0, y: 0, w: 8 },
      { id: "b", x: 8, y: 0, w: 4 },
      { id: "c", x: 0, y: 10, w: 6 },
    ]);
    expect(layouts.show[0]).toMatchObject({ h: 10, outputs: ["program"] });
    // A workspace that does not read starts over; an empty one stays empty.
    expect(layouts.livestream).toEqual(defaultStudioLayouts().livestream);
    expect(layouts.stage).toEqual([]);
    expect(storage.stored.has(STUDIO_LAYOUT_V1_STORAGE_KEY)).toBe(false);
    expect(studioLayoutsSchema.parse(JSON.parse(storage.stored.get(STUDIO_LAYOUT_STORAGE_KEY)!))).toEqual(layouts);
  });

  it("falls back to the defaults when the saved arrangement is unreadable or blocked", () => {
    expect(loadStudioLayouts({ ...memory(), getItem: () => "{not json" })).toEqual(defaultStudioLayouts());
    expect(loadStudioLayouts(memory({ [STUDIO_LAYOUT_STORAGE_KEY]: { show: [{ id: "x" }] } }))).toEqual(
      defaultStudioLayouts(),
    );
    expect(
      loadStudioLayouts({
        ...memory(),
        getItem: () => {
          throw new Error("Blocked");
        },
      }),
    ).toEqual(defaultStudioLayouts());
  });

  it("settles a saved arrangement whose panels overlap", () => {
    const overlapping: StudioPanel[] = [
      { id: "a", type: "chat", x: 0, y: 0, w: 6, h: 4 },
      { id: "b", type: "polls", x: 2, y: 1, w: 6, h: 4 },
    ];
    const layouts = loadStudioLayouts(
      memory({ [STUDIO_LAYOUT_STORAGE_KEY]: { ...defaultStudioLayouts(), show: overlapping } }),
    );
    expect(at(layouts.show, "b").y).toBe(4);
  });

  it("saves one workspace over what another studio tab saved, never over its older copy of the others", () => {
    const defaults = defaultStudioLayouts();
    const otherTab = { ...defaults, stage: resizeStudioPanel(defaults.stage, defaults.stage[0]!.id, { h: 12 }) };
    const storage = memory({ [STUDIO_LAYOUT_STORAGE_KEY]: otherTab });
    const show = resizeStudioPanel(defaults.show, defaults.show[0]!.id, { h: 11 });
    // This tab still holds the defaults for Stage; saving Show keeps the other tab's Stage.
    const saved = saveStudioWorkspace(storage, "show", show, defaults);
    expect(saved.stage[0]!.h).toBe(12);
    expect(loadStudioLayouts(storage).show[0]!.h).toBe(11);
    expect(loadStudioLayouts(storage).stage[0]!.h).toBe(12);
  });
});
