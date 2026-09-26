import { z } from "zod";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";

/** Public identity + optional organization attribution reused by leadership views. */
export const publicOrganizationPersonSchema = z.object({
  name: z.string(),
  jobTitle: z.string().nullable(),
  organizationName: z.string().nullable(),
  organizationLogoUrl: httpOrSameOriginUrlSchema.nullable(),
  organizationWebsite: httpUrlSchema.nullable(),
  photoUrl: httpOrSameOriginUrlSchema.nullable(),
  // The person's owner-ordered featured profile link (links[0]), any platform.
  featuredLink: httpUrlSchema.nullable(),
});

export type PublicOrganizationPerson = z.infer<typeof publicOrganizationPersonSchema>;
