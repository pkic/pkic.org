import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { liveGraphicThemeSchema } from "../live-graphic-theme";
import { liveCheckInTextSchema, liveLowerThirdMotionSchema } from "./live-session-graphic-settings";
import { liveChatFeedConfigSchema, liveTopQuestionsConfigSchema } from "./live-session-on-screen";
import { liveScheduleConfigSchema } from "./live-session-schedule";
import { livePanelistsSchema } from "./live-session-stage";
import { liveTickerConfigSchema } from "./live-session-ticker";
import { liveTimerGraphicSchema } from "./live-session-timer";
import { studioDefaultLayoutsSchema } from "./live-studio-layout";

/**
 * An event's studio setup, prepared before the show: how each graphic looks
 * when it goes on air, and the panel arrangement each studio workspace starts
 * from. Every room of the event shares it. A graphic with no saved setup uses
 * the built-in one; a room's content (its session, speakers and questions)
 * always comes from the room itself.
 */

/** The check-in code's look and instruction; which code to show is picked per session. */
export const liveCheckInSetupSchema = z.object({ theme: liveGraphicThemeSchema, text: liveCheckInTextSchema }).strict();
export type LiveCheckInSetup = z.infer<typeof liveCheckInSetupSchema>;

/**
 * How a timer looks when it first goes on air. Its label and when it turns
 * amber or red belong to each timer, so they are set on the timer itself.
 */
export const liveTimerLookSetupSchema = liveTimerGraphicSchema
  .pick({
    showLabel: true,
    format: true,
    customFormat: true,
    direction: true,
    presentation: true,
    placement: true,
    size: true,
  })
  .strict();
export type LiveTimerLookSetup = z.infer<typeof liveTimerLookSetupSchema>;

/** How lower thirds go on and off air in a room that has not chosen yet. */
export const liveLowerThirdSetupSchema = z.object({ motion: liveLowerThirdMotionSchema }).strict();
export type LiveLowerThirdSetup = z.infer<typeof liveLowerThirdSetupSchema>;

export const liveStudioGraphicsSetupSchema = z
  .object({
    ticker: liveTickerConfigSchema.optional(),
    schedule: liveScheduleConfigSchema.optional(),
    topQuestions: liveTopQuestionsConfigSchema.optional(),
    chatFeed: liveChatFeedConfigSchema.optional(),
    panelists: livePanelistsSchema.optional(),
    checkIn: liveCheckInSetupSchema.optional(),
    timer: liveTimerLookSetupSchema.optional(),
    lowerThird: liveLowerThirdSetupSchema.optional(),
  })
  .strict();
export type LiveStudioGraphicsSetup = z.infer<typeof liveStudioGraphicsSetupSchema>;
export type LiveStudioGraphic = keyof LiveStudioGraphicsSetup;

export const liveStudioSetupSchema = z
  .object({
    graphics: liveStudioGraphicsSetupSchema,
    layouts: studioDefaultLayoutsSchema,
  })
  .strict();
export type LiveStudioSetup = z.infer<typeof liveStudioSetupSchema>;
export const EMPTY_LIVE_STUDIO_SETUP: LiveStudioSetup = { graphics: {}, layouts: {} };

/** The setup as saved, with its version; `updatedAt` is null while the event has saved none. */
export const eventLiveStudioSetupResponseSchema = liveStudioSetupSchema
  .extend({ updatedAt: utcInstantSchema.nullable() })
  .strict();
export type EventLiveStudioSetupResponse = z.infer<typeof eventLiveStudioSetupResponseSchema>;

/**
 * Replaces the event's setup. `expectedUpdatedAt` is null to save it for the
 * first time; otherwise it is the version the studio started from.
 */
export const eventLiveStudioSetupPutSchema = liveStudioSetupSchema
  .extend({ expectedUpdatedAt: utcInstantSchema.nullable() })
  .strict();
export type EventLiveStudioSetupPut = z.infer<typeof eventLiveStudioSetupPutSchema>;
