import { z } from "zod";
import {
  proposalSpeakerPatchResponseSchema,
  proposalSpeakerReminderResponseSchema,
  proposalSpeakerRemindersResponseSchema,
  proposalSpeakerSchema,
  proposalSpeakersResponseSchema,
  type ProposalSpeaker,
  type ProposalSpeakerPatch,
  type ProposalSpeakerPatchResponse,
  type ProposalSpeakersResponse,
} from "./proposal-speakers";
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

export {
  proposalSpeakerPatchResponseSchema,
  proposalSpeakerReminderResponseSchema,
  proposalSpeakerRemindersResponseSchema,
  proposalSpeakerSchema,
  proposalSpeakersResponseSchema,
};
export type { ProposalSpeaker, ProposalSpeakerPatch, ProposalSpeakerPatchResponse, ProposalSpeakersResponse };

/** @deprecated Use the neutral proposal speaker contracts. */
export const adminProposalSpeakerSchema = proposalSpeakerSchema;
/** @deprecated Use the neutral proposal speaker contracts. */
export const adminProposalSpeakersResponseSchema = proposalSpeakersResponseSchema;
/** @deprecated Use the neutral proposal speaker contracts. */
export const adminProposalSpeakerPatchResponseSchema = proposalSpeakerPatchResponseSchema;
/** @deprecated Use the neutral proposal speaker contracts. */
export const adminProposalSpeakerReminderResponseSchema = proposalSpeakerReminderResponseSchema;
/** @deprecated Use the neutral proposal speaker contracts. */
export const adminProposalSpeakerRemindersResponseSchema = proposalSpeakerRemindersResponseSchema;
/** @deprecated Use the neutral proposal speaker contracts. */
export type AdminProposalSpeakerPatch = ProposalSpeakerPatch;
/** @deprecated Use the neutral proposal speaker contracts. */
export type AdminProposalSpeaker = ProposalSpeaker;
/** @deprecated Use the neutral proposal speaker contracts. */
export type AdminProposalSpeakersResponse = ProposalSpeakersResponse;
/** @deprecated Use the neutral proposal speaker contracts. */
export type AdminProposalSpeakerPatchResponse = ProposalSpeakerPatchResponse;

export { proposalSessionTypeSchema } from "./proposal-management";

export const proposalReminderResponseSchema = z.object({ queued: z.number() });
/** @deprecated Use the neutral proposal-decision preview contracts. */
export { proposalDecisionPreviewMessageSchema, proposalDecisionPreviewResponseSchema };
/** @deprecated Use the neutral proposal-decision preview contract type. */
export type { ProposalDecisionPreviewResponse };
