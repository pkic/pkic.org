import { z } from "zod";

export const PROPOSAL_SPEAKER_ROLES = ["proposer", "speaker", "co_speaker", "moderator", "panelist"] as const;
export const proposalSpeakerRoleSchema = z.enum(PROPOSAL_SPEAKER_ROLES);
export type ProposalSpeakerRole = z.infer<typeof proposalSpeakerRoleSchema>;

/** Persisted/effective event roles. Proposal-only roles map onto this vocabulary. */
export const EVENT_PARTICIPANT_ROLES = ["attendee", "speaker", "moderator", "panelist", "organizer", "staff"] as const;

export const eventParticipantRoleSchema = z.enum(EVENT_PARTICIPANT_ROLES);
export type EventParticipantRole = z.infer<typeof eventParticipantRoleSchema>;

export const REGISTRATION_BADGE_ROLES = EVENT_PARTICIPANT_ROLES;
export const registrationBadgeRoleSchema = z.enum(REGISTRATION_BADGE_ROLES);
export type RegistrationBadgeRole = z.infer<typeof registrationBadgeRoleSchema>;

/** Proposal referral badges may describe proposal ownership before acceptance. */
export const SOCIAL_BADGE_ROLES = [...EVENT_PARTICIPANT_ROLES, "proposer", "co_speaker"] as const;
export const socialBadgeRoleSchema = z.enum(SOCIAL_BADGE_ROLES);
export type SocialBadgeRole = z.infer<typeof socialBadgeRoleSchema>;

export const registrationBadgePatchSchema = z.object({ role: registrationBadgeRoleSchema.nullable() });
export type RegistrationBadgePatch = z.infer<typeof registrationBadgePatchSchema>;

export const registrationBadgeResponseSchema = z.object({
  success: z.boolean().optional(),
  admin_override: registrationBadgeRoleSchema.nullable(),
  auto_detected: registrationBadgeRoleSchema,
  effective_role: registrationBadgeRoleSchema,
  available_roles: z.array(registrationBadgeRoleSchema),
});
