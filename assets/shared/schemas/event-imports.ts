import {
  frontendPathPattern,
  slugPattern,
  successResponseSchema,
  termKeyPattern,
  trimmedString,
  utcInstantSchema,
  versionPattern,
} from "./api-common";
import { z } from "zod";
import {
  attendeeInviteLimitSchema,
  eventCustomSettingsSchema,
  eventManagementDetailResponseSchema,
} from "./event-management";
import { eventVisibilitySchema, timeZoneSchema } from "./event-series";

/**
 * Systems allowed to import an event definition. The source is part of the
 * request contract rather than the route, so adding a second generator does
 * not add a second endpoint, and the import command can bind each event to the
 * source that owns it.
 */
export const EVENT_IMPORT_SOURCES = ["hugo"] as const;
export const eventImportSourceSchema = z.enum(EVENT_IMPORT_SOURCES);
export type EventImportSource = z.infer<typeof eventImportSourceSchema>;

const importedTermSchema = z.object({
  termKey: z.string().trim().regex(termKeyPattern),
  version: z.string().trim().regex(versionPattern),
  required: z.boolean().optional(),
  contentRef: trimmedString(1, 500).optional(),
  displayText: trimmedString(3, 4000).optional(),
});

const importedFrontendRoutesSchema = z.object({
  registration: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  registrationConfirm: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  proposal: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  registrationManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  proposalManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  speakerManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
});

const importedEventSchema = z
  .object({
    slug: z.string().trim().regex(slugPattern),
    name: trimmedString(3, 180),
    timezone: timeZoneSchema,
    startsAt: utcInstantSchema.optional(),
    endsAt: utcInstantSchema.optional(),
    registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).optional(),
    // Importers must make publication an explicit decision. An omitted field
    // must never turn a newly imported event into a public resource.
    visibility: eventVisibilitySchema,
    inviteLimitAttendee: attendeeInviteLimitSchema.optional(),
    frontend: z.object({ routes: importedFrontendRoutesSchema }).optional(),
    settings: eventCustomSettingsSchema.optional(),
  })
  .refine((event) => !event.startsAt || !event.endsAt || event.endsAt > event.startsAt, {
    path: ["endsAt"],
    message: "Event end must be after its start",
  });

export const eventImportSchema = z.object({
  source: eventImportSourceSchema,
  event: importedEventSchema,
  terms: z
    .object({
      attendee: z.array(importedTermSchema).max(40).default([]),
      speaker: z.array(importedTermSchema).max(40).default([]),
    })
    .optional(),
});
export type EventImportInput = z.infer<typeof eventImportSchema>;

/**
 * Imports return the same canonical management detail as every other event
 * management read, so importers and the portal share one event representation.
 * `created` distinguishes a first import from an update of an existing event.
 */
export const eventImportResponseSchema = eventManagementDetailResponseSchema.extend({
  success: successResponseSchema.shape.success,
  source: eventImportSourceSchema,
  created: z.boolean(),
});
export type EventImportResult = z.infer<typeof eventImportResponseSchema>;
