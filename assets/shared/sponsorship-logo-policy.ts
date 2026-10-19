/** Logo display never extends sponsorship authority or attendee-data access. */
export const SPONSOR_LOGO_GRACE_DAYS = 90;
export const SPONSOR_LOGO_GRACE_TIERS = ["Silver", "Gold", "Platinum", "Titanium", "Diamond"] as const;
export const SPONSORSHIP_END_REASONS = ["ordinary_expiry", "withdrawal", "termination", "refund", "dispute"] as const;
export type SponsorshipEndReason = (typeof SPONSORSHIP_END_REASONS)[number];
export const SPONSORSHIP_END_REASON_LABELS: Record<SponsorshipEndReason, string> = {
  ordinary_expiry: "Ordinary expiry",
  withdrawal: "Withdrawal",
  termination: "Termination",
  refund: "Refund",
  dispute: "Dispute",
};
