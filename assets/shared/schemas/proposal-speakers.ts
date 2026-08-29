import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  MAX_PROPOSAL_PARTICIPANTS,
  proposalSpeakerPatchSchema,
  proposalSpeakerProfileSchema,
} from "./proposal-management";
import { proposalStatusSchema } from "./proposal-status";

/** Canonical transport contract for a proposal's bounded speaker roster. */
export const proposalSpeakerSchema = proposalSpeakerProfileSchema.extend({
  confirmedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  declineReason: z.string().nullable(),
  termsAcceptedAt: z.string().nullable(),
  inviteExpiresAt: z.iso.datetime().nullable(),
  addedAt: z.string(),
  biography: z.string().nullable(),
  profileComplete: z.boolean(),
  hasHeadshot: z.boolean(),
  hasBio: z.boolean(),
});

export const proposalSpeakersResponseSchema = z.object({
  proposal: z.object({
    id: databaseIdSchema,
    title: z.string(),
    status: proposalStatusSchema,
    presentationDeadline: z.string().nullable(),
    presentationUploaded: z.boolean(),
    presentationUploadedAt: z.string().nullable(),
  }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    declined: z.number().int().nonnegative(),
    profileComplete: z.number().int().nonnegative(),
    presentationUploaded: z.number().int().min(0).max(1),
  }),
  speakers: z.array(proposalSpeakerSchema).max(MAX_PROPOSAL_PARTICIPANTS),
});

export const proposalSpeakerPatchResponseSchema = successResponseSchema.extend({
  speaker: proposalSpeakerSchema,
});
export const proposalSpeakerReminderResponseSchema = successResponseSchema;
export const proposalSpeakerRemindersResponseSchema = successResponseSchema.extend({
  queued: z.number().int().nonnegative(),
});
export const proposalSpeakerReminderRequestSchema = z.object({
  kind: z.enum(["profile", "presentation"]),
});

export type ProposalSpeakerPatch = z.infer<typeof proposalSpeakerPatchSchema>;
export type ProposalSpeaker = z.infer<typeof proposalSpeakerSchema>;
export type ProposalSpeakersResponse = z.infer<typeof proposalSpeakersResponseSchema>;
export type ProposalSpeakerPatchResponse = z.infer<typeof proposalSpeakerPatchResponseSchema>;
