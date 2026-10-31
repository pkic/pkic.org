import { z } from "zod";
import { proposalStatusSchema } from "./proposal-status";
import { proposalAccessSpeakerStatusSchema } from "./proposal-management";
import { databaseIdSchema } from "./identifiers";
import { registrationLifecycleStatusSchema } from "./registration";
import { sameOriginPathSchema } from "./urls";
import { utcInstantSchema } from "./api-common";

export const eventParticipationSchema = z.object({
  registrationId: databaseIdSchema.nullable(),
  registrationStatus: registrationLifecycleStatusSchema.nullable(),
  promotion: z.object({ sharePath: sameOriginPathSchema, badgeVersion: utcInstantSchema }).nullable().optional(),
  proposalStates: z.array(proposalStatusSchema).default([]),
  speakerStates: z.array(proposalAccessSpeakerStatusSchema).default([]),
  proposals: z.number().int().nonnegative(),
  speakerProposals: z.number().int().nonnegative(),
});
export type EventParticipation = z.infer<typeof eventParticipationSchema>;
