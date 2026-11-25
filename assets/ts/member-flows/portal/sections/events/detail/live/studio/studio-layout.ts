import { z } from "zod";
import {
  LIVE_LIVESTREAM_OUTPUT_DETAILS,
  LIVE_PREVIEW_OUTPUT_DETAILS,
  LIVE_PROGRAM_OUTPUT_DETAILS,
  LIVE_STAGE_PREVIEW_OUTPUT,
  liveOutputDetails,
  liveStudioOutputs,
  type LiveOutputDetails,
} from "../../../../../../../../shared/live-room-outputs";
import {
  LIVE_SPEAKER_OUTPUT_KEY,
  type LiveRoomOutput,
} from "../../../../../../../../shared/schemas/live-room-output-setup";
import {
  STUDIO_BUSES,
  STUDIO_COLUMNS,
  STUDIO_GRID_BOUNDS,
  STUDIO_MAX_PANELS,
  STUDIO_MIN_W,
  STUDIO_OUTPUTS_MAX,
  STUDIO_PANEL_TYPES,
  STUDIO_WORKSPACES,
  studioGridBounds,
  studioLayoutsSchema,
  studioOutputSchema,
  withoutRetiredStudioPanels,
  type StudioDefaultLayouts,
  type StudioLayouts,
  type StudioOutput,
  type StudioPanel,
  type StudioPanelType,
  type StudioWorkspace,
} from "../../../../../../../../shared/schemas/live-studio-layout";
import { LIVE_OVERLAY_DEFAULT_LAYOUT } from "../../../../../../../../shared/schemas/live-overlay-layout";
import { compactGrid, flowGrid, placeGridItem, type GridRect } from "./studio-grid";

/**
 * The control room's panel arrangement. Each workspace is a saved layout of
 * panels on a 12-column grid of fixed-height rows, each panel at an explicit
 * column, row, width and height. An operator moves, resizes, closes and adds
 * panels, and the arrangement is kept in their own browser; the event's
 * saved default is where a new browser starts and what "Reset layout" puts
 * back. The panel contract is shared (live-studio-layout).
 */

export {
  STUDIO_COLUMNS,
  STUDIO_GRID_BOUNDS,
  STUDIO_PANEL_TYPES,
  STUDIO_WORKSPACES,
  studioGridBounds,
  studioLayoutsSchema,
  type StudioLayouts,
  type StudioOutput,
  type StudioPanel,
  type StudioPanelType,
  type StudioWorkspace,
};

export const STUDIO_WORKSPACE_LABELS: Record<StudioWorkspace, string> = {
  show: "Show",
  livestream: "Livestream",
  stage: "Stage",
};

export const STUDIO_PANEL_LABELS: Record<StudioPanelType, string> = {
  monitor: "Monitor",
  transition: "Transition",
  speakers: "Speakers",
  graphics: "Graphics",
  questions: "Questions",
  time: "Time",
  message: "Message to speaker",
  polls: "Polls",
  chat: "Chat",
  screens: "Screens",
};

const isBus = (output: StudioOutput) => (STUDIO_BUSES as readonly string[]).includes(output);

/** Every output of a room in the studio's order: the buses, then the room's outputs in its own order, the stage preview after the speaker's screen. */
export function studioOutputs(room: readonly LiveRoomOutput[]): StudioOutput[] {
  const keys = liveStudioOutputs(room);
  const speaker = keys.indexOf(LIVE_SPEAKER_OUTPUT_KEY);
  const withPreview =
    speaker < 0
      ? [...keys, LIVE_STAGE_PREVIEW_OUTPUT]
      : [...keys.slice(0, speaker + 1), LIVE_STAGE_PREVIEW_OUTPUT, ...keys.slice(speaker + 1)];
  return [...STUDIO_BUSES, ...withPreview];
}

/**
 * The outputs a monitor offers. The stage preview follows the room on its
 * own, so the studio offers it only on a monitor that already shows it; an
 * output the room no longer lists stays on offer where it is shown, so it
 * can be taken off.
 */
