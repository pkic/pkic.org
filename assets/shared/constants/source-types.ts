/** Allowed values for the sourceType field. Shared between frontend and backend. */
export const SOURCE_TYPES = ["direct", "invite", "referral", "social", "partner", "campaign", "unknown"] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];
