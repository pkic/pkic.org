/**
 * Barrel re-exporting the full public surface of the admin-organizations
 * system, split across queries.ts (read model)/profile.ts (profile-update
 * use case)/representatives.ts (representative/member provisioning) —
 * mirrors the sponsorship/index.ts split. Every route file imports from
 * "../../_lib/services/admin-organizations" (this directory) exactly as it
 * did when admin-organizations.ts was one file — no call-site changes
 * required.
 */
export * from "./queries";
export * from "./profile";
export * from "./representatives";
