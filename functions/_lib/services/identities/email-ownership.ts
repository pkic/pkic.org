import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";

/**
 * A work address belongs to the identity that selects it, while the person
 * keeps owning every address. One address belongs to at most one identity:
 * selecting an address another of the person's identities owns is refused,
 * except that a successor takes over its predecessor's address.
 */
export interface IdentityEmailOwnershipInput {
  userId: string;
  emailId: string | null | undefined;
  /** The identity that selects the address; null while it is still being created. */
  identityId: string | null;
  /** An identity whose ownership may pass to this one (a successor's predecessor). */
  transferFromIdentityId?: string | null;
  /** An explicitly corrected selection to release; unrelated aliases stay associated. */
  previousEmailId?: string | null;
}

export async function requireIdentityEmailAssignable(
  db: DatabaseLike,
  input: IdentityEmailOwnershipInput,
  observed?: { identity_id: string | null } | null,
): Promise<void> {
  if (!input.emailId) return;
  const address =
    observed === undefined
      ? await first<{ identity_id: string | null }>(
          db,
          "SELECT identity_id FROM user_emails WHERE id = ? AND user_id = ?",
          [input.emailId, input.userId],
        )
      : observed;
  // An unknown or foreign address is refused by the identities email trigger.
  if (!address?.identity_id) return;
  if (address.identity_id === input.identityId || address.identity_id === input.transferFromIdentityId) return;
  throw new AppError(
    409,
    "IDENTITY_EMAIL_OWNED_BY_OTHER_IDENTITY",
    "This email address already belongs to another identity of this person. Choose a different address.",
  );
}

/**
 * Records the selecting identity as the address's owner. Place these after
 * the identity write and any `changes()`-guarded audit row that follows it;
 * the trailing guard fails the batch when another identity took the address
 * after the pre-read.
 */
export function prepareIdentityEmailOwnershipStatements(
  db: DatabaseLike,
  input: IdentityEmailOwnershipInput & { identityId: string },
): StatementLike[] {
  if (input.emailId === undefined) return [];
  const release =
    input.previousEmailId && input.previousEmailId !== input.emailId
      ? [
          db
            .prepare("UPDATE user_emails SET identity_id=NULL WHERE id=? AND user_id=? AND identity_id=?")
            .bind(input.previousEmailId, input.userId, input.identityId),
        ]
      : [];
  if (input.emailId === null) return release;
  return [
    ...release,
    db
      .prepare(
        `UPDATE user_emails SET identity_id = ?
          WHERE id = ? AND user_id = ? AND (identity_id IS NULL OR identity_id IS ?)`,
      )
      .bind(input.identityId, input.emailId, input.userId, input.transferFromIdentityId ?? null),
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM user_emails WHERE id = ? AND user_id = ? AND identity_id = ?",
      bindings: [input.emailId, input.userId, input.identityId],
    }),
  ];
}
