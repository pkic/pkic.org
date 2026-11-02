import { readEmailOwnership, provedMailboxUserId, prepareEmailOwnershipClaim } from "./email-ownership";
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
  const ownership = await readEmailOwnership(db, email);
  const canonicalUserId = provedMailboxUserId(ownership);
  if (expectedUserId && canonicalUserId && canonicalUserId !== expectedUserId) return null;
  if (!canonicalUserId && !expectedUserId) return { user: null, emailId: null };
  const owner = canonicalUserId ? await findUserEmailOwner(db, email) : null;
  const user = await first<UserRecord>(
    db,
    `SELECT ${userRecordColumns()} FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL`,
    [expectedUserId ?? canonicalUserId!],
  );
  if (!user) return null;
  if (ownership?.userId === user.id && ownership.kind === "secondary") return { user, emailId: ownership.emailId };
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

/**
 * The proved address signs in to a different active account than the person
 * continuing. Nothing may be linked or created: that person signs in with the
 * address instead (accounts are merged only by the secretariat).
 */
export async function isProposalProofAddressOwnedElsewhere(
  db: DatabaseLike,
  email: string,
  expectedUserId: string | undefined,
): Promise<boolean> {
  if (!expectedUserId) return false;
  const owner = await findUserEmailOwner(db, email);
  if (!owner || owner.userId === expectedUserId || owner.kind === "pending") return false;
  if (owner.kind === "secondary" && owner.verified !== 1) return false;
  return Boolean(
    await first(
      db,
      "SELECT 1 AS active FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
      [owner.userId],
    ),
  );
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
  const resolved = await resolveProposalProofPerson(
    db,
    payload.email,
    payload.speakerClaimSessionId ? (payload.userId ?? undefined) : payload.context?.userId,
  );
  if (!resolved || (resolved.user?.id ?? null) !== payload.userId)
    throw new AppError(
      409,
      "PROPOSAL_PERSON_CHANGED",
      "The confirmed email's account changed. Confirm your email again.",
    );
  const ownership = await readEmailOwnership(db, payload.email);
  const prepared = resolved.user
    ? {
        user: resolved.user,
        created: false,
        statements: prepareEmailOwnershipClaim(db, payload.email, resolved.user.id, ownership),
      }
    : await buildFindOrCreateUserStatement(db, { ...profile, email: payload.email, mailboxVerified: true });
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
      ...prepared.statements,
      prepareAuthorizationGuard(db, evidence),
      ...(resolved.emailId && !(ownership?.kind === "secondary" && ownership.userId === prepared.user.id)
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
        // This exact invitation is independently bound into the verified continuation.
        // Preserve its scoped flow while revoking the account's earlier access.
        provedSpeakerId:
          payload.operation === "speaker_profile" &&
          payload.context?.kind === "speaker" &&
          payload.context.userId === prepared.user.id
            ? payload.context.speakerId
            : undefined,
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

/** Claims an unaccepted invitation only; never transfers a proposer or merges accounts. */
export async function prepareInvitedSpeakerAccountClaim(
  db: DatabaseLike,
  payload: EventProposalContinuationPayload,
  actor?: { userId: string; sessionId: string },
): Promise<StatementLike[]> {
  if (!payload.speakerClaimSessionId) return [];
  const context = payload.context;
  if (
    payload.operation !== "speaker_profile" ||
    context?.kind !== "speaker" ||
    context.sessionId ||
    !payload.userId ||
    payload.userId === context.userId ||
    actor?.userId !== payload.userId ||
    actor.sessionId !== payload.speakerClaimSessionId
  )
    throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Sign in to the account that confirmed this email.");
  const evidence = {
    sql: `SELECT 1 FROM proposal_speakers ps JOIN session_proposals sp ON sp.id=ps.proposal_id
      JOIN sessions session ON session.id=? AND session.user_id=? AND session.revoked_at IS NULL
        AND session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE ps.id=? AND ps.user_id=? AND ps.status IN ('invited','pending') AND ps.role<>'proposer'
        AND sp.proposer_user_id<>ps.user_id AND sp.deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM proposal_speakers other WHERE other.proposal_id=ps.proposal_id AND other.user_id=?)`,
    bindings: [actor.sessionId, actor.userId, context.speakerId, context.userId, actor.userId],
  };
  if (!(await first(db, evidence.sql, evidence.bindings)))
    throw new AppError(409, "SPEAKER_CLAIM_UNAVAILABLE", "This speaker invitation cannot be claimed by this account.");
  return [prepareAuthorizationGuard(db, evidence)];
}
