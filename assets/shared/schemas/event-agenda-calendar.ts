import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
/** The reminder lead times offered to attendees; the contract still accepts any stored value in range. */
export const agendaReminderMinuteChoices = [5, 10, 15, 30, 60] as const;
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
/**
 * The viewer's live private feed. `subscription` is absent when no link is active, or when the active
 * link was issued before links became recoverable and can only be replaced.
 */
export const agendaCalendarCurrentSubscriptionSchema = z
  .object({
    active: z.boolean(),
    subscription: agendaCalendarSubscriptionSchema.nullable(),
  })
  .strict();
export const agendaCalendarRevokeResponseSchema = z.object({ revoked: z.literal(true) }).strict();
export type AgendaCalendarSettings = z.infer<typeof agendaCalendarSettingsSchema>;
export type AgendaCalendarSubscription = z.infer<typeof agendaCalendarSubscriptionSchema>;
export type AgendaCalendarCurrentSubscription = z.infer<typeof agendaCalendarCurrentSubscriptionSchema>;
