import { z } from "zod";

/** Public identity + optional organization attribution reused by leadership views. */
export const publicOrganizationPersonSchema = z.object({
  name: z.string(),
  organizationName: z.string().nullable(),
  organizationLogoUrl: z.string().nullable(),
  organizationWebsite: z.string().nullable(),
  photoUrl: z.string().nullable(),
  linkedin: z.string().nullable(),
});

export type PublicOrganizationPerson = z.infer<typeof publicOrganizationPersonSchema>;
