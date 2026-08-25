import {
  emailDomainOf,
  isDisposableEmailDomain,
  isPersonalEmailDomain,
} from "../../../../assets/shared/constants/email-domains";
import { first } from "../../db/queries";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLogWhen } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { buildAddRepresentativeStatement } from "../membership/representatives";
import { isConcurrentRepresentationConflict } from "./conflicts";
import { listVerifiedDomainMatches } from "./domain-assessment";

function verifiedDomainAssociationEvidence(input: {
  userId: string;
  normalizedEmail: string;
  domain: string;
  memberId: string;
}): AuthorizationEvidence {
  return {
    sql: `SELECT 1
            FROM organization_domain_claims claim
            JOIN members member
              ON member.organization_id = claim.organization_id
             AND member.id = ?
             AND member.status = 'active'
           WHERE claim.domain = ?
             AND claim.organization_id IS NOT NULL
             AND (
               EXISTS (
                 SELECT 1 FROM users
                  WHERE id = ? AND normalized_email = ? AND email_verified_at IS NOT NULL
               )
               OR EXISTS (
                 SELECT 1 FROM user_emails
                  WHERE user_id = ? AND normalized_email = ? AND verified_at IS NOT NULL
               )
             )
             AND NOT EXISTS (
               SELECT 1 FROM organization_representatives representative
                WHERE representative.member_id = member.id
                  AND representative.user_id = ?
                  AND representative.blocked_at IS NOT NULL
             )
           LIMIT 1`,
    bindings: [
      input.memberId,
      input.domain,
      input.userId,
      input.normalizedEmail,
      input.userId,
      input.normalizedEmail,
      input.userId,
    ],
  };
}

function prepareVerifiedDomainAudit(
  db: DatabaseLike,
  input: { representativeId: string; memberId: string; userId: string; email: string; domain: string; at: string },
): StatementLike {
  return prepareAuditLogWhen(db, {
    actorType: "system",
    actorId: null,
    action: "organization_representative_domain_reconciled",
    entityType: "organization_representative",
    entityId: input.representativeId,
    details: { userId: input.userId, email: input.email, domain: input.domain },
    conditionSql: "SELECT 1 WHERE changes() = 1",
    conditionBindings: [],
    createdAt: input.at,
    scope: { type: "organization", id: input.memberId },
  });
}

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
  const preparedRepresentatives: Array<{ representativeId: string; resultIndex: number }> = [];
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
      condition: verifiedDomainAssociationEvidence({
        userId,
        normalizedEmail: match.email,
        domain: match.domain,
        memberId: match.memberId,
      }),
    });
    preparedRepresentatives.push({ representativeId: prepared.representativeId, resultIndex: statements.length });
    statements.push(
      prepared.statement,
      prepareVerifiedDomainAudit(db, {
        representativeId: prepared.representativeId,
        memberId: match.memberId,
        userId,
        email: match.email,
        domain: match.domain,
        at,
      }),
    );
  }
  if (statements.length > 0) {
    statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(db, userId, at));
    try {
      const results = await db.batch(statements);
      return preparedRepresentatives
        .filter(({ resultIndex }) => Number(results[resultIndex]?.meta?.changes ?? 0) === 1)
        .map(({ representativeId }) => representativeId);
    } catch (error) {
      if (retryOnConflict && isConcurrentRepresentationConflict(error)) {
        return reconcileVerifiedDomainRepresentationsAttempt(db, userId, false);
      }
      throw error;
    }
  }
  return [];
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
    condition: verifiedDomainAssociationEvidence({
      userId: input.userId,
      normalizedEmail: input.normalizedEmail,
      domain,
      memberId: match.member_id,
    }),
  });
  return [
    prepared.statement,
    prepareVerifiedDomainAudit(db, {
      representativeId: prepared.representativeId,
      memberId: match.member_id,
      userId: input.userId,
      email: input.normalizedEmail,
      domain,
      at: input.at,
    }),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
  ];
}
