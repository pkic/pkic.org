import { z } from "zod";
import { databaseIdSchema } from "./identifiers";

export const eventPresentationArchiveQuerySchema = z.object({
  versions: z.literal("all").optional(),
  proposalIds: z
    .string()
    .max(3700)
    .optional()
    .transform((value) => value?.split(","))
    .pipe(z.array(databaseIdSchema).min(1).max(100).optional()),
});
