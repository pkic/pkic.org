import { z } from "zod";

const representedCountSchema = z.object({ count: z.number().int().min(0) });

/** Distinct people and organizations, never counts of seats or profile labels. */
export const representationSchema = z.object({
  people: representedCountSchema,
  organizations: representedCountSchema,
});
export type Representation = z.infer<typeof representationSchema>;
