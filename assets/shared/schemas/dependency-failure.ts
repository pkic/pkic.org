import { z } from "zod";

export const DEPENDENCY_ERROR_CODE = "DEPENDENCY_UNAVAILABLE";
export const dependencyFailureSchema = z.object({
  capability: z.enum(["data", "files"]),
  reference: z.uuid(),
  outcome: z.literal("unknown"),
});
