import { z } from "zod";

export const eventPresentationArchiveQuerySchema = z.object({
  versions: z.literal("all").optional(),
});
