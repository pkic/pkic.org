import { first } from "../db/queries";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { findUserEmailOwner } from "./user-emails";
import {
  buildFindOrCreateUserStatement,
  userRecordColumns,
  type FindOrCreateUserPayload,
  type UserRecord,
} from "./users";
import { resolveOwnedIdentityEmail, ownedIdentityEmailEvidence } from "./identities/owned-email";
import { prepareVerifyOwnedEmailStatements } from "./email-verification";
import { uuid } from "../utils/ids";
import type { EventProposalContinuationPayload } from "./event-proposal-proof-capabilities";

/** A reservation is not an authentication identity. Called only after signed mailbox proof. */
export async function resolveProposalProofPerson(
  db: DatabaseLike,
  email: string,
  expectedUserId?: string,
): Promise<{ user: UserRecord | null; emailId: string | null } | null> {
  const owner = await findUserEmailOwner(db, email);
  if (
    owner?.kind === "pending" ||
    (owner?.kind === "secondary" && owner.verified !== 1 && owner.userId !== expectedUserId)
  )
    return null;
  if (expectedUserId && owner && owner.userId !== expectedUserId) return null;
  if (!owner && !expectedUserId) return { user: null, emailId: null };
  const user = await first<UserRecord>(
    db,
    `SELECT ${userRecordColumns()} FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL`,
    [expectedUserId ?? owner!.userId],
  );
  if (!user) return null;
  if (!owner) return { user, emailId: uuid() };
  if (owner.kind === "secondary" && owner.verified !== 1) {
    const address = await first<{ id: string }>(
      db,
      "SELECT id FROM user_emails WHERE user_id=? AND normalized_email=?",
      [user.id, email],
    );
    return address ? { user, emailId: address.id } : null;
  }
  const emailSelection = await resolveOwnedIdentityEmail(db, { user, email });
  return { user, emailId: emailSelection.emailId };
}

export async function prepareProposalProofPerson(
  db: DatabaseLike,
  payload: EventProposalContinuationPayload,
  profile: FindOrCreateUserPayload,
  at: string,
): Promise<{
  user: UserRecord;
  created: boolean;
  emailId: string | null;
  statements: StatementLike[];
  authorizationEvidence: AuthorizationEvidence;
}> {
  const resolved = await resolveProposalProofPerson(db, payload.email, payload.context?.userId);
  if (!resolved || (resolved.user?.id ?? null) !== payload.userId)
    throw new AppError(
      409,
      "PROPOSAL_PERSON_CHANGED",
      "The confirmed email's account changed. Confirm your email again.",
    );
  const prepared = resolved.user
    ? { user: resolved.user, created: false, statement: null }
    : await buildFindOrCreateUserStatement(db, { ...profile, email: payload.email });
  // The broad attribution helper cannot choose an account that appeared after safe resolution.
  if (!resolved.user && !prepared.created)
    throw new AppError(
      409,
      "PROPOSAL_PERSON_CHANGED",
      "The confirmed email's account changed. Confirm your email again.",
    );
  const evidence: AuthorizationEvidence = {
    sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
    bindings: [prepared.user.id],
  };
  return {
    user: prepared.user,
    created: prepared.created,
    emailId: resolved.emailId,
    authorizationEvidence: evidence,
    statements: [
      ...(prepared.statement ? [prepared.statement] : []),
      prepareAuthorizationGuard(db, evidence),
      ...(resolved.emailId && !(await findUserEmailOwner(db, payload.email))
        ? [
            db
              .prepare(
                "INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,verification_method,created_at) VALUES (?,?,?,?,?,'magic_link',?)",
              )
              .bind(resolved.emailId, prepared.user.id, payload.email, payload.email, at, at),
          ]
        : []),
      ...prepareVerifyOwnedEmailStatements(db, {
        userId: prepared.user.id,
        normalizedEmail: payload.email,
        method: "magic_link",
        verifiedAt: at,
      }),
      // Verify and recheck only the exact address authorized by this same-person proof.
      prepareAuthorizationGuard(
        db,
        ownedIdentityEmailEvidence({
          userId: prepared.user.id,
          emailId: resolved.emailId,
          normalizedEmail: payload.email,
          requireVerifiedPrimary: true,
        }),
      ),
    ],
  };
}
