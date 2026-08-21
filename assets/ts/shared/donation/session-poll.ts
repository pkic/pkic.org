export interface DonationSession {
  grossAmount: number;
  currency: string;
  donorFirstName: string | null;
  source: string | null;
  completedAt: string | null;
}

export interface PendingDonationSession {
  pending: true;
  asyncPayment?: boolean;
  paymentMethodType?: string | null;
  sessionExpiresAt?: number | null;
}

export interface TerminalDonationSession {
  failed?: true;
  expired?: true;
}

export type DonationSessionResponse = DonationSession | PendingDonationSession | TerminalDonationSession;

export type DonationPollResult =
  { state: "pending" } | { state: "failed" } | { state: "expired" } | { state: "confirmed"; session: DonationSession };

export function classifyDonationPollResult(data: DonationSessionResponse): DonationPollResult {
  if ("failed" in data) return { state: "failed" };
  if ("expired" in data) return { state: "expired" };
  if ("grossAmount" in data) return { state: "confirmed", session: data };
  return { state: "pending" };
}
