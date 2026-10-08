import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const sponsorLeadQuerySchema = listQuerySchema(["name", "email", "organization", "capturedAt"] as const, {
  maxLimit: 100,
});
export const sponsorLeadSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  name: z.string(),
  email: z.string(),
  organization: z.string().nullable(),
  capturedAt: utcInstantSchema,
  operatorUserId: databaseIdSchema,
  operatorName: z.string(),
});
export const sponsorLeadListSchema = paginatedResponseSchema("leads", sponsorLeadSchema);
export const sponsorLeadSponsorsQuerySchema = listQuerySchema(["name"] as const, { maxLimit: 100 });
export const sponsorLeadSponsorSchema = z.object({
  id: databaseIdSchema,
  name: z.string(),
  canView: z.boolean(),
  canCapture: z.boolean(),
  canExport: z.boolean(),
});
export const sponsorLeadSponsorsSchema = paginatedResponseSchema("sponsors", sponsorLeadSponsorSchema);
export type SponsorLeadQuery = z.infer<typeof sponsorLeadQuerySchema>;
export type SponsorLead = z.infer<typeof sponsorLeadSchema>;
export type SponsorLeadSponsor = z.infer<typeof sponsorLeadSponsorSchema>;
export type SponsorLeadSponsorsQuery = z.infer<typeof sponsorLeadSponsorsQuerySchema>;
/** Successful lead captures are provenance, never session attendance. */
export const sponsorLeadCapturesQuerySchema = listQuerySchema(["observedAt", "receivedAt"] as const, { maxLimit: 100 });
export const sponsorLeadCaptureSchema = z.object({
  id: databaseIdSchema,
  operatorUserId: databaseIdSchema,
  operatorName: z.string(),
  observedAt: utcInstantSchema,
  receivedAt: utcInstantSchema,
});
export const sponsorLeadCapturesSchema = paginatedResponseSchema("captures", sponsorLeadCaptureSchema);
export type SponsorLeadCapture = z.infer<typeof sponsorLeadCaptureSchema>;
export type SponsorLeadCapturesQuery = z.infer<typeof sponsorLeadCapturesQuerySchema>;
