import { z } from "zod";
import type { LiveProgramLayer } from "../live-overlay-stacking";

/**
 * The graphics an operator can keep in every scene. A scene decides where
 * each graphic draws and whether it can show at all; a kept graphic
 * overrules it and draws in every scene, at the event's shared position,
 * above the scene's own graphics. Keeping one never puts it on or takes it
 * off: it still shows only on the outputs that have it on. The room keeps
 * one list for every output.
 */

/** The graphics an operator puts on and off; the background and the QR code come with the scene itself. */
export const LIVE_LOCKABLE_GRAPHICS = [
  "lowerThird",
  "question",
  "poll",
  "timer",
  "ticker",
  "schedule",
  "panelists",
  "checkIn",
  "topQuestions",
  "chat",
  "reactions",
] as const satisfies readonly LiveProgramLayer[];

export const liveLockedGraphicSchema = z.enum(LIVE_LOCKABLE_GRAPHICS);
export type LiveLockedGraphic = z.infer<typeof liveLockedGraphicSchema>;

export function isLiveLockableGraphic(element: string): element is LiveLockedGraphic {
  return (LIVE_LOCKABLE_GRAPHICS as readonly string[]).includes(element);
}

/** The graphics kept in every scene, each at most once, in the order they were kept. */
export const liveLockedGraphicsSchema = z
  .array(liveLockedGraphicSchema)
  .max(LIVE_LOCKABLE_GRAPHICS.length)
  .refine((graphics) => new Set(graphics).size === graphics.length, "Keep each graphic once.");
export type LiveLockedGraphics = z.infer<typeof liveLockedGraphicsSchema>;

/** The room snapshot's copy: none kept until an operator keeps one. */
export const liveLockedGraphicsSnapshotSchema = liveLockedGraphicsSchema.default([]);

/** One graphic at a time, so two operators keeping different graphics never undo each other. */
export const liveGraphicLockCommandSchema = z
  .object({ type: z.literal("graphic.lock"), graphic: liveLockedGraphicSchema, locked: z.boolean() })
  .strict();

export const liveGraphicLockChangedSchema = z
  .object({ type: z.literal("graphic.lock.changed"), lockedGraphics: liveLockedGraphicsSchema })
  .strict();

/** The room's list with one graphic kept or released. */
export function withLiveGraphicLock(
  locked: LiveLockedGraphics,
  graphic: LiveLockedGraphic,
  lock: boolean,
): LiveLockedGraphics {
  if (lock) return locked.includes(graphic) ? locked : [...locked, graphic];
  return locked.filter((kept) => kept !== graphic);
}
