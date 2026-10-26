/** Prepare the production domain resolver's bounded observations in one request batch. */
import type { z } from "zod";
import { batchFirst, batchRows } from "../../db/pagination";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { AppError } from "../../errors";
import { emailHost, organizationDomainCandidates, workEmailDomain } from "../../email-domains/classification";
import { normalizeOrgName } from "../../../../assets/shared/organization-name";
import { slugifyOr } from "../../../../assets/shared/slug";
import { OWN_ADDRESSES_SQL, OWN_ADDRESS_COLUMNS, type OwnAddressRow, toAddress } from "../own-email-address-read";
import {
  domainOwnershipFactMatchesSql,
  FACT_ORGANIZATION,
  requireWorkOrganizationDomain,
} from "./verified-email-domain";
import { verifiedAffiliationBasisSchema } from "./verified-affiliation-basis";

type Basis = z.infer<typeof verifiedAffiliationBasisSchema>;
export function prepareVerifiedAffiliationRead(
  db: DatabaseLike,
  userId: string,
  input: {
    email: string;
    emailId: string | null;
    organizationName?: string;
    unaffiliatedAttestation?: boolean;
  },
) {
  const candidates = organizationDomainCandidates(input.email);
  const domains = JSON.stringify(candidates);
  const matches = domainOwnershipFactMatchesSql("requested.value");
  const slug = slugifyOr(input.organizationName ?? "", "member");
  const statements = [
    db
      .prepare(`${OWN_ADDRESSES_SQL} SELECT ${OWN_ADDRESS_COLUMNS} FROM addresses WHERE id IS ? LIMIT 1`)
      .bind(userId, userId, input.emailId),
    db
      .prepare(`SELECT claim.id,claim.domain,claim.application_id AS applicationId,claim.organization_id AS organizationId,
      EXISTS(SELECT 1 FROM members member WHERE member.organization_id=claim.organization_id) AS member
      FROM organization_domain_claims claim JOIN json_each(?) requested ON requested.value=claim.domain ORDER BY length(claim.domain) DESC`)
      .bind(domains),
    db
      .prepare(`WITH facts AS (
      SELECT requested.value AS domain,${FACT_ORGANIZATION} AS id,
        MAX(CASE WHEN fact.verified_email_domain IS NOT NULL AND fact.source='verified_email' AND fact.started_at IS NOT NULL
          AND fact.ended_at IS NULL AND fact.blocked_at IS NULL AND person.active=1 THEN 1 ELSE 0 END) AS active,
        MAX(CASE WHEN fact.blocked_at IS NOT NULL THEN 1 ELSE 0 END) AS disputed,
        MAX(CASE WHEN fact.verified_email_domain IS NULL THEN 1 ELSE 0 END) AS unknown,
        EXISTS(SELECT 1 FROM members member WHERE member.organization_id=${FACT_ORGANIZATION}) AS member
      FROM json_each(?) requested JOIN identities fact ON ${matches} JOIN users person ON person.id=fact.user_id
      WHERE fact.organization_id IS NOT NULL GROUP BY requested.value,${FACT_ORGANIZATION}
    ), ranked AS (SELECT domain,id,active,disputed,unknown,member,ROW_NUMBER() OVER(PARTITION BY domain ORDER BY id) AS position FROM facts)
      SELECT domain,id,active,disputed,unknown,member FROM ranked WHERE position<=257`)
      .bind(domains),
    db
      .prepare(`SELECT organization.id,organization.name,organization.normalized_name,organization.merged_into_organization_id,member.id AS member_id
      FROM organizations organization LEFT JOIN members member ON member.organization_id=organization.id
      WHERE organization.normalized_name=? OR organization.id IN (
        SELECT claim.organization_id FROM organization_domain_claims claim JOIN json_each(?) requested ON claim.domain=requested.value
        UNION SELECT ${FACT_ORGANIZATION} FROM identities fact JOIN json_each(?) requested ON ${matches}
      ) LIMIT 257`)
      .bind(normalizeOrgName(input.organizationName ?? ""), domains, domains),
    db
      .prepare(`SELECT id,organization_id,email_id,updated_at,invited_at,started_at,ended_at,blocked_at,job_title
      FROM identities WHERE user_id=? ORDER BY id LIMIT 501`)
      .bind(userId),
    db.prepare(`SELECT identity_id FROM user_emails WHERE id=? AND user_id=?`).bind(input.emailId, userId),
    db
      .prepare(`SELECT slug FROM organizations WHERE ?=1 AND (slug=? OR slug GLOB ?) ORDER BY slug LIMIT 1001`)
      .bind(input.organizationName ? 1 : 0, slug, `${slug}-[0-9]*`),
  ];
  return {
    statements,
    decode(results: D1StatementResult[]) {
      const address = batchFirst<OwnAddressRow>(results[0]);
      if (!address || address.email.toLowerCase() !== input.email.toLowerCase() || !address.verified_at)
        throw new AppError(
          422,
          "IDENTITY_EMAIL_UNVERIFIED",
          "Verify this representation email address before continuing.",
        );
      const claims = batchRows<{
        id: string;
        domain: string;
        applicationId: string | null;
        organizationId: string | null;
        member: number;
      }>(results[1]);
      const claim = claims[0] ?? null;
      const domain = input.unaffiliatedAttestation
        ? emailHost(address.email)!
        : requireWorkOrganizationDomain(claim?.domain ?? workEmailDomain(address.email));
      const derived = batchRows<{
        domain: string;
        id: string;
        active: number;
        disputed: number;
        unknown: number;
        member: number;
      }>(results[2]).filter((fact) => fact.domain === domain);
      const basis: Basis = verifiedAffiliationBasisSchema.parse({
        domain,
        claim,
        facts: {
          claimed: claim?.organizationId
            ? { organizationId: claim.organizationId, isMember: Boolean(claim.member) }
            : null,
          heldByApplication: Boolean(claim && !claim.organizationId),
          derived: derived.map((fact) => ({
            organizationId: fact.id,
            isMember: Boolean(fact.member),
            active: Boolean(fact.active),
            disputed: Boolean(fact.disputed),
            unknownProvenance: Boolean(fact.unknown),
          })),
        },
        organizations: batchRows(results[3]),
        identities: batchRows(results[4]),
        emailOwner: batchFirst(results[5]),
        takenSlugs: batchRows<{ slug: string }>(results[6]).map((row) => row.slug),
      });
      return { basis, address: toAddress(address) };
    },
  };
}
