import { z } from "zod";

/** Current canonical participation states, separate from capacity occupancy and scan evidence. */
export const sessionDemandCountsSchema = z
  .object({
    confirmed: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    waitlisted: z.number().int().nonnegative(),
    preferences: z.number().int().nonnegative(),
  })
  .strict();
export const sessionDemandSchema = z
  .object({ physical: sessionDemandCountsSchema, remote: sessionDemandCountsSchema })
  .strict();
export type SessionDemand = z.infer<typeof sessionDemandSchema>;

export function emptySessionDemandCounts(): z.infer<typeof sessionDemandCountsSchema> {
  return { confirmed: 0, pending: 0, waitlisted: 0, preferences: 0 };
}
