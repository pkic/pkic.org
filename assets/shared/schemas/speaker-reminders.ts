import { z } from "zod";
import { successResponseSchema } from "./api-common";

export const speakerReminderPreferencePatchSchema = z.object({
  state: z.enum(["active", "postponed", "paused"]),
});

export const speakerReminderPreferenceResponseSchema = successResponseSchema.extend({
  state: z.enum(["active", "postponed", "paused"]),
  pausedUntil: z.string().nullable(),
});
