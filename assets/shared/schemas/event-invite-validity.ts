import { z } from "zod";

/** Absolute invitation deadline; omission means the event start. */
export const eventInviteValiditySchema = z.object({
  expiresAt: z.iso.datetime().optional(),
});

/** Minimal event schedule projection required by every invitation editor. */
export const eventInviteWindowSchema = z.object({
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  timezone: z.string(),
});
export type EventInviteWindow = z.infer<typeof eventInviteWindowSchema>;
