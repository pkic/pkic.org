import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
export const agendaCalendarSettingsSchema = z
  .object({
    reminderEnabled: z.boolean(),
    reminderMinutes: z.number().int().min(1).max(1440),
    includeTentative: z.boolean(),
  })
  .strict();
export const agendaCalendarSubscriptionSchema = z
  .object({
    id: databaseIdSchema,
    url: z.string().url(),
    createdAt: utcInstantSchema,
  })
  .strict();
export const agendaCalendarTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
