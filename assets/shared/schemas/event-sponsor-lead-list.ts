import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { formatNumber } from "../format-number";

export const sponsorLeadQuerySchema = listQuerySchema(["name", "email", "organization", "capturedAt"] as const, {
  maxLimit: 100,
});
export const sponsorLeadSchema = z.object({
  id: databaseIdSchema,
  name: z.string(),
  email: z.string(),
  organization: z.string().nullable(),
  title: z.string().nullable(),
  capturedAt: utcInstantSchema,
  operatorName: z.string(),
  sponsorName: z.string().optional(),
  /** The sponsor team's shared note about this lead. */
  note: z.string().nullable(),
});
export const sponsorLeadListSchema = paginatedResponseSchema("leads", sponsorLeadSchema);
export const sponsorLeadDetailSchema = z.object({ lead: sponsorLeadSchema, sponsorName: z.string() });
export const sponsorLeadRemovalResponseSchema = z.object({
  removedCaptures: z.number().int().positive(),
});
export const sponsorLeadSponsorsQuerySchema = listQuerySchema(["name"] as const, { maxLimit: 100 }).extend({
  sponsorId: databaseIdSchema.optional(),
});
export const sponsorLeadSponsorSchema = z.object({
  id: databaseIdSchema,
  name: z.string(),
  canView: z.boolean(),
  canCapture: z.boolean(),
  canExport: z.boolean(),
  canRemoveAll: z.boolean(),
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
  operatorName: z.string(),
  observedAt: utcInstantSchema,
  receivedAt: utcInstantSchema,
});
export const sponsorLeadCapturesSchema = paginatedResponseSchema("captures", sponsorLeadCaptureSchema);
export type SponsorLeadCapture = z.infer<typeof sponsorLeadCaptureSchema>;
export type SponsorLeadCapturesQuery = z.infer<typeof sponsorLeadCapturesQuerySchema>;
/** One operator's already captured badge, resolved online; no search or name inventory. */
export const sponsorLeadConfirmationSchema = z.object({
  leadId: databaseIdSchema,
  name: z.string().nullable(),
  title: z.string().nullable(),
  organization: z.string().nullable(),
  note: z.string().nullable(),
});

export const SPONSOR_LEAD_NOTE_MAX_LENGTH = 1000;
/** Replaces the sponsor team's note about one lead; an empty note removes it. */
export const sponsorLeadNoteRequestSchema = z.object({
  note: z
    .string()
    .trim()
    .max(
      SPONSOR_LEAD_NOTE_MAX_LENGTH,
      `Keep the note to ${formatNumber(SPONSOR_LEAD_NOTE_MAX_LENGTH)} characters or fewer.`,
    ),
});
export const sponsorLeadNoteResponseSchema = z.object({
  note: z.string().nullable(),
  noteUpdatedAt: utcInstantSchema.nullable(),
});
