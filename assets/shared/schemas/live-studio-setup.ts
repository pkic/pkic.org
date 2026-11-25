import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { liveGraphicThemeSchema } from "../live-graphic-theme";
import { liveCheckInTextSchema } from "./live-session-graphic-settings";
import { liveChatFeedConfigSchema, liveTopQuestionsConfigSchema } from "./live-session-on-screen";
import { liveScheduleConfigSchema } from "./live-session-schedule";
import { livePanelistsSchema } from "./live-session-stage";
import { liveTickerConfigSchema } from "./live-session-ticker";
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

export const liveStudioGraphicsSetupSchema = z
  .object({
    ticker: liveTickerConfigSchema.optional(),
    schedule: liveScheduleConfigSchema.optional(),
    topQuestions: liveTopQuestionsConfigSchema.optional(),
    chatFeed: liveChatFeedConfigSchema.optional(),
    panelists: livePanelistsSchema.optional(),
    checkIn: liveCheckInSetupSchema.optional(),
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