export function studioMonitorChoices(shown: readonly StudioOutput[], room: readonly LiveRoomOutput[]): StudioOutput[] {
  const all = studioOutputs(room);
  return [
    ...all.filter((output) => output !== LIVE_STAGE_PREVIEW_OUTPUT || shown.includes(output)),
    ...shown.filter((output) => !all.includes(output)),
  ];
}

/**
 * What a monitor shows in this room. A monitor saved with a screen this room
 * does not have shows the room's own screens in its place, so a multiview
 * made for one room shows every screen of another; with none left, it shows
 * Program.
 */
export function studioShownOutputs(saved: readonly StudioOutput[], room: readonly LiveRoomOutput[]): StudioOutput[] {
  const all = studioOutputs(room);
  const kept = saved.filter((output) => all.includes(output));
  if (kept.length === saved.length && kept.length) return kept;
  const added = liveStudioOutputs(room).filter((output) => !kept.includes(output));
  const shown = new Set([...kept, ...added]);
  return shown.size ? all.filter((output) => shown.has(output)) : ["program"];
}

/** An output's name, code and purpose in this room. */
export function studioOutputDetails(room: readonly LiveRoomOutput[], output: StudioOutput): LiveOutputDetails {
  if (output === "preview") return LIVE_PREVIEW_OUTPUT_DETAILS;
  if (output === "program") return LIVE_PROGRAM_OUTPUT_DETAILS;
  if (output === "livestream") return LIVE_LIVESTREAM_OUTPUT_DETAILS;
  return liveOutputDetails(room, output);
}

export const STUDIO_ROW_PX = 32;

type Seed = [StudioPanelType, GridRect, StudioOutput[]?];
function seeded(workspace: StudioWorkspace, seeds: Seed[]): StudioPanel[] {
  return compactGrid(
    seeds.map(([type, rect, outputs], index) => ({
      id: `${workspace}-${type}-${index}`,
      type,
      ...rect,
      ...(outputs ? { outputs } : {}),
    })),
  );
}

/** The arrangement each workspace has when the event saved none of its own. */
export function builtInStudioLayouts(): StudioLayouts {
  return {
    show: seeded("show", [
      // Preview, the Transition, then the 2x2 multiview: the switcher's own order, Preview to Program.
      ["monitor", { x: 0, y: 0, w: 5, h: 12 }, ["preview"]],
      ["transition", { x: 5, y: 0, w: 2, h: 12 }],
      ["monitor", { x: 7, y: 0, w: 5, h: 12 }, ["program", "livestream", "stage-display", "projector"]],
      ["speakers", { x: 0, y: 12, w: 4, h: 10 }],
      ["questions", { x: 4, y: 12, w: 5, h: 10 }],
      ["graphics", { x: 9, y: 12, w: 3, h: 10 }],
      ["message", { x: 0, y: 22, w: 4, h: 8 }],
      ["polls", { x: 4, y: 22, w: 4, h: 8 }],
      ["chat", { x: 8, y: 22, w: 4, h: 8 }],
    ]),
    // OBS picks the scene, so the operator only chooses what is on air and sends it with PGM: Program and the
    // controls, no Preview, Transition or LIVE, in four columns that fit a Full HD laptop without scrolling.
    livestream: seeded("livestream", [
      ["monitor", { x: 0, y: 0, w: 3, h: 7 }, ["program"]],
      ["speakers", { x: 0, y: 7, w: 3, h: 11 }],
      ["questions", { x: 3, y: 0, w: 3, h: 18 }],
      ["graphics", { x: 6, y: 0, w: 3, h: 11 }],
      ["time", { x: 6, y: 11, w: 3, h: 7 }],
      ["chat", { x: 9, y: 0, w: 3, h: 10 }],
      ["message", { x: 9, y: 10, w: 3, h: 4 }],
      ["polls", { x: 9, y: 14, w: 3, h: 4 }],
    ]),
    stage: seeded("stage", [
      ["monitor", { x: 0, y: 0, w: 6, h: 10 }, ["stage-display"]],
      ["monitor", { x: 6, y: 0, w: 3, h: 5 }, ["stage-preview"]],
      ["monitor", { x: 9, y: 0, w: 3, h: 5 }, ["projector"]],
      ["time", { x: 6, y: 5, w: 6, h: 9 }],
      ["message", { x: 0, y: 10, w: 6, h: 7 }],
      ["questions", { x: 6, y: 14, w: 6, h: 7 }],
    ]),
  };
}

