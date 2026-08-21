import { z } from "zod";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";

/** Public identity + optional organization attribution reused by leadership views. */
export const publicOrganizationPersonSchema = z.object({
  name: z.string(),
  organizationName: z.string().nullable(),
  organizationLogoUrl: httpOrSameOriginUrlSchema.nullable(),
  organizationWebsite: httpUrlSchema.nullable(),
  photoUrl: httpOrSameOriginUrlSchema.nullable(),
  linkedin: httpUrlSchema.nullable(),
});

export type PublicOrganizationPerson = z.infer<typeof publicOrganizationPersonSchema>;
