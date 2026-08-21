import { z } from "zod";

export const PROPOSAL_SPEAKER_ROLES = ["proposer", "speaker", "co_speaker", "moderator", "panelist"] as const;
export const proposalSpeakerRoleSchema = z.enum(PROPOSAL_SPEAKER_ROLES);
export type ProposalSpeakerRole = z.infer<typeof proposalSpeakerRoleSchema>;

export const EVENT_PARTICIPANT_ROLES = ["attendee", ...PROPOSAL_SPEAKER_ROLES, "organizer", "staff"] as const;

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
