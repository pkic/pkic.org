import { z } from "zod";
import { eventSlugParamsSchema, slugPattern, utcInstantSchema } from "./api-common";

/**
 * Broadcast overlay layouts. An output (Program, Projector, Stage preview,
 * Stage display) holds what is on air; a layout decides which of its elements
 * show and where. Every browser source names its layout, so one output
 * can feed several scenes, each with its own arrangement.
 */

/** Every layer the overlay draws, in the order the editor lists them. */
export const LIVE_OVERLAY_ELEMENTS = [
  "lowerThird",
  "question",
  "poll",
  "timer",
  "ticker",
  "schedule",
  "panelists",
  "checkIn",
  "reactions",
  "stageDisplay",
  "stageMessage",
] as const;
export type LiveOverlayElement = (typeof LIVE_OVERLAY_ELEMENTS)[number];
export const LIVE_OVERLAY_ELEMENT_LABELS: Record<LiveOverlayElement, string> = {
  lowerThird: "Lower third",
  question: "Question",
  poll: "Poll results",
  timer: "Timer graphic",
  ticker: "News ticker",
  schedule: "Up next",
  panelists: "Panel",
  checkIn: "Check-in code",
  reactions: "Reactions",
  stageDisplay: "Stage display",
  stageMessage: "Message to speaker",
};

/** The two compositions an element can belong to: Program (and the outputs drawn like it), or the stage display. */
export type LiveOverlayComposition = "program" | "stage-display";
export const LIVE_OVERLAY_ELEMENT_COMPOSITIONS: Record<LiveOverlayElement, readonly LiveOverlayComposition[]> = {
  lowerThird: ["program"],
  question: ["program"],
  poll: ["program"],
  timer: ["program"],
  ticker: ["program"],
  schedule: ["program"],
  panelists: ["program"],
  checkIn: ["program", "stage-display"],
  reactions: ["program"],
  stageDisplay: ["stage-display"],
  stageMessage: ["stage-display"],
};

/** The broadcast frame every overlay is drawn on, in pixels. */
export const LIVE_OVERLAY_FRAME = { width: 1920, height: 1080 } as const;
/** The smallest box an element can have, as a fraction of the frame's side. */
export const LIVE_OVERLAY_MIN_BOX = 0.02;
/** Rounding slack when a box's far edge lands on the frame's edge. */
const EDGE_SLACK = 1e-6;

export const LIVE_OVERLAY_HORIZONTAL = ["left", "center", "right"] as const;
export const LIVE_OVERLAY_VERTICAL = ["top", "middle", "bottom"] as const;
const fraction = z.number().min(0).max(1);
const extent = z.number().min(LIVE_OVERLAY_MIN_BOX).max(1);

const boxShape = {
  x: fraction,
  y: fraction,
  w: extent,
  h: extent,
  horizontal: z.enum(LIVE_OVERLAY_HORIZONTAL),
  vertical: z.enum(LIVE_OVERLAY_VERTICAL),
};
/** Keeps a box inside the 16:9 frame, allowing for rounding at the far edges. */
function insideFrame<Schema extends z.ZodType<{ x: number; y: number; w: number; h: number }>>(schema: Schema) {
  return schema
    .refine((box) => box.x + box.w <= 1 + EDGE_SLACK, { message: "Keep the element inside the frame.", path: ["w"] })
    .refine((box) => box.y + box.h <= 1 + EDGE_SLACK, { message: "Keep the element inside the frame.", path: ["h"] });
}

/** An element's box as fractions of the 16:9 frame, and how the graphic aligns inside it when their shapes differ. */
export const liveOverlayElementBoxSchema = insideFrame(z.object(boxShape).strict());
export type LiveOverlayElementBox = z.infer<typeof liveOverlayElementBoxSchema>;

/**
 * Where one element sits on one layout: whether it shows, and its box. An
 * element `shared` with the event's other layouts takes the event's shared
 * position for it, so moving it once moves it on every layout that shares
 * it; a layout that places it differently keeps its own box.
 */
export const liveOverlayElementPlacementSchema = insideFrame(
  z.object({ visible: z.boolean(), shared: z.boolean(), ...boxShape }).strict(),
);
export type LiveOverlayElementPlacement = z.infer<typeof liveOverlayElementPlacementSchema>;

export const liveOverlayLayoutElementsSchema = z
  .object(
    Object.fromEntries(LIVE_OVERLAY_ELEMENTS.map((element) => [element, liveOverlayElementPlacementSchema])) as Record<
      LiveOverlayElement,
      typeof liveOverlayElementPlacementSchema
    >,
  )
  .strict();
export type LiveOverlayLayoutElements = z.infer<typeof liveOverlayLayoutElementsSchema>;

/** The event's shared position for every element, which each layout takes unless it places the element itself. */
export const liveOverlaySharedPositionsSchema = z
  .object(
    Object.fromEntries(LIVE_OVERLAY_ELEMENTS.map((element) => [element, liveOverlayElementBoxSchema])) as Record<
      LiveOverlayElement,
      typeof liveOverlayElementBoxSchema
    >,
  )
  .strict();
