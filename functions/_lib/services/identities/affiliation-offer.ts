/**
 * The organization question a signed-in person is asked, and their answer.
 *
 * A verified work address automatically affiliates the person with its organization.
 * This module only reads what is left to ask (an automatic link to confirm
 * first) and records "not my organization" or "I am independent"; "not my
 * organization" on an automatic link also ends the identity it created.
 */
import type { AffiliationOffer } from "../../../../assets/shared/schemas/affiliation-offer";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { emailDomainOf } from "../../../../assets/shared/schemas/email-domains";
import { prepareAuditLog } from "../audit";
import { prepareLinkNoticeDeclined, readOpenLinkNotice } from "./organization-link-notices";
import { resolveEmailDomainOrganization } from "./verified-email-domain";

/** A person rarely verifies more than a handful of addresses; the offer looks at no more than this many. */
const ADDRESS_LIMIT = 20;

interface VerifiedAddressRow {
  id: string | null;
  normalized_email: string;
}

async function verifiedAddresses(db: DatabaseLike, userId: string): Promise<VerifiedAddressRow[]> {
  return all<VerifiedAddressRow>(
    db,
    `SELECT NULL AS id, normalized_email, 0 AS preference, '' AS sort_id FROM users
      WHERE id = ? AND email_verified_at IS NOT NULL
     UNION ALL
     SELECT id, normalized_email, 1, id FROM user_emails WHERE user_id = ? AND verified_at IS NOT NULL
     ORDER BY preference, sort_id LIMIT ${ADDRESS_LIMIT}`,
    [userId, userId],
  );
}

/**
 * Closes matching historical reviews from every source once the person holds an
 * organization identity they chose or verified: their written text has been
 * answered by the person it describes.
 */
export function prepareOwnAffiliationReviewResolution(
  db: DatabaseLike,
  input: { userId: string; identityId: string; at: string },
): StatementLike {
  return db
    .prepare(
      `UPDATE affiliation_reviews
          SET resolved_identity_id = ?, resolved_by_user_id = ?, resolved_at = ?
        WHERE user_id = ? AND resolved_at IS NULL
          AND EXISTS (SELECT 1 FROM identities WHERE id = ? AND user_id = ? AND organization_id IS NOT NULL
                       AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL
                       AND (affiliation_reviews.email_domain = identities.verified_email_domain
                         OR affiliation_reviews.email_domain IN (SELECT domain FROM organization_domain_claims WHERE organization_id = identities.organization_id AND application_id IS NULL)
                         OR affiliation_reviews.normalized_name = (SELECT normalized_name FROM organizations WHERE id = identities.organization_id)))`,
    )
    .bind(input.identityId, input.userId, input.at, input.userId, input.identityId, input.userId);
}

export async function readAffiliationOffer(db: DatabaseLike, userId: string): Promise<AffiliationOffer | null> {
  const linked = await readOpenLinkNotice(db, userId);
  if (linked) return { kind: "linked", ...linked };
  const [addresses, related, dismissals, written] = await Promise.all([
    verifiedAddresses(db, userId),
    all<{ organization_id: string; active: number }>(
      db,
      `SELECT organization_id,
              MAX(started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL) AS active
         FROM identities WHERE user_id = ? AND organization_id IS NOT NULL GROUP BY organization_id`,
      [userId],
    ),
    all<{ organization_id: string | null }>(
      db,
      "SELECT organization_id FROM affiliation_offer_dismissals WHERE user_id = ?",
      [userId],
    ),
    first<{ organization_name: string | null }>(
      db,
      `SELECT organization_name FROM affiliation_reviews
        WHERE user_id = ? AND source_type = 'user_profile' AND resolved_at IS NULL`,
      [userId],
    ),
  ]);
  const writtenOrganizationName = written?.organization_name ?? null;
  const relatedIds = new Set(related.map((row) => row.organization_id));
  const dismissed = new Set(dismissals.map((row) => row.organization_id));
  let hasWorkAddress = false;
  for (const address of addresses) {
    const { domain, resolution } = await resolveEmailDomainOrganization(db, address.normalized_email);
    if (!domain) continue;
    hasWorkAddress = true;
    if (resolution.kind !== "organization") continue;
    if (relatedIds.has(resolution.organizationId) || dismissed.has(resolution.organizationId)) continue;
    const organization = await first<{ id: string; name: string }>(
      db,
      "SELECT id, name FROM organizations WHERE id = ?",
      [resolution.organizationId],
    );
    if (!organization) continue;
    return { kind: "organization", organization, emailId: address.id, domain, writtenOrganizationName };
  }
  const holdsOrganization = related.some((row) => Boolean(row.active));
  if (hasWorkAddress || holdsOrganization || dismissed.has(null) || addresses.length === 0) return null;
  return {
    kind: "work_address",
    freeDomains: [...new Set(addresses.map((address) => emailDomainOf(address.normalized_email)))].sort(),
    writtenOrganizationName,
  };
}

/**
 * "Not my organization" for one organization, or "I am independent" when
 * `organizationId` is null. Independence also answers the person's own open
 * profile review: they said no organization applies.
 */
export async function dismissAffiliationOffer(
  db: DatabaseLike,
  input: { userId: string; organizationId: string | null },
): Promise<void> {
  if (input.organizationId) {
    const organization = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE id = ?", [
      input.organizationId,
    ]);
    if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  }
  const at = nowIso();
  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT INTO affiliation_offer_dismissals (id, user_id, organization_id, created_at)
         SELECT ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM affiliation_offer_dismissals
                             WHERE user_id = ? AND organization_id IS ?)`,
      )
      .bind(uuid(), input.userId, input.organizationId, at, input.userId, input.organizationId),
    prepareAuditLog(db, "user", input.userId, "affiliation_offer_dismissed", "user", input.userId, {
      organizationId: input.organizationId,
      independent: input.organizationId === null,
    }),
  ];
  // An automatic link to this organization is undone, not just dismissed.
  if (input.organizationId)
    statements.push(
      ...prepareLinkNoticeDeclined(db, { userId: input.userId, organizationId: input.organizationId, at }),
    );
  if (input.organizationId === null)
    statements.push(
      db
        .prepare(
          `UPDATE affiliation_reviews SET resolved_by_user_id = ?, resolved_at = ?
            WHERE user_id = ? AND source_type = 'user_profile' AND resolved_at IS NULL`,
        )
        .bind(input.userId, at, input.userId),
    );
  await db.batch(statements);
}

/** Whether the person said this organization is not theirs. */
export async function hasDismissedOrganization(
  db: DatabaseLike,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  return Boolean(
    await first<{ id: string }>(
      db,
      "SELECT id FROM affiliation_offer_dismissals WHERE user_id = ? AND organization_id = ?",
      [userId, organizationId],
    ),
  );
}
