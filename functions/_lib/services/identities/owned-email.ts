import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { normalizeEmail } from "../../validation";

/** Resolve one canonical person's selected address; primary uses NULL, aliases require verified ownership. */
export async function resolveOwnedIdentityEmail(
  db: DatabaseLike,
  input: { user: { id: string; email: string }; email: string },
): Promise<{ emailId: string | null; normalizedEmail: string }> {
  const normalizedEmail = normalizeEmail(input.email);
  if (normalizeEmail(input.user.email) === normalizedEmail) return { emailId: null, normalizedEmail };
  const address = await first<{ id: string }>(
    db,
    `SELECT id FROM user_emails
     WHERE user_id = ? AND normalized_email = ? AND verified_at IS NOT NULL`,
    [input.user.id, normalizedEmail],
  );
  if (!address) {
    throw new AppError(
      422,
      "IDENTITY_EMAIL_UNVERIFIED",
      "A selected secondary email must be verified before it can identify an organization identity",
    );
  }
  return { emailId: address.id, normalizedEmail };
}

/** Rechecks the exact selected ID, address text, and owner in the caller's existing mutation batch. */
export function ownedIdentityEmailEvidence(input: {
  userId: string;
  emailId: string | null;
  normalizedEmail: string;
  requireVerifiedPrimary?: boolean;
}): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM users user WHERE user.id = ? AND ${
      input.emailId === null
        ? `user.normalized_email = ?${input.requireVerifiedPrimary ? " AND user.email_verified_at IS NOT NULL" : ""}`
        : `EXISTS (SELECT 1 FROM user_emails address
            WHERE address.id = ? AND address.user_id = user.id
              AND address.normalized_email = ? AND address.verified_at IS NOT NULL)`
    }`,
    bindings: [input.userId, ...(input.emailId === null ? [] : [input.emailId]), input.normalizedEmail],
  };
}
