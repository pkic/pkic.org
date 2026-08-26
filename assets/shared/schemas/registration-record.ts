import { z } from "zod";

/** Fields shared by all registration list and detail projections. */
export const registrationRecordContextSchema = z.object({
  created_at: z.string(),
  updated_at: z.string(),
  user_email: z.string().nullable(),
  display_name: z.string().nullable(),
  referral_code: z.string().nullable(),
});