export type LiveOverlaySharedPositions = z.infer<typeof liveOverlaySharedPositionsSchema>;

/** The built-in layouts every event starts with; their data lives in `live-overlay-layout-presets.ts`. */
export const LIVE_OVERLAY_PRESETS = [
  "full-frame",
  "lower-third",
  "side-by-side",
  "close-up",
  "panel",
  "ticker-only",
] as const;
export type LiveOverlayPreset = (typeof LIVE_OVERLAY_PRESETS)[number];
/** The layout a browser source uses when it names none, or one the event does not have. */
export const LIVE_OVERLAY_DEFAULT_LAYOUT: LiveOverlayPreset = "full-frame";
/** Saved layouts per event, built-in ones the organizers changed included. */
export const LIVE_OVERLAY_MAX_SAVED_LAYOUTS = 24;

/** The name a browser source uses for a layout; it never changes once the layout exists. */
export const liveOverlayLayoutSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(slugPattern, "Use lowercase letters, digits and hyphens.");
export const liveOverlayLayoutNameSchema = z.string().trim().min(1, "Enter a name.").max(60);

/** What a live room carries for each saved layout: its name, for the operators' pickers, and the geometry its outputs draw. */
export const liveOverlayLayoutGeometrySchema = z
  .object({
    slug: liveOverlayLayoutSlugSchema,
    name: liveOverlayLayoutNameSchema,
    elements: liveOverlayLayoutElementsSchema,
  })
  .strict();
export type LiveOverlayLayoutGeometry = z.infer<typeof liveOverlayLayoutGeometrySchema>;
/** Every layout a room's sources can name, built-in ones included, each resolved against the shared positions. */
export const liveOverlayLayoutGeometriesSchema = z
  .array(liveOverlayLayoutGeometrySchema)
  .max(LIVE_OVERLAY_MAX_SAVED_LAYOUTS + LIVE_OVERLAY_PRESETS.length);

export const liveOverlayLayoutSchema = z
  .object({
    slug: liveOverlayLayoutSlugSchema,
    name: liveOverlayLayoutNameSchema,
    /** The built-in layout this one started from; reset puts its elements back. */
    preset: z.enum(LIVE_OVERLAY_PRESETS).nullable(),
    /** A built-in layout keeps its name in source links and cannot be deleted. */
    builtIn: z.boolean(),
    /** Saved for this event; a built-in layout no one changed is not. */
    saved: z.boolean(),
    elements: liveOverlayLayoutElementsSchema,
    /** When the saved layout last changed; null until it is saved. */
    updatedAt: utcInstantSchema.nullable(),
  })
  .strict();
export type LiveOverlayLayout = z.infer<typeof liveOverlayLayoutSchema>;

/** The event's shared positions: saved for this event, or the built-in ones (Full frame's boxes) until then. */
export const liveOverlayPositionsSchema = z
  .object({
    elements: liveOverlaySharedPositionsSchema,
    saved: z.boolean(),
    /** When the shared positions last changed; null until they are saved. */
    updatedAt: utcInstantSchema.nullable(),
  })
  .strict();
export type LiveOverlayPositions = z.infer<typeof liveOverlayPositionsSchema>;

/**
 * The event's layouts: the default first, then the other built-in ones, then
 * the organizers' own, each element a layout shares already at the shared
 * position, and the shared positions themselves.
 */
export const eventLiveOverlayLayoutsResponseSchema = z
  .object({
    layouts: z.array(liveOverlayLayoutSchema).max(LIVE_OVERLAY_MAX_SAVED_LAYOUTS + LIVE_OVERLAY_PRESETS.length),
    positions: liveOverlayPositionsSchema,
  })
  .strict();
export type EventLiveOverlayLayoutsResponse = z.infer<typeof eventLiveOverlayLayoutsResponseSchema>;

export const eventLiveOverlayLayoutParamsSchema = eventSlugParamsSchema.extend({
  layoutSlug: liveOverlayLayoutSlugSchema,
});

/**
 * Creates or replaces one layout. `expectedUpdatedAt` is null to create it,
 * or to save a built-in layout for the first time; otherwise it is the
 * version the editor started from.
 */
export const eventLiveOverlayLayoutPutSchema = z
  .object({
    expectedUpdatedAt: utcInstantSchema.nullable(),
    name: liveOverlayLayoutNameSchema,
    preset: z.enum(LIVE_OVERLAY_PRESETS).nullable(),
    elements: liveOverlayLayoutElementsSchema,
  })
  .strict();
export type EventLiveOverlayLayoutPut = z.infer<typeof eventLiveOverlayLayoutPutSchema>;

/**
 * Replaces the event's shared positions. `expectedUpdatedAt` is null to save
 * them for the first time; otherwise it is the version the editor started from.
 */
export const eventLiveOverlayPositionsPutSchema = z
  .object({ expectedUpdatedAt: utcInstantSchema.nullable(), elements: liveOverlaySharedPositionsSchema })
  .strict();
export type EventLiveOverlayPositionsPut = z.infer<typeof eventLiveOverlayPositionsPutSchema>;
