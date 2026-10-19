import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
export const offlineAdmissionRightSchema = z
  .object({
    grantId: databaseIdSchema,
    activationId: databaseIdSchema,
    slot: z.number().int().nonnegative().optional(),
  })
  .strict();
