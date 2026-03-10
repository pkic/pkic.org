// Source of truth: shared/constants/source-types.ts
// This file exists so TypeScript and Vitest can resolve "./constants/source-types"
// from assets/ts/shared/ via the real filesystem. Hugo resolves the same import
// through its virtual-FS mount (shared/constants → assets/ts/shared/constants).
// Keep this in sync with shared/constants/source-types.ts.
/** Allowed values for the sourceType field. Shared between frontend and backend. */
export const SOURCE_TYPES = ["direct", "invite", "referral", "social", "partner", "campaign", "unknown"] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];
