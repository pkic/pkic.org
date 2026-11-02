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
  verifiedRepresentationDomainCandidates,
} from "./verified-email-domain";
import { verifiedAffiliationBasisSchema } from "./verified-affiliation-basis";

type Basis = z.infer<typeof verifiedAffiliationBasisSchema>;
export function prepareVerifiedAffiliationRead(
  db: DatabaseLike,
  userId: string | { sql: string; bindings: unknown[] },
  input: {
    email: string;
    emailId: string | null;
    organizationName?: string;
    domain?: string;
    unaffiliatedAttestation?: boolean;
  },
  mailboxProof?: { verifiedAt: string; pendingApplicationReview?: boolean },
) {
  const subject = typeof userId === "string" ? { sql: "?", bindings: [userId] } : userId;
  const candidates = organizationDomainCandidates(input.email);
  const domains = JSON.stringify(candidates);
  const matches = domainOwnershipFactMatchesSql("requested.value");
  const slug = slugifyOr(input.organizationName ?? "", "member");
  const statements = [
    mailboxProof
      ? db
          .prepare(`SELECT (SELECT address.id FROM user_emails address WHERE address.normalized_email=? AND address.verified_at IS NOT NULL AND address.user_id=(${subject.sql})) AS id,
            ? AS email,1 AS is_primary,? AS verified_at,'registration_confirmation' AS verification_method,NULL AS identity_id,? AS created_at,0 AS sign_in_enabled`)
          .bind(input.email, ...subject.bindings, input.email, mailboxProof.verifiedAt, mailboxProof.verifiedAt)
      : db
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
        UNION SELECT organization_id FROM identities WHERE user_id=(${subject.sql})
          AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL
      ) LIMIT 257`)
      .bind(normalizeOrgName(input.organizationName ?? ""), domains, domains, ...subject.bindings),
    db
      .prepare(`SELECT id,organization_id,email_id,updated_at,invited_at,started_at,ended_at,blocked_at,job_title
      FROM identities WHERE user_id=(${subject.sql}) ORDER BY id LIMIT 501`)
      .bind(...subject.bindings),
    db
      .prepare(`SELECT identity_id FROM user_emails WHERE id=? AND user_id=(${subject.sql})`)
      .bind(input.emailId, ...subject.bindings),
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

      if (input.domain && !verifiedRepresentationDomainCandidates(address.email, claims).includes(input.domain))
        throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "Choose a domain of your verified work email address.");
      const rootDomain = workEmailDomain(address.email);
      const knownRoot = batchRows<{ domain: string }>(results[2]).some((fact) => fact.domain === rootDomain);
      const suggested = knownRoot ? rootDomain : (candidates[0] ?? rootDomain);
      const domain = input.unaffiliatedAttestation
        ? emailHost(address.email)!
        : requireWorkOrganizationDomain(input.domain ?? claims[0]?.domain ?? suggested);
      const claim = claims.find((item) => item.domain === domain) ?? null;
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
        claims,
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
