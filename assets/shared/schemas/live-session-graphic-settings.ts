/** Per-graphic settings a composition carries: the check-in code's theme and the lower third's motion. */
import { z } from "zod";
import { liveCheckInGraphicSchema } from "./event-attendance-points";
import { LIVE_GRAPHIC_THEME_DEFAULTS, liveGraphicThemeSchema } from "../live-graphic-theme";
import { validateOverlayTextTemplate } from "../overlay-text-template";
import { LIVE_LOWER_THIRD_MOTIONS } from "../live-lower-third";

/** Whether the lower third animates on and off this composition, or cuts. */
export const liveLowerThirdMotionSchema = z.enum(LIVE_LOWER_THIRD_MOTIONS);

export const DEFAULT_LIVE_CHECK_IN_TEXT = { visible: true, template: "Scan with your phone camera to check in" };
export const liveCheckInTextSchema = z
  .object({
    visible: z.boolean(),
    template: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => validateOverlayTextTemplate(value) === null, "Use a valid text template."),
  })
  .strict();
export type LiveCheckInText = z.infer<typeof liveCheckInTextSchema>;

/** The check-in code as an output shows it: the code the room signed, in the theme the operator chose. */
export const liveCheckInOnAirSchema = liveCheckInGraphicSchema
  .extend({
    theme: liveGraphicThemeSchema.default(LIVE_GRAPHIC_THEME_DEFAULTS.checkIn),
    text: liveCheckInTextSchema.default(DEFAULT_LIVE_CHECK_IN_TEXT),
  })
  .strict();
export type LiveCheckInOnAir = z.infer<typeof liveCheckInOnAirSchema>;
