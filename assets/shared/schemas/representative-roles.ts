/**
 * The two organization-contact singleton role IDs (primary and secondary
 * contact) — ordinary `roles`/
 * `user_roles` rows (consolidated migration 0035), not a bespoke role table. Kept in a
 * dependency-free shared module (only import is implicit — none) so it can
 * be consumed both by the backend service
 * (functions/_lib/services/membership/representative-roles.ts, the
 * previous sole owner of this vocabulary) and by plain Node tooling like
 * the member importer (scripts/migrate-members/), which cannot resolve
 * Workers-runtime-dependent backend modules.
 */
export const REPRESENTATIVE_ROLE_IDS = {
  primaryContact: "role-primary_contact",
  secondaryContact: "role-secondary_contact",
} as const;

export type RepresentativeRoleId = (typeof REPRESENTATIVE_ROLE_IDS)[keyof typeof REPRESENTATIVE_ROLE_IDS];

const REPRESENTATIVE_ROLE_ID_SET: ReadonlySet<string> = new Set(Object.values(REPRESENTATIVE_ROLE_IDS));

export function isRepresentativeRoleId(roleId: string): roleId is RepresentativeRoleId {
  return REPRESENTATIVE_ROLE_ID_SET.has(roleId);
}
