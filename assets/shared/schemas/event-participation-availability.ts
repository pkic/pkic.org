import { z } from "zod";
export const participationAvailabilityStateSchema = z.enum([
  "available",
  "full",
  "closed",
  "not_open",
  "invitation_required",
  "registration_required",
  "wrong_mode",
  "allocation_conflict",
]);
/** One person's admission for one session, in the attendance mode their event day registration gives them. */
export const participationAvailabilitySchema = z.object({
  attendanceMode: z.enum(["physical", "remote"]).nullable(),
  state: participationAvailabilityStateSchema,
  message: z.string(),
  bookingAction: z.enum(["reserve", "request"]).nullable(),
});
export type ParticipationAvailability = z.infer<typeof participationAvailabilitySchema>;
