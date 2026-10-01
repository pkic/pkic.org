import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
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
  .pick({ firstName: true, lastName: true, organizationName: true, status: true })
  .extend({
    id: databaseIdSchema,
    proposalId: databaseIdSchema,
    proposalTitle: z.string(),
    registrationStatus: registrationLifecycleStatusSchema.nullable(),
    attendanceType: attendanceTypeSchema.nullable(),
    days: z.array(registrationDayStateSchema),
  });
export type EventProposalSpeaker = z.infer<typeof eventProposalSpeakerSchema>;

export const eventSpeakersResponseSchema = paginatedResponseSchema("speakers", eventProposalSpeakerSchema);