/**
 * The arrangement each workspace starts from in a new browser, and returns to
 * on "Reset layout": the event's saved default, else the built-in one.
 */
export function defaultStudioLayouts(eventDefault: StudioDefaultLayouts = {}): StudioLayouts {
  const builtIn = builtInStudioLayouts();
  return Object.fromEntries(
    STUDIO_WORKSPACES.map((workspace) => {
      const saved = eventDefault[workspace];
      return [workspace, saved ? compactGrid(saved) : builtIn[workspace]];
    }),
  ) as StudioLayouts;
}

const DEFAULT_SIZE: Record<StudioPanelType, { w: number; h: number }> = {
  monitor: { w: 4, h: 7 },
  transition: { w: 2, h: 4 },
  speakers: { w: 4, h: 8 },
  graphics: { w: 4, h: 8 },
  questions: { w: 4, h: 8 },
  time: { w: 4, h: 9 },
  message: { w: 4, h: 7 },
  polls: { w: 4, h: 7 },
  chat: { w: 4, h: 7 },
  screens: { w: 5, h: 12 },
};

/** The size a panel returns to: its place in the default layout, else its type's own size. */
export function defaultStudioSize(workspace: StudioWorkspace, panel: StudioPanel): { w: number; h: number } {
  const seed = builtInStudioLayouts()[workspace].find((entry) => entry.id === panel.id);
  return seed ? { w: seed.w, h: seed.h } : DEFAULT_SIZE[panel.type];
}

/** Puts a panel at a rectangle; the panels it lands on move out of the way and the grid compacts. */
export function placeStudioPanel(panels: readonly StudioPanel[], id: string, rect: GridRect): StudioPanel[] {
  const panel = panels.find((entry) => entry.id === id);
  return placeGridItem(panels, id, rect, panel ? studioGridBounds(panel.type) : STUDIO_GRID_BOUNDS);
}

/** Changes a panel's size from its top-left corner; a panel at the right edge grows to the left. */
export function resizeStudioPanel(
  panels: readonly StudioPanel[],
  id: string,
  size: { w?: number; h?: number },
): StudioPanel[] {
  const panel = panels.find((entry) => entry.id === id);
  if (!panel) return [...panels];
  const w = Math.max(studioGridBounds(panel.type).minW, Math.min(STUDIO_COLUMNS, size.w ?? panel.w));
  return placeStudioPanel(panels, id, {
    x: Math.min(panel.x, STUDIO_COLUMNS - w),
    y: panel.y,
    w,
    h: size.h ?? panel.h,
  });
}

export type StudioDirection = "up" | "down" | "left" | "right";

/** The nearest panel above or below that shares a column with this one. */
function verticalNeighbour(panels: readonly StudioPanel[], panel: StudioPanel, direction: "up" | "down") {
  const candidates = panels.filter(
    (other) =>
      other.id !== panel.id &&
      other.x < panel.x + panel.w &&
      panel.x < other.x + other.w &&
      (direction === "up" ? other.y + other.h <= panel.y : other.y >= panel.y + panel.h),
  );
  return candidates.sort((a, b) => (direction === "up" ? b.y - a.y : a.y - b.y))[0];
}

/** Whether a keyboard move in this direction changes anything. */
export function canMoveStudioPanel(panels: readonly StudioPanel[], id: string, direction: StudioDirection): boolean {
  const panel = panels.find((entry) => entry.id === id);
  if (!panel) return false;
  if (direction === "left") return panel.x > 0;
  if (direction === "right") return panel.x + panel.w < STUDIO_COLUMNS;
  return Boolean(verticalNeighbour(panels, panel, direction));
}

