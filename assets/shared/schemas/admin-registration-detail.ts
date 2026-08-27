/** @deprecated Use the domain-neutral event-registration-detail contracts. */
export {
  eventRegistrationDetailSchema as adminRegistrationDetailSchema,
  eventRegistrationDayAttendanceSchema as adminRegistrationDayAttendanceSchema,
  eventRegistrationDayWaitlistSchema as adminRegistrationDayWaitlistSchema,
  eventRegistrationDetailResponseSchema as adminRegistrationDetailResponseSchema,
  eventRegistrationRsvpDaySchema as adminRegistrationRsvpDaySchema,
} from "./event-registration-detail";

/** @deprecated Use the domain-neutral event-registration-detail response type. */
export type { EventRegistrationDetailResponse as AdminRegistrationDetailResponse } from "./event-registration-detail";

/** @deprecated Use registrationRecordContextSchema directly. */
export { registrationRecordContextSchema as adminRegistrationRecordContextSchema } from "./registration-record";
