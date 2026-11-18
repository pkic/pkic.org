import { z } from "zod";

/**
 * How a broadcast graphic is colored: in the event's own colors (white type
 * on the event's field with its stripe, as on the boards and the lower
 * third), or white or black type on a transparent, black or white ground.
 * Same on same is never offered. Each graphic that
 * takes a theme keeps it in its own settings on each output's composition,
 * like the timer graphic's, so Program can show a graphic on a dark plate
 * while the projector shows the same graphic black on white.
 */
export const LIVE_GRAPHIC_THEMES = [
  "event",
  "white-on-transparent",
  "white-on-black",
  "black-on-transparent",
  "black-on-white",
] as const;
export type LiveGraphicTheme = (typeof LIVE_GRAPHIC_THEMES)[number];
export const liveGraphicThemeSchema = z.enum(LIVE_GRAPHIC_THEMES);

export const LIVE_GRAPHIC_THEME_LABELS: Record<LiveGraphicTheme, string> = {
  event: "Event colors",
  "white-on-transparent": "White on transparent",
  "white-on-black": "White on black",
  "black-on-transparent": "Black on transparent",
  "black-on-white": "Black on white",
};

/**
 * Each themed graphic's default: the event's colors, so Up next and the
 * check-in card match the boards and the lower third on air. The check-in
 * code itself stays black on white in every theme with a ground, which phone
 * cameras read best.
 */
export const LIVE_GRAPHIC_THEME_DEFAULTS = {
  schedule: "event",
  checkIn: "event",
} as const satisfies Record<string, LiveGraphicTheme>;
