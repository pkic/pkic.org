import { z } from "zod";
import { proposalStatusSchema } from "./proposal-status";
import { proposalAccessSpeakerStatusSchema } from "./proposal-management";
import { databaseIdSchema } from "./identifiers";
import { registrationLifecycleStatusSchema } from "./registration";
import { sameOriginPathSchema } from "./urls";
import { utcInstantSchema } from "./api-common";

export const eventRegistrationAccessSchema = z.enum(["invitation", "group"]);
export type EventRegistrationAccess = z.infer<typeof eventRegistrationAccessSchema>;

export const eventParticipationSchema = z.object({
  registrationId: databaseIdSchema.nullable(),
  registrationStatus: registrationLifecycleStatusSchema.nullable(),
  calendarAvailable: z.boolean().default(false),
  promotion: z.object({ sharePath: sameOriginPathSchema, badgeVersion: utcInstantSchema }).nullable().optional(),
  proposalStates: z.array(proposalStatusSchema).default([]),
  speakerStates: z.array(proposalAccessSpeakerStatusSchema).default([]),
  proposals: z.number().int().nonnegative(),
  speakerProposals: z.number().int().nonnegative(),
  speakerSessions: z.number().int().nonnegative().default(0),
  /** Access that admits the viewer where registration is not open: a held invitation or group register access. */
  registrationAccess: eventRegistrationAccessSchema.nullable().optional(),
  /** The viewer's open attendee invitation, which the portal answers without the emailed link. */
  invitation: z
    .object({ id: databaseIdSchema, remindersPausedUntil: utcInstantSchema.nullable() })
    .nullable()
    .optional(),
});
export type EventParticipation = z.infer<typeof eventParticipationSchema>;
