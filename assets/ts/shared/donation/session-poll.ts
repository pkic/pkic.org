import type { z } from "zod";
import {
  donationSessionCompletedResponseSchema,
  donationSessionPollResponseSchema,
  donationSessionPendingResponseSchema,
  donationSessionFailedResponseSchema,
  donationSessionExpiredResponseSchema,
} from "../../../shared/schemas/donation";

export type DonationSession = z.infer<typeof donationSessionCompletedResponseSchema>;
export type PendingDonationSession = z.infer<typeof donationSessionPendingResponseSchema>;
export type TerminalDonationSession =
  z.infer<typeof donationSessionFailedResponseSchema> | z.infer<typeof donationSessionExpiredResponseSchema>;
export type DonationSessionResponse = z.infer<typeof donationSessionPollResponseSchema>;

export type DonationPollResult =
  { state: "pending" } | { state: "failed" } | { state: "expired" } | { state: "confirmed"; session: DonationSession };

export function classifyDonationPollResult(data: DonationSessionResponse): DonationPollResult {
  if ("failed" in data) return { state: "failed" };
  if ("expired" in data) return { state: "expired" };
  if ("grossAmount" in data) return { state: "confirmed", session: data };
  return { state: "pending" };
}
