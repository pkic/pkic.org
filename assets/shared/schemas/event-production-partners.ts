/**
 * An event's production partners: organizations that help produce the event and are credited with what they
 * provide, such as "Camera Technology Provider". A partner is never a sponsor: it has no tier and takes no
 * place among the sponsors. Its name, website and logo are the organization's own, read when shown.
 */
import { z } from "zod";
import { trimmedString } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { httpUrlSchema, sameOriginPathSchema } from "./urls";

export const EVENT_PRODUCTION_PARTNERS_MAX = 12;

/** What the event stores: what the organization provides, as the event credits it, and which organization. */
export const eventProductionPartnerSchema = z.object({
  role: trimmedString(2, 80, "Say what this partner provides."),
  organizationId: databaseIdSchema,
});
export type EventProductionPartner = z.infer<typeof eventProductionPartnerSchema>;

export const eventProductionPartnersSchema = z
  .array(eventProductionPartnerSchema)
  .max(EVENT_PRODUCTION_PARTNERS_MAX)
  .refine(
    (partners) => new Set(partners.map((partner) => partner.organizationId)).size === partners.length,
    "List each organization once.",
  );

/** A partner as shown: its role with the organization's current name, website and logo. */
export const eventProductionPartnerCreditSchema = eventProductionPartnerSchema.extend({
  name: z.string(),
  website: httpUrlSchema.nullable(),
  logoUrl: sameOriginPathSchema.nullable(),
});
export type EventProductionPartnerCredit = z.infer<typeof eventProductionPartnerCreditSchema>;

export const eventProductionPartnerCreditsSchema = z
  .array(eventProductionPartnerCreditSchema)
  .max(EVENT_PRODUCTION_PARTNERS_MAX);
