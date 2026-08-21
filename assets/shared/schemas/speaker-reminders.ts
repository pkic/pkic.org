import { z } from "zod";
import { successResponseSchema } from "./api-common";

export const speakerReminderPreferenceSchema = z.object({
  action: z.enum(["postpone_7d", "pause_30d", "resume"]),
});

export const speakerReminderPreferenceResponseSchema = successResponseSchema.extend({
  state: z.enum(["active", "postponed", "paused"]),
  pausedUntil: z.string().nullable(),
});
