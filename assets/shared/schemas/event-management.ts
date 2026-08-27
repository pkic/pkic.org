import { z } from "zod";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";
import { proposalSessionTypesSchema } from "./proposal-management";
import { slugPattern, trimmedString } from "./api-common";

/**
 * D1-backed event profile catalog projection. The key remains a validated
 * event-profile identifier, while presentation labels and availability are
 * owned by the catalog rather than duplicated in each client.
 */
export const eventProfileCatalogItemSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: trimmedString(1, 160),
  description: z.string().trim().max(500).nullable(),
  standaloneEligible: z.boolean(),
});
export type EventProfileCatalogItem = z.infer<typeof eventProfileCatalogItemSchema>;
export const eventProfileCatalogResponseSchema = z.object({
  profiles: z.array(eventProfileCatalogItemSchema).max(100),
});

/**
 * Settings that are stored in dedicated event columns or in the canonical
 * event settings JSON. Custom settings may not shadow them.
 */
export const EVENT_MANAGED_SETTING_KEYS = [
  "forms",
  "heroImageUrl",
  "location",
  "proposal",
  "venue",
  "virtualUrl",
] as const;

const eventManagedSettingKeySet = new Set<string>(EVENT_MANAGED_SETTING_KEYS);
const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

export function isEventCustomSettingKey(key: string): boolean {
  return !eventManagedSettingKeySet.has(key) && !unsafeObjectKeys.has(key);
}

export const eventCustomSettingsSchema = z
  .record(z.string().trim().min(1).max(80), z.unknown())
  .refine((settings) => Object.keys(settings).length <= 100, "At most 100 custom settings are allowed")
  .superRefine((settings, ctx) => {
    for (const key of Object.keys(settings)) {
      if (!isEventCustomSettingKey(key)) {
        ctx.addIssue({ code: "custom", path: [key], message: `'${key}' is managed by a dedicated event setting` });
      }
    }
  });

/** Zero disables attendee peer invitations; positive values bound each registered participant. */
export const attendeeInviteLimitSchema = z.number().int().min(0).max(50);

/**
 * Shared event configuration. Individual route families compose this base
 * with their own policy dialect rather than duplicating the common fields.
 */
export const eventSettingsSchema = z.object({
  name: trimmedString(3, 180).optional(),
  timezone: trimmedString(2, 64).optional(),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  venue: trimmedString(2, 500).nullable().optional(),
  virtualUrl: httpUrlSchema.nullable().optional(),
  heroImageUrl: httpOrSameOriginUrlSchema.nullable().optional(),
  location: trimmedString(2, 200).nullable().optional(),
  sessionTypes: proposalSessionTypesSchema.nullable().optional(),
  registrationFormKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/)
    .nullable()
    .optional(),
  proposalFormKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/)
    .nullable()
    .optional(),
  registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).optional(),
  inviteLimitAttendee: attendeeInviteLimitSchema.optional(),
  settings: eventCustomSettingsSchema.optional(),
  userRetentionDays: z.number().int().positive().max(3650).optional(),
});
export type EventSettingsInput = z.infer<typeof eventSettingsSchema>;

/** Shared initial event identity and scheduling fields. */
export const eventCreateSchema = z.object({
  slug: z.string().trim().regex(slugPattern),
  name: trimmedString(3, 180),
  timezone: trimmedString(2, 64).default("UTC"),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).default("invite_or_open"),
  inviteLimitAttendee: attendeeInviteLimitSchema.default(5),
  venue: trimmedString(2, 500).nullable().optional(),
  virtualUrl: httpUrlSchema.nullable().optional(),
});
export type EventCreateInput = z.infer<typeof eventCreateSchema>;
