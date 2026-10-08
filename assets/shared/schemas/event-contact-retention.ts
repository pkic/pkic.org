import { z } from "zod";
import { utcInstantSchema } from "./api-common";
/** Contact access is independent of the separate raw-evidence retention purpose. */
export const eventContactRetentionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("open"), contactUntil: utcInstantSchema, closedAt: z.null() }).strict(),
  z.object({ state: z.literal("unconfigured"), contactUntil: z.null(), closedAt: z.null() }).strict(),
  z.object({ state: z.literal("closed"), contactUntil: utcInstantSchema, closedAt: utcInstantSchema }).strict(),
]);
export type EventContactRetention = z.infer<typeof eventContactRetentionSchema>;
