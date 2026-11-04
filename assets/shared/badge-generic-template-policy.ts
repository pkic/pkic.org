import { z } from "zod";
import { badgeTemplateCustomTextSchema, eventBadgeTemplateSchema } from "./schemas/event-badge-template";
import { eventResourceCoreSchema } from "./schemas/event-management";
import { utcInstantSchema } from "./schemas/api-common";
import { timeZoneSchema } from "./schemas/event-series";

export const GENERIC_BADGE_LAYOUT_VERSION = "pqc-without-cityscape-v3";
export const genericBadgeTemplateInputSchema = z
  .object({
    eventName: eventResourceCoreSchema.shape.name,
    customTextOverlay: badgeTemplateCustomTextSchema.optional(),
    sponsorGroups: eventBadgeTemplateSchema.shape.sponsorGroups,
    startsAt: utcInstantSchema.nullable().optional(),
    endsAt: utcInstantSchema.nullable().optional(),
    timezone: timeZoneSchema.default("UTC"),
    city: z.string().nullable().optional(),
  })
  .strict();
export type GenericBadgeTemplateInput = z.input<typeof genericBadgeTemplateInputSchema>;
