import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { proposalStatusSchema } from "./proposal-status";
import {
  adminSpeakerBioPatchSchema,
  MAX_PROPOSAL_PARTICIPANTS,
  proposalSpeakerProfileSchema,
} from "./proposal-management";
import {
  eventProposalDetailResponseSchema,
  eventProposalDetailSchema,
  eventProposalSummarySchema,
  eventProposalsResponseSchema,
  proposalAccessSchema,
  proposalStatsSchema,
  type EventProposalDetailResponse,
  type EventProposalSummary,
  type EventProposalsResponse,
  type ProposalAccess,
  type ProposalStats,
} from "./event-proposals";
import {
  proposalDecisionPreviewMessageSchema,
  proposalDecisionPreviewResponseSchema,
  type ProposalDecisionPreviewResponse,
} from "./proposal-decisions";

/** @deprecated Use the neutral event-proposal contracts. */
export {
  eventProposalDetailResponseSchema as adminProposalDetailResponseSchema,
  eventProposalDetailSchema as adminProposalDetailSchema,
  eventProposalSummarySchema as adminEventProposalSummarySchema,
  eventProposalsResponseSchema as adminEventProposalsResponseSchema,
  proposalAccessSchema,
  proposalStatsSchema,
};
/** @deprecated Use the neutral event-proposal contract types. */
export type {
  EventProposalDetailResponse as AdminProposalDetailResponse,
  EventProposalSummary as AdminEventProposalSummary,
  EventProposalsResponse as AdminEventProposalsResponse,
  ProposalAccess,
  ProposalStats,
};

export const adminProposalSpeakerSchema = proposalSpeakerProfileSchema.extend({
  confirmedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  declineReason: z.string().nullable(),
  termsAcceptedAt: z.string().nullable(),
  addedAt: z.string(),
  biography: z.string().nullable(),
  profileComplete: z.boolean(),
  hasHeadshot: z.boolean(),
  hasBio: z.boolean(),
});

export const adminProposalSpeakersResponseSchema = z.object({
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
  speakers: z.array(adminProposalSpeakerSchema).max(MAX_PROPOSAL_PARTICIPANTS),
});

export const adminProposalSpeakerPatchResponseSchema = successResponseSchema.extend({
  speaker: adminProposalSpeakerSchema,
});
export const adminProposalSpeakerReminderResponseSchema = successResponseSchema;
export const adminProposalSpeakerRemindersResponseSchema = successResponseSchema.extend({
  queued: z.number().int().nonnegative(),
});

export type AdminProposalSpeakerPatch = z.infer<typeof adminSpeakerBioPatchSchema>;
export type AdminProposalSpeaker = z.infer<typeof adminProposalSpeakerSchema>;
export type AdminProposalSpeakersResponse = z.infer<typeof adminProposalSpeakersResponseSchema>;
export type AdminProposalSpeakerPatchResponse = z.infer<typeof adminProposalSpeakerPatchResponseSchema>;

export { proposalSessionTypeSchema } from "./proposal-management";

export const proposalReminderResponseSchema = z.object({ queued: z.number() });
/** @deprecated Use the neutral proposal-decision preview contracts. */
export { proposalDecisionPreviewMessageSchema, proposalDecisionPreviewResponseSchema };
/** @deprecated Use the neutral proposal-decision preview contract type. */
export type { ProposalDecisionPreviewResponse };
