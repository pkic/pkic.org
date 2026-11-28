import { z } from "zod";

/**
 * How a broadcast graphic is colored: in the event's own colors (white type
 * on the event's field with its stripe, as on the boards and the lower
 * third), on a see-through card that lets the production's own background
 * show through (navy, smoked, frosted or deep blue), or white or black type
 * on a transparent, black or white ground.
 * Same on same is never offered. Each graphic that
 * takes a theme keeps it in its own settings on each output's composition,
 * like the timer graphic's, so Program can show a graphic on a dark plate
 * while the projector shows the same graphic black on white.
 */
export const LIVE_GRAPHIC_THEMES = [
  "navy-glass",
  "smoked-glass",
  "frosted-glass",
  "deep-blue",
  "event",
  "white-on-transparent",
  "white-on-black",
  "black-on-transparent",
  "black-on-white",
] as const;
export type LiveGraphicTheme = (typeof LIVE_GRAPHIC_THEMES)[number];
export const liveGraphicThemeSchema = z.enum(LIVE_GRAPHIC_THEMES);

export const LIVE_GRAPHIC_THEME_LABELS: Record<LiveGraphicTheme, string> = {
  "navy-glass": "Navy glass",
  "smoked-glass": "Smoked glass",
  "frosted-glass": "Frosted glass",
  "deep-blue": "Deep blue",
  event: "Event colors",
  "white-on-transparent": "White on transparent",
  "white-on-black": "White on black",
  "black-on-transparent": "Black on transparent",
  "black-on-white": "Black on white",
};

/**
 * Each themed graphic's default: navy glass, a calm card that reads on the
 * brand gradient and on a photo alike, where the event's colors would put
 * green on green. On a scene's background the card drops its plate and takes
 * the field's type, so it still matches the boards there. The check-in code
 * itself stays black on white in every theme with a ground, which phone
 * cameras read best.
 */
export const LIVE_GRAPHIC_THEME_DEFAULTS = {
  schedule: "navy-glass",
  checkIn: "navy-glass",
} as const satisfies Record<string, LiveGraphicTheme>;

/**
 * The colors a scene's background can take: the field every board in the
 * scene sits on. The boards set white type, so the field takes only the
 * colors white type reads on: the event's field, or a navy, smoked or deep
 * blue see-through panel that lets the production's own background show.
 * Navy glass when a scene has not chosen.
 */
export const LIVE_FIELD_THEMES = [
  "navy-glass",
  "smoked-glass",
  "deep-blue",
  "event",
] as const satisfies readonly LiveGraphicTheme[];
export type LiveFieldTheme = (typeof LIVE_FIELD_THEMES)[number];
export const liveFieldThemeSchema = z.enum(LIVE_FIELD_THEMES);
export const LIVE_FIELD_THEME_DEFAULT: LiveFieldTheme = "navy-glass";
