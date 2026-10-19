/** Live address holders may have a person page, including a former contributor whose stale page needs removal. */
export const PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL = `FROM users person
  JOIN person_profile_slugs address ON address.user_id=person.id AND address.retired_at IS NULL
  WHERE person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`;
