import { APPLICATION_TERMINAL_STAGES } from "../../../../../assets/shared/schemas/member-applications";
import { signCapabilityToken } from "../../../auth/capability-token";
import type { SqlSelection } from "../../../db/sql-value";

const OPEN_STAGE_SQL = `NOT IN (${APPLICATION_TERMINAL_STAGES.map(() => "?").join(", ")})`;

export interface OwnOpenApplicationRow {
  id: string;
  manage_token_hash: string;
  applicant_email: string;
}

export type OpenJoinApplication = { kind: "own"; statusPath: string } | { kind: "organization" } | null;

/**
 * The newest application still open for the proved address's account. An
 * application bound to a user belongs to that user through any of their
 * verified addresses; an unbound one belongs to the address it was made from.
 */
export function ownOpenApplicationSelection(email: string, applicantUser: SqlSelection): SqlSelection {
  return {
    sql: `SELECT id, manage_token_hash, applicant_email FROM member_applications
      WHERE (applicant_user_id = (${applicantUser.sql}) OR (applicant_user_id IS NULL AND applicant_email = ?))
        AND stage ${OPEN_STAGE_SQL}
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    bindings: [...applicantUser.bindings, email, ...APPLICATION_TERMINAL_STAGES],
  };
}

/** An open application that holds the organization domain claim the address links through. */
export function organizationOpenApplicationSelection(claim: SqlSelection): SqlSelection {
  return {
    sql: `SELECT application.id FROM organization_domain_claims claim
       JOIN member_applications application ON application.id = claim.application_id
      WHERE claim.id = (SELECT id FROM (${claim.sql})) AND claim.organization_id IS NULL
        AND application.stage ${OPEN_STAGE_SQL}
      LIMIT 1`,
    bindings: [...claim.bindings, ...APPLICATION_TERMINAL_STAGES],
  };
}

/**
 * Found right after verification so the applicant learns of an open application
 * before filling in the form again. The owner receives a status-only link to it;
 * another person's application for the same domain is only acknowledged.
 */
export async function resolveOpenJoinApplication(
  signingSecret: string,
  observed: { own: OwnOpenApplicationRow | null; organizationHeld: boolean },
): Promise<OpenJoinApplication> {
  const own = observed.own;
  if (own) {
    const token = await signCapabilityToken({
      signingSecret,
      linkSecret: `${own.manage_token_hash}\n${own.applicant_email}`,
      purpose: "application_status",
      resourceId: own.id,
    });
    return {
      kind: "own",
      statusPath: `/application-status/?id=${encodeURIComponent(own.id)}&token=${encodeURIComponent(token)}`,
    };
  }
  return observed.organizationHeld ? { kind: "organization" } : null;
}
