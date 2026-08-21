import { z } from "zod";

export const EVENT_PARTICIPANT_ROLES = [
  "attendee",
  "speaker",
  "co_speaker",
  "moderator",
  "panelist",
  "organizer",
  "staff",
  "proposer",
] as const;

export const eventParticipantRoleSchema = z.enum(EVENT_PARTICIPANT_ROLES);
export type EventParticipantRole = z.infer<typeof eventParticipantRoleSchema>;

export const ADMIN_BADGE_ROLES = ["attendee", "speaker", "moderator", "panelist", "organizer", "staff"] as const;
export const adminBadgeRoleSchema = z.enum(ADMIN_BADGE_ROLES);
export type AdminBadgeRole = z.infer<typeof adminBadgeRoleSchema>;

export const adminBadgeRolePatchSchema = z.object({ role: adminBadgeRoleSchema.nullable() });
export type AdminBadgeRolePatch = z.infer<typeof adminBadgeRolePatchSchema>;

export const adminBadgeRoleResponseSchema = z.object({
  success: z.boolean().optional(),
  admin_override: adminBadgeRoleSchema.nullable(),
  auto_detected: adminBadgeRoleSchema,
  effective_role: adminBadgeRoleSchema,
  available_roles: z.array(adminBadgeRoleSchema).optional(),
});
