import { z } from "zod";
export const DEFAULT_AGENDA_SESSION_DURATION_MINUTES = 30;
export const AGENDA_SESSION_DURATION_OPTIONS = [15, 30, 45, 60] as const;
export const agendaDurationMinutesSchema = z.number().int().min(1).max(1440);
export const agendaDurationRulesSchema = z.object({
  defaultMinutes: agendaDurationMinutesSchema.default(DEFAULT_AGENDA_SESSION_DURATION_MINUTES),
  quickMinutes: z
    .array(agendaDurationMinutesSchema)
    .min(1)
    .max(20)
    .refine((values) => new Set(values).size === values.length, "Choose each duration once")
    .default([...AGENDA_SESSION_DURATION_OPTIONS]),
});
export type AgendaDurationRules = z.infer<typeof agendaDurationRulesSchema>;
