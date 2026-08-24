import type { RepresentationDomainAssessment } from "../../../../assets/shared/schemas/organization-representation";
import {
  emailDomainOf,
  isDisposableEmailDomain,
  isPersonalEmailDomain,
} from "../../../../assets/shared/constants/email-domains";
import { all, first } from "../../db/queries";
import { normalizeEmail } from "../../validation";
import type { DatabaseLike } from "../../types";

interface EmailEvidenceRow {
  normalized_email: string;
  verified_at: string | null;
}

interface DomainMemberRow {
  member_id: string;
  organization_id: string;
}

function result(
  email: string,
  domain: string,
  outcome: RepresentationDomainAssessment["outcome"],
  warning: string | null,
  memberId: string | null = null,
): RepresentationDomainAssessment {
  return {
    email,
    domain,
    outcome,
    mayAutomaticallyAssociate: outcome === "exact_claimed_match",
    warning,
    memberId,
  };
}

/** Evaluates one user-owned address without treating a domain match as mailbox proof. */
export async function assessRepresentationDomain(
  db: DatabaseLike,
  userId: string,
  emailInput: string,
): Promise<RepresentationDomainAssessment> {
  const email = normalizeEmail(emailInput);
  const domain = emailDomainOf(email);
  if (isPersonalEmailDomain(domain)) {
    return result(
      email,
      domain,
      "free_or_personal_domain",
      "Personal or free email domains cannot establish organization representation; an organization contact may associate you explicitly.",
    );
  }
  if (isDisposableEmailDomain(domain)) {
    return result(
      email,
      domain,
      "disposable_domain",
      "Disposable email domains cannot establish organization representation; an organization contact may associate you explicitly.",
    );
  }

  const evidence = await first<EmailEvidenceRow>(
    db,
    `SELECT normalized_email, email_verified_at AS verified_at
       FROM users WHERE id = ? AND normalized_email = ?
      UNION ALL
     SELECT normalized_email, verified_at
       FROM user_emails WHERE user_id = ? AND normalized_email = ?
      LIMIT 1`,
    [userId, email, userId, email],
  );
  if (!evidence?.verified_at) {
    return result(
      email,
      domain,
      "unverified_email",
      "Verify this email address before it can establish organization representation.",
    );
  }

  const members = await all<DomainMemberRow>(
    db,
    `SELECT member.id AS member_id, claim.organization_id
       FROM organization_domain_claims claim
       JOIN members member
         ON member.organization_id = claim.organization_id
        AND member.status = 'active'
      WHERE claim.domain = ? AND claim.organization_id IS NOT NULL
      ORDER BY member.id
      LIMIT 2`,
    [domain],
  );
  if (members.length === 0) {
    return result(
      email,
      domain,
      "unclaimed_domain",
      "No active organization has claimed this domain; an organization contact may associate you explicitly.",
    );
  }
  if (members.length > 1) {
    return result(
      email,
      domain,
      "ambiguous_domain",
      "This domain does not resolve to one organization and requires explicit review.",
    );
  }

  const memberId = members[0]!.member_id;
  const blocked = await first<{ id: string }>(
    db,
    `SELECT id FROM organization_representatives
      WHERE member_id = ? AND user_id = ? AND blocked_at IS NOT NULL`,
    [memberId, userId],
  );
  if (blocked) {
    return result(
      email,
      domain,
      "blocked_relationship",
      "An organization contact removed this representation; automatic association is disabled until it is explicitly restored.",
      memberId,
    );
  }
  return result(email, domain, "exact_claimed_match", null, memberId);
}

/** Returns each exact verified claimed-domain match for reconciliation. */
export async function listVerifiedDomainMatches(
  db: DatabaseLike,
  userId: string,
): Promise<Array<{ email: string; domain: string; memberId: string }>> {
  const rows = await all<{ email: string; domain: string; member_id: string }>(
    db,
    `WITH verified_emails(email, domain) AS (
       SELECT normalized_email,
              substr(normalized_email, instr(normalized_email, '@') + 1)
         FROM users
        WHERE id = ? AND email_verified_at IS NOT NULL
       UNION
       SELECT normalized_email,
              substr(normalized_email, instr(normalized_email, '@') + 1)
         FROM user_emails
        WHERE user_id = ? AND verified_at IS NOT NULL
     )
     SELECT verified.email, verified.domain, member.id AS member_id
       FROM verified_emails verified
       JOIN organization_domain_claims claim
         ON claim.domain = verified.domain AND claim.organization_id IS NOT NULL
       JOIN members member
         ON member.organization_id = claim.organization_id AND member.status = 'active'
      ORDER BY verified.domain, member.id`,
    [userId, userId],
  );
  return rows
    .filter((row) => !isPersonalEmailDomain(row.domain) && !isDisposableEmailDomain(row.domain))
    .map((row) => ({ email: row.email, domain: row.domain, memberId: row.member_id }));
}
