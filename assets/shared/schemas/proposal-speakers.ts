import { z } from "zod";
import { successResponseSchema, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  MAX_PROPOSAL_PARTICIPANTS,
  proposalSpeakerPatchSchema,
  proposalSpeakerProfileSchema,
} from "./proposal-management";
import { proposalStatusSchema } from "./proposal-status";
import { attendanceTypeSchema, registrationLifecycleStatusSchema } from "./registration";
import { independentCapacityReviewSchema } from "./independent-capacity";

/** Canonical transport contract for a proposal's bounded speaker roster. */
export const proposalSpeakerSchema = proposalSpeakerProfileSchema.extend({
  confirmedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  declineReason: z.string().nullable(),
  termsAcceptedAt: z.string().nullable(),
  inviteExpiresAt: utcInstantSchema.nullable(),
  addedAt: z.string(),
  biography: z.string().nullable(),
  profileComplete: z.boolean(),
  hasHeadshot: z.boolean(),
  hasBio: z.boolean(),
});

/**
 * The speaker's registration for the proposal's event, so an organizer can
 * open it from the roster instead of searching for it; null while they hold
 * none.
 */
export const proposalSpeakerRegistrationSchema = z.object({
  id: databaseIdSchema,
  status: registrationLifecycleStatusSchema,
  attendanceType: attendanceTypeSchema,
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
  speakers: z
    .array(
      proposalSpeakerSchema.extend({
        /**
         * The identity the speaker speaks as, which their organization, job
         * title, biography and links come from; null when they hold none.
         */
        identityId: databaseIdSchema.nullable(),
        registration: proposalSpeakerRegistrationSchema.nullable(),
        /** The current independence disclosure of a speaker taking part as an individual; reviewers only. */
        independentCapacity: independentCapacityReviewSchema.nullable(),
      }),
    )
    .max(MAX_PROPOSAL_PARTICIPANTS),
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
export type ProposalRosterSpeaker = ProposalSpeakersResponse["speakers"][number];
export type ProposalSpeakerPatchResponse = z.infer<typeof proposalSpeakerPatchResponseSchema>;

/** An attributed organizer action; personal consent is never supplied by the organizer. */
export const proposalSpeakerAcceptanceRequestSchema = z.object({}).strict();
export const proposalSpeakerAcceptanceResponseSchema = successResponseSchema;
