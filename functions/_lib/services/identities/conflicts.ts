const ACTIVE_ORGANIZATION_IDENTITY_UNIQUE_ERROR =
  "UNIQUE constraint failed: identities.user_id, identities.organization_id";
const ACTIVE_INDIVIDUAL_IDENTITY_UNIQUE_ERROR = "UNIQUE constraint failed: identities.user_id";
const MUTUALLY_EXCLUSIVE_IDENTITY_ERROR = "individual and organization identities are mutually exclusive";

export function isConcurrentIdentityConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes(ACTIVE_ORGANIZATION_IDENTITY_UNIQUE_ERROR) ||
      error.message.includes(ACTIVE_INDIVIDUAL_IDENTITY_UNIQUE_ERROR) ||
      error.message.includes(MUTUALLY_EXCLUSIVE_IDENTITY_ERROR))
  );
}
