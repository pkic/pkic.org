import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { independentCapacityReviewStatusSchema } from "./independent-capacity";
import { listQuerySchema, paginatedResponseSchema, sortColumnSchemaWithDefault } from "./pagination";
import { registrationDayStateSchema } from "./event-registrations";
import { registrationLifecycleStatusSchema, attendanceTypeSchema } from "./registration";
import { proposalSpeakerProfileSchema } from "./proposal-management";

export const EVENT_SPEAKER_SORT_COLUMNS = ["speaker", "proposal", "registration"] as const;
export const eventSpeakerRegistrationFilterSchema = z.enum(["missing", "registered"]);
export const EVENT_SPEAKER_REGISTRATION_FILTER_LABELS: Record<
  z.infer<typeof eventSpeakerRegistrationFilterSchema>,
  string
> = {
  registered: "Registered",
  missing: "Needs registration",
};
export const eventSpeakersListQuerySchema = listQuerySchema(EVENT_SPEAKER_SORT_COLUMNS).extend({
  sort: sortColumnSchemaWithDefault(EVENT_SPEAKER_SORT_COLUMNS, "speaker"),
  registration: eventSpeakerRegistrationFilterSchema.optional(),
});
export type EventSpeakersListQuery = z.infer<typeof eventSpeakersListQuerySchema>;

export const eventProposalSpeakerSchema = proposalSpeakerProfileSchema
  .pick({ email: true, firstName: true, lastName: true, organizationName: true, status: true })
  .extend({
    id: databaseIdSchema,
    proposalId: databaseIdSchema,
    proposalTitle: z.string(),
    /** The speaker's portrait for the roster row, as a same-origin path; null without one. */
    headshotUrl: z.string().nullable(),
    registrationStatus: registrationLifecycleStatusSchema.nullable(),
    attendanceType: attendanceTypeSchema.nullable(),
    days: z.array(registrationDayStateSchema),
    /** Set only for a speaker taking part as an individual: where their independence disclosure stands. */
    independentCapacityStatus: independentCapacityReviewStatusSchema.nullable(),
  });
export type EventProposalSpeaker = z.infer<typeof eventProposalSpeakerSchema>;

export const eventSpeakersResponseSchema = paginatedResponseSchema("speakers", eventProposalSpeakerSchema);
