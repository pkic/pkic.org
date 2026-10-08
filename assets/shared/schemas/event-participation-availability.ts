import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
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
export const participationAvailabilitySchema = z.object({
  attendanceMode: z.enum(["physical", "remote"]),
  roomId: databaseIdSchema.nullable(),
  state: participationAvailabilityStateSchema,
  message: z.string(),
  bookingAction: z.enum(["reserve", "request"]).nullable(),
  canSave: z.boolean(),
});
export type ParticipationAvailability = z.infer<typeof participationAvailabilitySchema>;
