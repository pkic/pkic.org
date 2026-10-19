import { z } from "zod";

/**
 * How a broadcast graphic is colored: white or black type on a transparent,
 * black or white ground. Same on same is never offered. Each graphic that
 * takes a theme keeps it in its own settings on each output's composition,
 * like the timer graphic's, so Program can show a graphic on a dark plate
 * while the projector shows the same graphic black on white.
 */
export const LIVE_GRAPHIC_THEMES = [
  "white-on-transparent",
  "white-on-black",
  "black-on-transparent",
  "black-on-white",
] as const;
export type LiveGraphicTheme = (typeof LIVE_GRAPHIC_THEMES)[number];
export const liveGraphicThemeSchema = z.enum(LIVE_GRAPHIC_THEMES);

export const LIVE_GRAPHIC_THEME_LABELS: Record<LiveGraphicTheme, string> = {
  "white-on-transparent": "White on transparent",
  "white-on-black": "White on black",
  "black-on-transparent": "Black on transparent",
  "black-on-white": "Black on white",
};

/**
 * Each themed graphic's default. Up next sits over the picture on a dark
 * plate so it reads on any shot; the check-in code keeps the white card it
 * has always had, which phone cameras read best.
 */
export const LIVE_GRAPHIC_THEME_DEFAULTS = {
  schedule: "white-on-black",
  checkIn: "black-on-white",
} as const satisfies Record<string, LiveGraphicTheme>;
