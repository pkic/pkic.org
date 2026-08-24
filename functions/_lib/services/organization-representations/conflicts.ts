const REPRESENTATION_PAIR_UNIQUE_ERROR =
  "UNIQUE constraint failed: organization_representatives.member_id, organization_representatives.user_id";

export function isConcurrentRepresentationConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes(REPRESENTATION_PAIR_UNIQUE_ERROR);
}
