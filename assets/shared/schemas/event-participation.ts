import { z } from "zod";
import { proposalStatusSchema } from "./proposal-status";
import { proposalAccessSpeakerStatusSchema } from "./proposal-management";
import { databaseIdSchema } from "./identifiers";
import { registrationLifecycleStatusSchema } from "./registration";

export const eventParticipationSchema = z.object({
  registrationId: databaseIdSchema.nullable(),
  registrationStatus: registrationLifecycleStatusSchema.nullable(),
  proposalStates: z.array(proposalStatusSchema).default([]),
  speakerStates: z.array(proposalAccessSpeakerStatusSchema).default([]),
  proposals: z.number().int().nonnegative(),
  speakerProposals: z.number().int().nonnegative(),
});
export type EventParticipation = z.infer<typeof eventParticipationSchema>;
