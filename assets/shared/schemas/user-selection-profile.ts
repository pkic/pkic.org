import { z } from "zod";
import { httpOrSameOriginUrlSchema } from "./urls";

/** Identity fields shared by every bounded person-selection read model. */
export const userSelectionProfileSchema = z.object({
  organization_name: z.string().nullable().default(null),
  job_title: z.string().nullable().default(null),
  headshotUrl: httpOrSameOriginUrlSchema.nullable().default(null),
});