/**
 * The keyboard alternative to dragging: one column sideways, or past the
 * nearest panel above or below in the same columns.
 */
export function moveStudioPanel(panels: readonly StudioPanel[], id: string, direction: StudioDirection): StudioPanel[] {
  const panel = panels.find((entry) => entry.id === id);
  if (!panel || !canMoveStudioPanel(panels, id, direction)) return [...panels];
  if (direction === "left" || direction === "right")
    return placeStudioPanel(panels, id, { ...panel, x: panel.x + (direction === "left" ? -1 : 1) });
  const neighbour = verticalNeighbour(panels, panel, direction)!;
  return placeStudioPanel(panels, id, { ...panel, y: direction === "up" ? neighbour.y : panel.y + neighbour.h });
}

export function closeStudioPanel(panels: readonly StudioPanel[], id: string): StudioPanel[] {
  return compactGrid(panels.filter((panel) => panel.id !== id));
}

/** Adds a panel below the others; a new monitor starts on Program. */
export function addStudioPanel(panels: readonly StudioPanel[], type: StudioPanelType, id: string): StudioPanel[] {
  const bottom = panels.reduce((end, panel) => Math.max(end, panel.y + panel.h), 0);
  return compactGrid([
    ...panels,
    { id, type, x: 0, y: bottom, ...DEFAULT_SIZE[type], ...(type === "monitor" ? { outputs: ["program"] } : {}) },
  ]);
}

/** Turns one output on or off in a monitor, which always keeps at least one, in the canonical order. */
export function toggleStudioOutput(
  panels: readonly StudioPanel[],
  id: string,
  output: StudioOutput,
  room: readonly LiveRoomOutput[],
): StudioPanel[] {
  return panels.map((panel) => {
    if (panel.id !== id) return panel;
    const current = studioShownOutputs(panel.outputs ?? ["program"], room);
    const next = current.includes(output)
      ? current.filter((entry) => entry !== output)
      : studioMonitorChoices([...current, output], room).filter((entry) => entry === output || current.includes(entry));
    if (!next.length) return panel;
    return { ...panel, outputs: next };
  });
}

/** Shows or hides the name on the Transition's button. */
export function setStudioPanelLabeled(panels: readonly StudioPanel[], id: string, labeled: boolean): StudioPanel[] {
  return panels.map((panel) => {
    if (panel.id !== id) return panel;
    const { labeled: _shown, ...rest } = panel;
    return labeled ? { ...rest, labeled: true } : rest;
  });
}

/** Shows or hides the scenes under a Preview monitor. */
export function setStudioPanelScenes(panels: readonly StudioPanel[], id: string, scenes: boolean): StudioPanel[] {
  return panels.map((panel) => {
    if (panel.id !== id) return panel;
    const { scenes: _shown, ...rest } = panel;
    return scenes ? rest : { ...rest, scenes: false };
  });
}

/**
 * The overlay layout a monitor's tile draws for an output: always the scene
 * the output itself draws, so a monitor shows what its screen shows. The
 * stream and the stage preview, which carry no scene of their own, draw the
 * event's default.
 */
export function studioOutputLayout(output: StudioOutput): string | null {
  // Preview and Program draw the scene their composition carries, as the room's sources do.
  if (output === "preview" || output === "program") return null;
  return isBus(output) || output === LIVE_STAGE_PREVIEW_OUTPUT ? LIVE_OVERLAY_DEFAULT_LAYOUT : null;
}

export const STUDIO_LAYOUT_STORAGE_KEY = "pkic.live-studio.layouts.v2";
/** The first arrangement shape: panels in reading order, each with a column span and an optional pixel height. */
export const STUDIO_LAYOUT_V1_STORAGE_KEY = "pkic.live-studio.layouts.v1";
const studioPanelV1Schema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(STUDIO_PANEL_TYPES),
  span: z.number().int().min(STUDIO_MIN_W).max(STUDIO_COLUMNS),
  height: z.number().nullable(),
  outputs: z.array(studioOutputSchema).min(1).max(STUDIO_OUTPUTS_MAX).optional(),
});

