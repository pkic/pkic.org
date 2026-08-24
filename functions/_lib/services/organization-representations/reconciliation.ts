import {
  emailDomainOf,
  isDisposableEmailDomain,
  isPersonalEmailDomain,
} from "../../../../assets/shared/constants/email-domains";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { buildAddRepresentativeStatement } from "../membership/representatives";
import { isConcurrentRepresentationConflict } from "./conflicts";
import { listVerifiedDomainMatches } from "./domain-assessment";

async function reconcileVerifiedDomainRepresentationsAttempt(
  db: DatabaseLike,
  userId: string,
  retryOnConflict: boolean,
): Promise<string[]> {
  if (!(await first(db, "SELECT id FROM users WHERE id = ? AND active = 1", [userId]))) {
    throw new AppError(404, "USER_NOT_FOUND", "Active user not found");
  }
  const matches = await listVerifiedDomainMatches(db, userId);
  const statements: StatementLike[] = [];
  const representativeIds: string[] = [];
  const at = nowIso();
  for (const match of matches) {
    const existing = await first<{ id: string; left_at: string | null; blocked_at: string | null }>(
      db,
      "SELECT id, left_at, blocked_at FROM organization_representatives WHERE member_id = ? AND user_id = ?",
      [match.memberId, userId],
    );
    if (existing?.blocked_at || existing?.left_at === null) continue;
    const prepared = await buildAddRepresentativeStatement(db, {
      memberId: match.memberId,
      userId,
      source: "verified_domain",
      now: at,
    });
    representativeIds.push(prepared.representativeId);
    statements.push(
      prepared.statement,
      prepareScopedAuditLog(
        db,
        { type: "organization", id: match.memberId },
        "system",
        null,
        "organization_representative_domain_reconciled",
        "organization_representative",
        prepared.representativeId,
        { userId, email: match.email, domain: match.domain },
        at,
      ),
    );
  }
  if (statements.length > 0) {
    statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(db, userId, at));
    try {
      await db.batch(statements);
    } catch (error) {
      if (retryOnConflict && isConcurrentRepresentationConflict(error)) {
        return reconcileVerifiedDomainRepresentationsAttempt(db, userId, false);
      }
      throw error;
    }
  }
  return representativeIds;
}

/** Automatically associates only verified, exact, claimed custom-domain matches. */
export async function reconcileVerifiedDomainRepresentations(db: DatabaseLike, userId: string): Promise<string[]> {
  return reconcileVerifiedDomainRepresentationsAttempt(db, userId, true);
}

/**
 * Builds the exact-domain association for a proof-producing transaction
 * whose verification evidence will commit in the same D1 batch.
 */
export async function prepareVerifiedDomainAssociationStatements(
  db: DatabaseLike,
  input: { userId: string; normalizedEmail: string; at: string },
): Promise<StatementLike[]> {
  const domain = emailDomainOf(input.normalizedEmail);
  if (!domain || isPersonalEmailDomain(domain) || isDisposableEmailDomain(domain)) return [];
  const match = await first<{ member_id: string }>(
    db,
    `SELECT member.id AS member_id
       FROM organization_domain_claims claim
       JOIN members member
         ON member.organization_id = claim.organization_id
        AND member.status = 'active'
      WHERE claim.domain = ? AND claim.organization_id IS NOT NULL
      LIMIT 1`,
    [domain],
  );
  if (!match) return [];
  const existing = await first<{ id: string; left_at: string | null; blocked_at: string | null }>(
    db,
    "SELECT id, left_at, blocked_at FROM organization_representatives WHERE member_id = ? AND user_id = ?",
    [match.member_id, input.userId],
  );
  if (existing?.blocked_at || existing?.left_at === null) return [];
  const prepared = await buildAddRepresentativeStatement(db, {
    memberId: match.member_id,
    userId: input.userId,
    source: "verified_domain",
    now: input.at,
  });
  return [
    prepared.statement,
    prepareScopedAuditLog(
      db,
      { type: "organization", id: match.member_id },
      "system",
      null,
      "organization_representative_domain_reconciled",
      "organization_representative",
      prepared.representativeId,
      { userId: input.userId, email: input.normalizedEmail, domain },
      input.at,
    ),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
  ];
}
