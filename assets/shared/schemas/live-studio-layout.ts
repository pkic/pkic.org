import { z } from "zod";
import { LIVE_HELD_OUTPUTS_MAX, liveAuxOutputSchema } from "./live-session-stage";

/**
 * The control room's panel arrangement as a contract: each workspace is a
 * layout of panels on a 12-column grid of fixed-height rows, each panel at an
 * explicit column, row, width and height. An operator's own arrangement stays
 * in their browser; the event's default arrangement is part of its saved
 * studio setup.
 */

export const STUDIO_WORKSPACES = ["show", "livestream", "stage"] as const;
export type StudioWorkspace = (typeof STUDIO_WORKSPACES)[number];

export const STUDIO_PANEL_TYPES = [
  "monitor",
  "transition",
  "speakers",
  "graphics",
  "questions",
  "time",
  "message",
  "polls",
  "chat",
  "screens",
] as const;
export type StudioPanelType = (typeof STUDIO_PANEL_TYPES)[number];

/** What a monitor can show besides the room's own outputs: the two switcher buses and the stream viewers see. */
export const STUDIO_BUSES = ["preview", "program", "livestream"] as const;
export const studioOutputSchema = z.union([z.enum(STUDIO_BUSES), liveAuxOutputSchema]);
/** A monitor's output: a switcher bus, the stream, or one of the room's outputs by its key. */
export type StudioOutput = z.infer<typeof studioOutputSchema>;
export const STUDIO_OUTPUTS_MAX = STUDIO_BUSES.length + LIVE_HELD_OUTPUTS_MAX;

export const STUDIO_COLUMNS = 12;
export const STUDIO_MIN_W = 3;
export const STUDIO_MIN_H = 4;
export const STUDIO_MAX_H = 40;
const STUDIO_MAX_ROW = 400;
export const STUDIO_MAX_PANELS = 24;

/** The grid's columns and the smallest and tallest a panel may be. */
export interface StudioPanelBounds {
  columns: number;
  minW: number;
  minH: number;
  maxH: number;
}
export const STUDIO_GRID_BOUNDS: StudioPanelBounds = {
  columns: STUDIO_COLUMNS,
  minW: STUDIO_MIN_W,
  minH: STUDIO_MIN_H,
  maxH: STUDIO_MAX_H,
};
/**
 * The Transition holds one button, so it may be one column wide and three rows
 * high; at two its name fits. A monitor scales its picture to any size, so it
 * may be as small.
 */
const PANEL_GRID_BOUNDS: Partial<Record<StudioPanelType, StudioPanelBounds>> = {
  transition: { ...STUDIO_GRID_BOUNDS, minW: 1, minH: 3 },
  monitor: { ...STUDIO_GRID_BOUNDS, minW: 1, minH: 3 },
};
/** The smallest a panel of this type may be. */
export function studioGridBounds(type: StudioPanelType): StudioPanelBounds {
  return PANEL_GRID_BOUNDS[type] ?? STUDIO_GRID_BOUNDS;
}

export const studioPanelSchema = z
  .object({
    id: z.string().min(1).max(80),
    type: z.enum(STUDIO_PANEL_TYPES),
    x: z
      .number()
      .int()
      .min(0)
      .max(STUDIO_COLUMNS - 1),
    y: z.number().int().min(0).max(STUDIO_MAX_ROW),
    w: z.number().int().min(1).max(STUDIO_COLUMNS),
    h: z.number().int().min(1).max(STUDIO_MAX_H),
    outputs: z.array(studioOutputSchema).min(1).max(STUDIO_OUTPUTS_MAX).optional(),
    /** The Transition's button shows its name beside the arrow. */
    labeled: z.literal(true).optional(),
    /** A Preview monitor shows the event's scenes under its picture unless the operator hid them. */
    scenes: z.literal(false).optional(),
  })
  .strict()
  .refine((panel) => panel.x + panel.w <= STUDIO_COLUMNS, "A panel stays within the grid's columns.")
  .refine((panel) => {
    const bounds = studioGridBounds(panel.type);
    return panel.w >= bounds.minW && panel.h >= bounds.minH;
  }, "A panel is at least its type's smallest size.");
export type StudioPanel = z.infer<typeof studioPanelSchema>;

/** Panel types the studio no longer has: the output links are on the event's live layouts settings. A saved one is dropped. */
const RETIRED_PANEL_TYPES: ReadonlySet<unknown> = new Set(["sources"]);
/** A saved monitor may still name a scene per tile, from when a tile could draw another scene than its screen. */
const withoutTileScenes = (panel: unknown) => {
  if (!panel || typeof panel !== "object" || !("layouts" in panel)) return panel;
  const { layouts: _retired, ...rest } = panel;
  return rest;
};
/** A saved arrangement without the panels and fields the studio no longer has. */
export const withoutRetiredStudioPanels = (panels: unknown) =>
  Array.isArray(panels)
    ? panels
        .filter((panel: unknown) => !RETIRED_PANEL_TYPES.has((panel as { type?: unknown } | null)?.type))
        .map(withoutTileScenes)
    : panels;
export const studioWorkspaceSchema = z.preprocess(
  withoutRetiredStudioPanels,
  z
    .array(studioPanelSchema)
    .max(STUDIO_MAX_PANELS)
    .refine((panels) => new Set(panels.map((panel) => panel.id)).size === panels.length, "Each panel appears once."),
);
export const studioLayoutsSchema = z
  .object(
    Object.fromEntries(STUDIO_WORKSPACES.map((workspace) => [workspace, studioWorkspaceSchema])) as Record<
      StudioWorkspace,
      typeof studioWorkspaceSchema
    >,
  )
  .strict();
export type StudioLayouts = Record<StudioWorkspace, StudioPanel[]>;

/** The arrangements an event saved as its default, by workspace; a workspace it has not saved uses the built-in one. */
export const studioDefaultLayoutsSchema = studioLayoutsSchema.partial();
export type StudioDefaultLayouts = Partial<StudioLayouts>;
