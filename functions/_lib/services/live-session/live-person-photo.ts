/**
 * The stored headshot a live room may show for a person, as SQL over their
 * users row: their profile photo, and none once the account was erased or
 * merged. Pass the result to `publicUserHeadshotPath` for its public address.
 */
export function livePersonHeadshotSql(alias: string): string {
  return `CASE WHEN ${alias}.pii_redacted_at IS NULL AND ${alias}.merged_into_user_id IS NULL THEN ${alias}.headshot_r2_key END`;
}
