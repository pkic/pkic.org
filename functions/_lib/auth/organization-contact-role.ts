/** Active holder of a canonical organization contact role; aliases stay explicit for joined queries. */
export function organizationContactRoleActivePredicate(
  roleAlias = "ur",
  userAlias = "u",
  identityAlias = "identity",
  nowExpression = "?",
): string {
  return `${roleAlias}.revoked_at IS NULL
       AND ${userAlias}.active = 1
       AND ${identityAlias}.started_at IS NOT NULL
       AND ${identityAlias}.ended_at IS NULL
       AND ${identityAlias}.blocked_at IS NULL
       AND (${roleAlias}.expires_at IS NULL OR datetime(${roleAlias}.expires_at) > datetime(${nowExpression}))`;
}
