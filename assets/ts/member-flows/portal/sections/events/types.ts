import type { z } from "zod";
import type { EventDetail as CanonicalEventDetail } from "../../../../../shared/schemas/event-management";
import type {
  EventRegistrationAttendanceChange as CanonicalRegistrationAttendanceChange,
  EventRegistrationSummary as CanonicalRegistration,
} from "../../../../../shared/schemas/event-registrations";
import type { registrationBadgeResponseSchema } from "../../../../../shared/schemas/participant-roles";
import type { ProposalAccess as CanonicalProposalAccess } from "../../../../../shared/schemas/event-proposals";
import type { ProposalSpeaker as CanonicalProposalSpeaker } from "../../../../../shared/schemas/proposal-speakers";
import type { FormFieldDefinition } from "../../../../../shared/schemas/forms";
import type { EventAnalyticsResponse } from "../../../../../shared/schemas/event-analytics";
import type { ProposalReview as CanonicalProposalReview } from "../../../../../shared/schemas/proposal-reviews";

export type EventDetail = CanonicalEventDetail;
export type FormDetailField = FormFieldDefinition;
export type RegistrationAttendanceChange = CanonicalRegistrationAttendanceChange;
export type Registration = CanonicalRegistration;
export type BadgeRoleInfo = z.infer<typeof registrationBadgeResponseSchema>;
export type ProposalReview = CanonicalProposalReview;
export type ProposalSpeaker = CanonicalProposalSpeaker;
export type ProposalAccess = CanonicalProposalAccess;
export type EventStatsResponse = EventAnalyticsResponse;
