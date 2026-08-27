import { z } from "zod";

/** Absolute invitation deadline; omission means the event start. */
export const eventInviteValiditySchema = z.object({
  expiresAt: z.iso.datetime().optional(),
});