/** A first-shape arrangement laid on the grid in its own order; a workspace that does not read starts over. */
export function migrateStudioLayoutsV1(saved: unknown): StudioLayouts {
  const defaults = builtInStudioLayouts();
  const record = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  return Object.fromEntries(
    STUDIO_WORKSPACES.map((workspace) => {
      const parsed = z
        .array(studioPanelV1Schema)
        .max(STUDIO_MAX_PANELS)
        .safeParse(withoutRetiredStudioPanels(record[workspace]));
      if (!parsed.success) return [workspace, defaults[workspace]];
      const placed = flowGrid(
        parsed.data,
        (panel) => ({
          w: panel.span,
          h: panel.height === null ? DEFAULT_SIZE[panel.type].h : Math.round(panel.height / STUDIO_ROW_PX),
        }),
        STUDIO_GRID_BOUNDS,
      );
      return [
        workspace,
        placed.map(({ id, type, x, y, w, h, outputs }) => ({ id, type, x, y, w, h, ...(outputs ? { outputs } : {}) })),
      ];
    }),
  ) as StudioLayouts;
}

function readJson(storage: Pick<Storage, "getItem">, key: string): unknown {
  const raw = storage.getItem(key);
  return raw ? JSON.parse(raw) : undefined;
}

/**
 * The operator's saved arrangement. A first-shape one moves onto the grid
 * once and its old entry is dropped; a missing or unreadable one falls back
 * to the event's default, and overlapping panels settle into place.
 */
export function loadStudioLayouts(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  eventDefault: StudioDefaultLayouts = {},
): StudioLayouts {
  try {
    if (storage) {
      const saved = studioLayoutsSchema.safeParse(readJson(storage, STUDIO_LAYOUT_STORAGE_KEY));
      if (saved.success)
        return Object.fromEntries(
          STUDIO_WORKSPACES.map((workspace) => [workspace, compactGrid(saved.data[workspace])]),
        ) as StudioLayouts;
      const first = readJson(storage, STUDIO_LAYOUT_V1_STORAGE_KEY);
      if (first !== undefined) {
        const migrated = migrateStudioLayoutsV1(first);
        saveStudioLayouts(storage, migrated);
        storage.removeItem(STUDIO_LAYOUT_V1_STORAGE_KEY);
        return migrated;
      }
    }
  } catch {
    // Storage can be blocked or hold something else; the defaults still work.
  }
  return defaultStudioLayouts(eventDefault);
}

/** Whether this browser keeps an arrangement of its own; until it does, the studio follows the event's default. */
export function hasOwnStudioLayouts(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return Boolean(
      storage &&
      (storage.getItem(STUDIO_LAYOUT_STORAGE_KEY) !== null || storage.getItem(STUDIO_LAYOUT_V1_STORAGE_KEY) !== null),
    );
  } catch {
    return false;
  }
}

export function saveStudioLayouts(storage: Pick<Storage, "setItem"> | null, layouts: StudioLayouts): void {
  try {
    storage?.setItem(STUDIO_LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // A full or blocked storage keeps the arrangement for this visit only.
  }
}

/**
 * Saves one workspace's arrangement over the arrangement the browser holds
 * now, not over this page's copy of the others: two studio tabs each keep
 * the workspace they changed last. Returns every workspace as now saved.
 */
export function saveStudioWorkspace(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  workspace: StudioWorkspace,
  panels: StudioPanel[],
  fallback: StudioLayouts,
): StudioLayouts {
  let saved = fallback;
  try {
    const stored = studioLayoutsSchema.safeParse(storage ? readJson(storage, STUDIO_LAYOUT_STORAGE_KEY) : undefined);
    if (stored.success) saved = stored.data;
  } catch {
    // An unreadable entry is replaced by this page's arrangement.
  }
  const next = { ...saved, [workspace]: panels };
  saveStudioLayouts(storage, next);
  return next;
}

/** The browser's storage when the page may use it. */
export function studioStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
